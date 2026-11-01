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
  reply: (turn: ModelTurn) => Promise<ModelReply>;
};

export type Tool = {
  name: string;
  run: (input: string) => Promise<string>;
};

export type Session = {
  lines: () => readonly Line[];
  tools: () => readonly Tool[];
  say: (hostText: string) => Promise<Line>;
};

export function openSession(
  persona: string,
  model: Model,
  tools: readonly Tool[],
): Session {
  const lines: Line[] = [];

  return {
    lines: () => lines.slice(),
    tools: () => tools.slice(),
    async say(hostText: string) {
      lines.push({ who: "host", text: hostText });

      const reply = await model.reply({
        persona,
        lines: lines.slice(),
        hostText,
      });

      const capriLine: Line = { who: "capri", text: reply.text };
      lines.push(capriLine);

      return capriLine;
    },
  };
}

export function stubModel(): Model {
  return {
    async reply(turn) {
      return { text: `No model yet. You said: ${turn.hostText}` };
    },
  };
}
