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

export function openSession(
  persona: string,
  model: Model,
  tools: readonly Tool[],
  remembered: readonly Line[] = [],
): Session {
  const lines: Line[] = [];

  for (const line of remembered) {
    lines.push({ who: line.who, text: line.text });
  }

  trimThread(lines);

  return {
    lines: () => lines.slice(),
    tools: () => tools.slice(),
    async say(hostText: string) {
      lines.push({ who: "host", text: hostText });
      trimThread(lines);

      const reply = await model.reply({
        persona,
        lines: lines.slice(),
        hostText,
      });

      if (!reply.ok) {
        return reply;
      }

      const capriLine: Line = { who: "capri", text: reply.value.text };
      lines.push(capriLine);
      trimThread(lines);

      return ok(capriLine);
    },
  };
}

function trimThread(lines: Line[]): void {
  const extra = lines.length - threadLimit;

  if (extra > 0) {
    lines.splice(0, extra);
  }
}

export function stubModel(): Model {
  return {
    async reply(turn) {
      return ok({ text: `No model yet. You said: ${turn.hostText}` });
    },
  };
}
