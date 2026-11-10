import { interpretTextReply } from "./call.ts";
import { modelDeadlineMs } from "./deadline.ts";
import { type ModelProtocol } from "./modelClient.ts";
import { ok, tryCatch, type Result } from "./result.ts";
import type { Model, ModelCall, ModelOutput, ModelTurn } from "./session.ts";
import { toolGuide, type ToolSpec } from "./tool.ts";
import type { TranscriptEvent } from "./transcript.ts";

export type ChatPost = (
  body: string,
  signal: AbortSignal,
  deadlineMs?: number,
) => Promise<Result<string>>;

type TextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type WireCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type NativeMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: null; tool_calls: WireCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

export function chatModel(
  model: string,
  protocol: ModelProtocol,
  post: ChatPost,
  deadlineMs: number = modelDeadlineMs,
): Model {
  let textCalls = 0;

  return {
    async complete(turn) {
      const posted = await post(
        requestBody(model, protocol, turn),
        turn.signal,
        deadlineMs,
      );

      if (!posted.ok) {
        return posted;
      }

      const parsed = await tryCatch(
        parseOutput(posted.value, protocol, offeredNames(turn.tools)),
        "the model request failed",
      );

      if (!parsed.ok || protocol !== "text" || parsed.value.kind !== "calls") {
        return parsed;
      }

      const calls: ModelCall[] = [];

      for (const call of parsed.value.calls) {
        textCalls += 1;
        calls.push({
          id: `text-${textCalls}`,
          name: call.name,
          input: call.input,
        });
      }

      return ok({ kind: "calls", calls });
    },
  };
}

export function requestBody(
  model: string,
  protocol: ModelProtocol,
  turn: ModelTurn,
): string {
  if (protocol === "native" && turn.acceptTools) {
    return JSON.stringify({
      model,
      messages: nativeMessages(turn),
      tools: wireTools(turn.tools),
    });
  }

  if (protocol === "native") {
    return JSON.stringify({ model, messages: nativeMessages(turn) });
  }

  return JSON.stringify({ model, messages: textMessages(turn) });
}

export function readAssistantContent(body: string): string {
  const output = readModelOutput(body, "native", []);

  if (output.kind !== "message") {
    throw new Error("model response has no content");
  }

  return output.text;
}

export function toolInputFromArguments(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return "";
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (isString(parsed)) {
      return parsed;
    }

    if (isPlainObject(parsed)) {
      const input = readString(parsed, "input");

      if (input !== undefined) {
        return input;
      }
    }
  } catch {
    return raw;
  }

  return raw;
}

async function parseOutput(
  body: string,
  protocol: ModelProtocol,
  offered: readonly string[],
): Promise<ModelOutput> {
  return readModelOutput(body, protocol, offered);
}

function readModelOutput(
  body: string,
  protocol: ModelProtocol,
  offered: readonly string[],
): ModelOutput {
  const parsed: unknown = JSON.parse(body);

  if (!isPlainObject(parsed)) {
    throw new Error("model response is not an object");
  }

  const choices = readObjects(parsed, "choices");
  const first = choices[0];

  if (first === undefined) {
    throw new Error("model response has no choices");
  }

  const message = readObject(first, "message");

  if (message === undefined) {
    throw new Error("model response has no message");
  }

  if (protocol === "native") {
    const calls = readNativeCalls(message);

    if (calls.length > 0) {
      return { kind: "calls", calls };
    }
  }

  const content = readString(message, "content");

  if (content === undefined) {
    throw new Error("model response has no content");
  }

  if (protocol === "text") {
    return outputFromText(content, offered);
  }

  return { kind: "message", text: content };
}

function outputFromText(
  content: string,
  offered: readonly string[],
): ModelOutput {
  const reply = interpretTextReply(content, offered);

  if (reply.kind === "prose") {
    return { kind: "message", text: reply.text };
  }

  return {
    kind: "calls",
    calls: [{ id: "text", name: reply.name, input: reply.input }],
  };
}

function readNativeCalls(message: JsonRecord): ModelCall[] {
  const calls: ModelCall[] = [];
  let index = 0;

  for (const item of readObjects(message, "tool_calls")) {
    const fn = readObject(item, "function");

    if (fn === undefined) {
      continue;
    }

    const name = readString(fn, "name") ?? "";

    if (name.length === 0) {
      continue;
    }

    const id = readString(item, "id") ?? "";

    index += 1;
    calls.push({
      id: id.length > 0 ? id : `tool-${index}`,
      name,
      input: toolInput(fn),
    });
  }

  return calls;
}

