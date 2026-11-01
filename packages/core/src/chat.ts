import type { Model, ModelTurn } from "./session.ts";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletion = {
  messages: readonly ChatMessage[];
};

export type ChatClient = {
  complete: (completion: ChatCompletion) => Promise<string>;
};

export type ModelEnv = {
  CAPRICE_MODEL_URL: string | undefined;
  CAPRICE_MODEL: string | undefined;
  CAPRICE_MODEL_API_KEY: string | undefined;
};

export type ModelEndpoint = {
  url: string;
  model: string;
  apiKey: string;
};

export type HttpPost = (
  url: string,
  body: string,
  apiKey: string,
) => Promise<string>;

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

export function messagesFromTurn(turn: ModelTurn): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: turn.persona }];

  for (const line of turn.lines) {
    messages.push({
      role: line.who === "host" ? "user" : "assistant",
      content: line.text,
    });
  }

  const last = turn.lines.at(-1);

  if (
    last === undefined ||
    last.who !== "host" ||
    last.text !== turn.hostText
  ) {
    messages.push({ role: "user", content: turn.hostText });
  }

  return messages;
}

export function chatModel(client: ChatClient): Model {
  return {
    async reply(turn) {
      const text = await client.complete({ messages: messagesFromTurn(turn) });

      return { text };
    },
  };
}

export function readModelEndpoint(env: ModelEnv): ModelEndpoint {
  return {
    url: required("CAPRICE_MODEL_URL", env.CAPRICE_MODEL_URL),
    model: required("CAPRICE_MODEL", env.CAPRICE_MODEL),
    apiKey: env.CAPRICE_MODEL_API_KEY ?? "",
  };
}

export function httpChatClient(
  endpoint: ModelEndpoint,
  post: HttpPost = postJson,
): ChatClient {
  return {
    async complete(completion) {
      const body = JSON.stringify({
        model: endpoint.model,
        messages: completion.messages,
      });

      const raw = await post(endpoint.url, body, endpoint.apiKey);

      return readAssistantContent(raw);
    },
  };
}

function required(name: string, value: string | undefined): string {
  const text = value?.trim() ?? "";

  if (text.length === 0) {
    throw new Error(`${name} is required`);
  }

  return text;
}

async function postJson(
  url: string,
  body: string,
  apiKey: string,
): Promise<string> {
  const headers = new Headers({ "content-type": "application/json" });

  if (apiKey.length > 0) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const response = await fetch(url, { method: "POST", headers, body });

  if (!response.ok) {
    throw new Error(`model request failed: ${response.status}`);
  }

  return response.text();
}

export function readAssistantContent(body: string): string {
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

  const content = readString(message, "content");

  if (content === undefined) {
    throw new Error("model response has no content");
  }

  return content;
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
        return [];
      }

      items.push(item);
    }

    return items;
  }

  return [];
}
