import { runLoop, toolTurnLimit } from "./loop.ts";
import { fail, ok, type Result } from "./result.ts";
import {
  clipText,
  conversationEvents,
  threadSizeLimit,
  toolResultLimit,
  trimTranscript,
  type AssistantEvent,
  type TranscriptEvent,
} from "./transcript.ts";
import type { Tool, ToolSpec } from "./tool.ts";

export { toolTurnLimit };

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
  notice: (hostText: string) => Promise<Result<AssistantEvent>>;
  direct: (
    hostText: string,
    cue: string,
    fallback: string,
  ) => Promise<Result<AssistantEvent>>;
  cancel: () => void;
};

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

  function record(call: ModelCall, succeeded: boolean, text: string): void {
    events.push({
      kind: "tool-call",
      id: call.id,
      name: call.name,
      input: clipText(call.input, toolResultLimit),
    });
    events.push({
      kind: "tool-result",
      id: call.id,
      name: call.name,
      ok: succeeded,
      text: clipText(text, toolResultLimit),
    });
    trimTranscript(events);
  }

  function ignore(): void {
    return;
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
    async notice(hostText: string) {
      if (turn.status !== "idle") {
        return fail("still working");
      }

      generation += 1;
      const mine = generation;
      const controller = new AbortController();

      turn = { status: "running", generation: mine, controller };

      const request = clipText(hostText, threadSizeLimit);
      const seen = copyEvents(events);

      seen.push({ kind: "user", text: request });

      try {
        const reply = await runLoop({
          mode: "refused",
          persona,
          request,
          signal: controller.signal,
          model,
          tools: offered,
          events: () => seen,
          record: ignore,
        });

        if (!running(mine)) {
          return fail("cancelled");
        }

        if (!reply.ok) {
          return reply;
        }

        return ok({ kind: "assistant", text: reply.value });
      } finally {
        if (current(mine)) {
          turn = { status: "idle" };
        }
      }
    },
    async direct(hostText: string, cue: string, fallback: string) {
      if (turn.status !== "idle") {
        return fail("still working");
      }

      generation += 1;
      const mine = generation;
      const controller = new AbortController();

      turn = { status: "running", generation: mine, controller };

      const request = clipText(hostText, threadSizeLimit);
      const aside = clipText(cue, threadSizeLimit);
      const spare = clipText(fallback, threadSizeLimit);

      events.push({ kind: "user", text: request });
      trimTranscript(events);

      try {
        const seen = copyEvents(events);

        if (aside.length > 0) {
          seen.push({ kind: "user", text: aside });
        }

        const reply = await runLoop({
          mode: "refused",
          persona,
          request,
          signal: controller.signal,
          model,
          tools: offered,
          events: () => seen,
          record: ignore,
        });

        if (!running(mine)) {
          return fail("cancelled");
        }

        if (reply.ok && reply.value.trim().length > 0) {
          const assistant: AssistantEvent = {
            kind: "assistant",
            text: reply.value,
          };

          events.push(assistant);
          trimTranscript(events);

          return ok(assistant);
        }

        if (!running(mine)) {
          return fail("cancelled");
        }

        if (spare.length === 0) {
          if (!reply.ok) {
            return reply;
          }

          return fail("the model called a tool");
        }

        const assistant: AssistantEvent = {
          kind: "assistant",
          text: spare,
        };

        events.push(assistant);
        trimTranscript(events);

        return ok(assistant);
      } finally {
        if (current(mine)) {
          turn = { status: "idle" };
        }
      }
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
        const reply = await runLoop({
          mode: "say",
          persona,
          request,
          signal: controller.signal,
          model,
          tools: offered,
          events: () => events,
          record,
        });

        if (!running(mine)) {
          return fail("cancelled");
        }

        if (!reply.ok) {
          return reply;
        }

        const assistant: AssistantEvent = {
          kind: "assistant",
          text: reply.value,
        };

        events.push(assistant);
        trimTranscript(events);

        return ok(assistant);
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

function copyEvents(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  const copy: TranscriptEvent[] = [];

  for (const event of events) {
    copy.push(event);
  }

  return copy;
}
