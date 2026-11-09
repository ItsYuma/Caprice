import { readToolCall } from "./call.ts";
import { ok, type Result } from "./result.ts";

export type Who = "host" | "capri";

export type Line = {
  who: Who;
  text: string;
};

export type ModelTurn = {
  persona: string;
  lines: readonly Line[];
  hostText: string;
};

export type ModelReply = {
  text: string;
};

export type Model = {
  reply: (turn: ModelTurn) => Promise<Result<ModelReply>>;
};

export type Tool = {
  name: string;
  run: (input: string) => Promise<string>;
};

export type Session = {
  lines: () => readonly Line[];
  tools: () => readonly Tool[];
  say: (hostText: string) => Promise<Result<Line>>;
};

export const threadLimit = 20;
export const toolTurnLimit = 4;

export function openSession(
  persona: string,
  model: Model,
  tools: readonly Tool[],
  remembered: readonly Line[] = [],
): Session {
  const lines: Line[] = [];
  const offered = tools.slice();
  let working = false;

  for (const line of remembered) {
    lines.push({ who: line.who, text: line.text });
  }

  trimThread(lines);

  async function speakReply(callsLeft: number): Promise<Result<Line>> {
    const reply = await model.reply({
      persona,
      lines: lines.slice(),
      hostText: lastHostText(lines),
    });

    if (!reply.ok) {
      return reply;
    }

    const call = readToolCall(reply.value.text);
    const tool = call === undefined ? undefined : findTool(offered, call.name);

    if (call !== undefined && tool !== undefined) {
      if (callsLeft === 0) {
        return fail("too many tool calls");
      }

      let result: string;

      try {
        result = await tool.run(call.input);
      } catch (caught) {
        if (caught instanceof Error) {
          return fail(caught.message);
        }

        return fail("the tool failed");
      }

      lines.push({ who: "host", text: `tool ${call.name}\n${result}` });
      trimThread(lines);

      return speakReply(callsLeft - 1);
    }

    const capriLine: Line = { who: "capri", text: reply.value.text };
    lines.push(capriLine);
    trimThread(lines);

    return ok(capriLine);
  }

  return {
    lines: () => lines.slice(),
    tools: () => offered.slice(),
    async say(hostText: string) {
      if (working) {
        return fail("still working");
      }

      working = true;

      try {
        lines.push({ who: "host", text: hostText });
        trimThread(lines);

        return await speakReply(toolTurnLimit);
      } finally {
        working = false;
      }
    },
  };
}

function findTool(tools: readonly Tool[], name: string): Tool | undefined {
  for (const tool of tools) {
    if (tool.name === name) {
      return tool;
    }
  }

  return undefined;
}

function lastHostText(lines: readonly Line[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    if (line !== undefined && line.who === "host") {
      return line.text;
    }
  }

  return "";
}

function trimThread(lines: Line[]): void {
  const extra = lines.length - threadLimit;

  if (extra > 0) {
    lines.splice(0, extra);
  }
}

function fail<T>(message: string): Result<T> {
  return { ok: false, error: new Error(message) };
}

export function stubModel(): Model {
  return {
    async reply(turn) {
      return ok({ text: `No model yet. You said: ${turn.hostText}` });
    },
  };
}
