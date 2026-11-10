import { fail, fromCause, ok, type Result } from "./result.ts";
import {
  clipText,
  conversationEvents,
  threadSizeLimit,
  toolResultLimit,
  trimTranscript,
  type AssistantEvent,
  type TranscriptEvent,
} from "./transcript.ts";
import {
  toolSpecs,
  type Tool,
  type ToolContext,
  type ToolSpec,
} from "./tool.ts";

export type ModelCall = {
  id: string;
  name: string;
  input: string;
};

export type ModelOutput =
  | { kind: "message"; text: string }
  | { kind: "calls"; calls: readonly ModelCall[] };

export type ModelTurn = {
  persona: string;
  request: string;
  events: readonly TranscriptEvent[];
  tools: readonly ToolSpec[];
  acceptTools: boolean;
  signal: AbortSignal;
};

export type Model = {
  complete: (turn: ModelTurn) => Promise<Result<ModelOutput>>;
};

export type Session = {
  events: () => readonly TranscriptEvent[];
  tools: () => readonly Tool[];
  say: (hostText: string) => Promise<Result<AssistantEvent>>;
  cancel: () => void;
};

export const toolTurnLimit = 4;

const budgetSpent = "too many tool calls";

type IdleTurn = {
  status: "idle";
};

type ActiveTurn = {
  status: "running" | "cancelling";
  generation: number;
  controller: AbortController;
};

type TurnState = IdleTurn | ActiveTurn;

export function openSession(
  persona: string,
  model: Model,
  tools: readonly Tool[],
  remembered: readonly TranscriptEvent[] = [],
): Session {
  const events: TranscriptEvent[] = [];
  const offered = tools.slice();
  let generation = 0;
  let turn: TurnState = { status: "idle" };

  for (const event of conversationEvents(remembered)) {
    events.push(event);
  }

  trimTranscript(events);

  function current(mine: number): boolean {
    return turn.status !== "idle" && turn.generation === mine;
  }

  function running(mine: number): boolean {
    return turn.status === "running" && turn.generation === mine;
  }

  async function run(
    mine: number,
    signal: AbortSignal,
    request: string,
  ): Promise<Result<AssistantEvent>> {
    let used = 0;

    for (let round = 0; round <= toolTurnLimit; round += 1) {
      if (!running(mine)) {
        return fail("cancelled");
      }

      const acceptTools = used < toolTurnLimit;
      const reply = await completeTurn(mine, signal, request, acceptTools);

      if (!running(mine)) {
        return fail("cancelled");
      }

      if (!reply.ok) {
        return reply;
      }

      if (reply.value.kind === "message") {
        const assistant: AssistantEvent = {
          kind: "assistant",
          text: reply.value.text,
        };

        events.push(assistant);
        trimTranscript(events);

        return ok(assistant);
      }

      if (reply.value.calls.length === 0) {
        return fail("the model returned an empty tool call");
      }

      if (!acceptTools) {
        return fail(budgetSpent);
      }

      for (const call of reply.value.calls) {
        if (!running(mine)) {
          return fail("cancelled");
        }

        if (used >= toolTurnLimit) {
          rememberCall(call);
          pushResult(call, false, budgetSpent);

          continue;
        }

        used += 1;
        const ran = await runCall(mine, call, request, signal);

        if (!ran.ok) {
          return ran;
        }
      }
    }

    return fail(budgetSpent);
  }

  async function completeTurn(
    mine: number,
    signal: AbortSignal,
    request: string,
    acceptTools: boolean,
  ): Promise<Result<ModelOutput>> {
    if (!running(mine)) {
      return fail("cancelled");
    }

    const settled = await untilAbort(
      () =>
        model.complete({
          persona,
          request,
          events: copyEvents(events),
          tools: toolSpecs(offered),
          acceptTools,
          signal,
        }),
      signal,
      "the model request failed",
    );

    if (!running(mine)) {
      return fail("cancelled");
    }

    if (!settled.ok) {
      return settled;
    }

    return settled.value;
  }

  async function runCall(
    mine: number,
    call: ModelCall,
    request: string,
    signal: AbortSignal,
  ): Promise<Result<boolean>> {
    if (!running(mine)) {
      return fail("cancelled");
    }

    rememberCall(call);

    const tool = findTool(offered, call.name);

    if (tool === undefined) {
      pushResult(call, false, `no tool named ${call.name}`);

      return ok(true);
    }

    const parsed = readToolInput(tool, call.input);

    if (!parsed.ok) {
      pushResult(call, false, parsed.error.message);

      return ok(true);
    }

    if (!running(mine)) {
      pushResult(call, false, "cancelled");

      return fail("cancelled");
    }

    const context: ToolContext = { request, signal };

    const ran = await untilAbort(
      () => tool.run(parsed.value, context),
      signal,
      "the tool failed",
    );

    if (!running(mine)) {
      if (ran.ok) {
        pushResult(call, true, ran.value);
      } else {
        pushResult(call, false, "cancelled");
      }

      return fail("cancelled");
    }

    if (!ran.ok) {
      pushResult(call, false, ran.error.message);

      return ok(true);
    }

    pushResult(call, true, ran.value);

    return ok(true);
  }

  function rememberCall(call: ModelCall): void {
    events.push({
      kind: "tool-call",
      id: call.id,
      name: call.name,
      input: clipText(call.input, toolResultLimit),
    });
  }

  function pushResult(call: ModelCall, succeeded: boolean, text: string): void {
    events.push({
      kind: "tool-result",
      id: call.id,
      name: call.name,
      ok: succeeded,
      text: clipText(text, toolResultLimit),
    });
    trimTranscript(events);
  }

  return {
    events: () => copyEvents(events),
    tools: () => offered.slice(),
    cancel() {
      if (turn.status !== "running") {
        return;
      }

      turn.controller.abort();
      turn = {
        status: "cancelling",
        generation: turn.generation,
        controller: turn.controller,
      };
    },
    async say(hostText: string) {
      if (turn.status !== "idle") {
        return fail("still working");
      }

      generation += 1;
      const mine = generation;
      const controller = new AbortController();

      turn = { status: "running", generation: mine, controller };

      const request = clipText(hostText, threadSizeLimit);

      events.push({ kind: "user", text: request });
      trimTranscript(events);

      try {
        return await run(mine, controller.signal, request);
      } finally {
        if (current(mine)) {
          turn = { status: "idle" };
        }
      }
    },
  };
}

export function stubModel(): Model {
  return {
    async complete(turn) {
      return ok({
        kind: "message",
        text: `No model yet. You said: ${turn.request}`,
      });
    },
  };
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
