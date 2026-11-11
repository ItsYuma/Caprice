import {
  ToolChoiceViolationError,
  ToolLoopAgent,
  isStepCount,
  tool as sdkTool,
  type LanguageModel,
} from "ai";
import { z } from "zod";

import { fail, fromCause, ok, type Result } from "./result.ts";
import type { Model, ModelCall, ModelOutput, ModelTurn } from "./session.ts";
import { toolSpecs, type Tool, type ToolContext } from "./tool.ts";
import type { TranscriptEvent } from "./transcript.ts";

export const toolTurnLimit = 4;

const budgetSpent = "too many tool calls";

const toolInput = z.object({
  input: z.string(),
});

type CallDecision = "run" | "budget";

export type LoopMode = "say" | "refused";

export type LoopRun = {
  mode: LoopMode;
  persona: string;
  request: string;
  signal: AbortSignal;
  model: Model;
  tools: readonly Tool[];
  events: () => readonly TranscriptEvent[];
  record: (call: ModelCall, succeeded: boolean, text: string) => void;
};

export async function runLoop(run: LoopRun): Promise<Result<string>> {
  let modelAcceptTools = true;
  let used = 0;
  const callsById = new Map<string, ModelCall>();
  const decisions = new Map<string, CallDecision>();
  const recorded = new Set<string>();
  let primed: Promise<Result<ModelOutput>> | undefined;

  const modelTurn = (signal: AbortSignal): ModelTurn => {
    return {
      persona: run.persona,
      request: run.request,
      events: copyEvents(run.events()),
      tools: run.mode === "say" && modelAcceptTools ? toolSpecs(run.tools) : [],
      acceptTools: modelAcceptTools,
      signal,
    };
  };

  if (!run.signal.aborted) {
    try {
      const pending = run.model.complete(modelTurn(run.signal));

      pending.catch(() => undefined);
      primed = pending;
    } catch (cause) {
      primed = Promise.resolve(fromCause(cause, "the model request failed"));
    }
  }

  const finish = (call: ModelCall, succeeded: boolean, text: string) => {
    if (recorded.has(call.id)) {
      return;
    }

    recorded.add(call.id);
    run.record(call, succeeded, text);
  };

  const noteCalls = (calls: readonly ModelCall[]) => {
    for (const call of calls) {
      callsById.set(call.id, call);

      if (used >= toolTurnLimit) {
        decisions.set(call.id, "budget");

        continue;
      }

      used += 1;
      decisions.set(call.id, "run");
    }
  };

  const languageModel: LanguageModel = {
    specificationVersion: "v4",
    provider: "caprice",
    modelId: "session",
    supportedUrls: {},
    async doGenerate(options) {
      const signal = options.abortSignal ?? run.signal;
      const pending = primed;

      primed = undefined;

      const output =
        pending !== undefined
          ? await pending
          : await run.model.complete(modelTurn(signal));

      if (run.signal.aborted || options.abortSignal?.aborted) {
        throw abortError(run.signal);
      }

      if (!output.ok) {
        throw output.error;
      }

      if (output.value.kind === "message") {
        return messageResult(output.value.text);
      }

      if (output.value.calls.length === 0) {
        throw new Error("the model returned an empty tool call");
      }

      if (options.toolChoice?.type !== "none") {
        noteCalls(output.value.calls);
      }

      return callResult(output.value.calls);
    },
    async doStream() {
      throw new Error("the model request failed");
    },
  };

  const agent = new ToolLoopAgent({
    model: languageModel,
    instructions: run.persona,
    tools: sdkTools(run.tools, async (item, input, toolCallId) => {
      const call = callsById.get(toolCallId) ?? {
        id: toolCallId,
        name: item.name,
        input,
      };

      if (run.signal.aborted) {
        finish(call, false, "cancelled");

        throw abortError(run.signal);
      }

      if (decisions.get(call.id) === "budget") {
        finish(call, false, budgetSpent);

        throw new Error(budgetSpent);
      }

      const parsed = readToolInput(item, input);

      if (!parsed.ok) {
        finish(call, false, parsed.error.message);

        throw parsed.error;
      }

      const context: ToolContext = {
        request: run.request,
        signal: run.signal,
      };

      const ran = await untilAbort(
        () => item.run(parsed.value, context),
        run.signal,
        "the tool failed",
      );

      if (run.signal.aborted) {
        finish(call, false, "cancelled");

        throw abortError(run.signal);
      }

      if (!ran.ok) {
        finish(call, false, ran.error.message);

        throw ran.error;
      }

      finish(call, true, ran.value);

      return ran.value;
    }),
    toolChoice: run.mode === "say" ? "auto" : "none",
    stopWhen: isStepCount(toolTurnLimit + 1),
    toolCallConcurrency: 1,
    maxRetries: 0,
    prepareStep() {
      if (run.mode !== "say") {
        return { toolChoice: "none" as const };
      }

      if (used >= toolTurnLimit) {
        modelAcceptTools = false;

        return { toolChoice: "none" as const };
      }

      modelAcceptTools = true;

      return { toolChoice: "auto" as const };
    },
    onStepEnd(step) {
      for (const part of step.content) {
        if (part.type !== "tool-error") {
          continue;
        }

        const call = callsById.get(part.toolCallId) ?? {
          id: part.toolCallId,
          name: part.toolName,
          input: "",
        };

        if (decisions.get(call.id) === "budget") {
          finish(call, false, budgetSpent);

          continue;
        }

        if (findTool(run.tools, call.name) === undefined) {
          finish(call, false, `no tool named ${call.name}`);

          continue;
        }

        finish(call, false, causeText(part.error));
      }
    },
  });

  try {
    const result = await agent.generate({
      prompt: run.request.length > 0 ? run.request : " ",
      abortSignal: run.signal,
    });

    if (run.signal.aborted) {
      return fail("cancelled");
    }

    return ok(result.text);
  } catch (cause) {
    if (run.signal.aborted) {
      return fail("cancelled");
    }

    if (ToolChoiceViolationError.isInstance(cause)) {
      if (run.mode === "say") {
        return fail(budgetSpent);
      }

      return fail("the model called a tool");
    }

    return fromCause(cause, "the model request failed");
  }
}