function toolInput(fn: JsonRecord): string {
  const raw = readString(fn, "arguments");

  if (raw !== undefined) {
    return toolInputFromArguments(raw);
  }

  const object = readObject(fn, "arguments");

  if (object === undefined) {
    return "";
  }

  const input = readString(object, "input");

  if (input !== undefined) {
    return input;
  }

  return JSON.stringify(object);
}

function textMessages(turn: ModelTurn): TextMessage[] {
  const messages: TextMessage[] = [
    { role: "system", content: systemContent(turn) },
  ];

  for (const event of withRequest(turn.events, turn.request)) {
    if (event.kind === "user") {
      messages.push({ role: "user", content: event.text });
    } else if (event.kind === "assistant") {
      messages.push({ role: "assistant", content: event.text });
    } else if (event.kind === "tool-result") {
      messages.push({
        role: "user",
        content: `tool ${event.name}\n${event.text}`,
      });
    }
  }

  return messages;
}

function nativeMessages(turn: ModelTurn): NativeMessage[] {
  const messages: NativeMessage[] = [
    { role: "system", content: systemContent(turn) },
  ];

  let pending: ModelCall[] = [];

  const flush = () => {
    if (pending.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: wireCalls(pending),
    });
    pending = [];
  };

  for (const event of withRequest(turn.events, turn.request)) {
    if (event.kind === "tool-call") {
      pending.push({ id: event.id, name: event.name, input: event.input });

      continue;
    }

    flush();

    if (event.kind === "user") {
      messages.push({ role: "user", content: event.text });
    } else if (event.kind === "assistant") {
      messages.push({ role: "assistant", content: event.text });
    } else if (event.kind === "tool-result") {
      messages.push({
        role: "tool",
        tool_call_id: event.id,
        content: event.text,
      });
    }
  }

  flush();

  return messages;
}

function systemContent(turn: ModelTurn): string {
  const parts = [turn.persona];
  const guide = toolGuide(turn.tools);

  if (guide.length > 0) {
    parts.push(guide);
  }

  if (!turn.acceptTools) {
    parts.push("The tool budget for this turn is spent. Answer in words.");
  }

  return parts.join("\n\n");
}

function withRequest(
  events: readonly TranscriptEvent[],
  request: string,
): TranscriptEvent[] {
  if (request.length > 0) {
    for (const event of events) {
      if (event.kind === "user" && event.text === request) {
        return copyEvents(events);
      }
    }
  } else {
    return copyEvents(events);
  }

  const next: TranscriptEvent[] = [{ kind: "user", text: request }];

  for (const event of events) {
    next.push(event);
  }

  return next;
}

function wireTools(tools: readonly ToolSpec[]) {
  const list: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: { input: { type: "string" } };
        required: ["input"];
      };
    };
  }[] = [];

  for (const tool of tools) {
    list.push({
      type: "function",
      function: {
        name: tool.name,
        description: `${tool.kind}. ${tool.description}`,
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    });
  }

  return list;
}

function wireCalls(calls: readonly ModelCall[]): WireCall[] {
  const wire: WireCall[] = [];

  for (const call of calls) {
    wire.push({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify({ input: call.input }),
      },
    });
  }

  return wire;
}

function offeredNames(tools: readonly ToolSpec[]): string[] {
  const names: string[] = [];

  for (const tool of tools) {
    names.push(tool.name);
  }

  return names;
}

function copyEvents(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  const copy: TranscriptEvent[] = [];

  for (const event of events) {
    copy.push(event);
  }

  return copy;
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function readString(value: JsonRecord, key: string): string | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isString(field)) {
      return field;
    }
  }

  return undefined;
}

function readObject(value: JsonRecord, key: string): JsonRecord | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isPlainObject(field)) {
      return field;
    }
  }

  return undefined;
}

function readObjects(value: JsonRecord, key: string): JsonRecord[] {
  for (const [name, field] of Object.entries(value)) {
    if (name !== key || !Array.isArray(field)) {
      continue;
    }

    const items: JsonRecord[] = [];

    for (const item of field) {
      if (!isPlainObject(item)) {
        continue;
      }

      items.push(item);
    }

    return items;
  }

  return [];
}