function sdkTools(
  tools: readonly Tool[],
  execute: (tool: Tool, input: string, toolCallId: string) => Promise<string>,
) {
  const set: { [name: string]: ReturnType<typeof bindTool> } = {};

  for (const item of tools) {
    if (set[item.name] !== undefined) {
      continue;
    }

    set[item.name] = bindTool(item, execute);
  }

  return set;
}

function bindTool(
  item: Tool,
  execute: (tool: Tool, input: string, toolCallId: string) => Promise<string>,
) {
  return sdkTool({
    description: `${item.kind}. ${item.description}`,
    inputSchema: toolInput,
    async execute(args, options) {
      return execute(item, args.input, options.toolCallId);
    },
  });
}

function messageResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: emptyUsage(),
    warnings: [],
  };
}

function callResult(calls: readonly ModelCall[]) {
  const content: {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: string;
  }[] = [];

  for (const call of calls) {
    content.push({
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.name,
      input: JSON.stringify({ input: call.input }),
    });
  }

  return {
    content,
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: emptyUsage(),
    warnings: [],
  };
}

function emptyUsage() {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  return new Error("cancelled");
}

function causeText(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }

  return "the tool failed";
}

function readToolInput(tool: Tool, input: string): Result<string> {
  try {
    return tool.parse(input);
  } catch (cause) {
    return fromCause(cause, "the tool failed");
  }
}

function findTool(tools: readonly Tool[], name: string): Tool | undefined {
  for (const tool of tools) {
    if (tool.name === name) {
      return tool;
    }
  }

  return undefined;
}

function copyEvents(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  const copy: TranscriptEvent[] = [];

  for (const event of events) {
    copy.push(event);
  }

  return copy;
}

async function untilAbort<T>(
  start: () => Promise<T>,
  signal: AbortSignal,
  fallback: string,
): Promise<Result<T>> {
  if (signal.aborted) {
    return fail("cancelled");
  }

  let pending: Promise<T>;

  try {
    pending = start();
  } catch (cause) {
    return fromCause(cause, fallback);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: Result<T>) => {
      if (settled) {
        return;
      }

      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => {
      finish(fail("cancelled"));
    };

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    pending.then(
      (value) => {
        if (signal.aborted) {
          finish(fail("cancelled"));

          return;
        }

        finish(ok(value));
      },
      (cause) => {
        if (signal.aborted) {
          finish(fail("cancelled"));

          return;
        }

        finish(fromCause(cause, fallback));
      },
    );
  });
}
