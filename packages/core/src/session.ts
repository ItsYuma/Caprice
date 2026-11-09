import { confirmKind, readToolCall, type ToolCall } from "./call.ts";
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
  pending: () => ToolCall | undefined;
  say: (hostText: string) => Promise<Result<Line>>;
  allow: () => Promise<Result<Line>>;
  refuse: () => Promise<Result<Line>>;
};

export const threadLimit = 20;

export function openSession(
  persona: string,
  model: Model,
  tools: readonly Tool[],
  remembered: readonly Line[] = [],
): Session {
  const lines: Line[] = [];
  const offered = tools.slice();
  let pending: ToolCall | undefined;
  let working = false;

  for (const line of remembered) {
    lines.push({ who: line.who, text: line.text });
  }

  trimThread(lines);

  async function speakReply(): Promise<Result<Line>> {
    const reply = await model.reply({
      persona,
      lines: lines.slice(),
      hostText: lastHostText(lines),
    });

    if (!reply.ok) {
      return reply;
    }

    const call = readToolCall(reply.value.text);

    if (call !== undefined && findTool(offered, call.name) !== undefined) {
      pending = { name: call.name, input: call.input };

      return ok({ who: "capri", text: "" });
    }

    pending = undefined;
    const capriLine: Line = { who: "capri", text: reply.value.text };
    lines.push(capriLine);
    trimThread(lines);

    return ok(capriLine);
  }

  async function perform(call: ToolCall): Promise<Result<Line>> {
    const tool = findTool(offered, call.name);

    if (tool === undefined) {
      return fail("no such tool");
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

    pending = undefined;
    lines.push({ who: "host", text: `tool ${call.name}\n${result}` });
    trimThread(lines);

    return speakReply();
  }

  async function turn(hostText: string): Promise<Result<Line>> {
    const waiting = pending;
    lines.push({ who: "host", text: hostText });
    trimThread(lines);

    if (waiting !== undefined && confirmKind(hostText) === "allow") {
      return perform(waiting);
    }

    if (waiting !== undefined && confirmKind(hostText) === "refuse") {
      pending = undefined;
      lines.push({ who: "host", text: `tool ${waiting.name}\nrefused` });
      trimThread(lines);

      return speakReply();
    }

    pending = undefined;

    return speakReply();
  }

  return {
    lines: () => lines.slice(),
    tools: () => offered.slice(),
    pending: () =>
      pending === undefined
        ? undefined
        : { name: pending.name, input: pending.input },
    async say(hostText: string) {
      if (working) {
        return fail("still working");
      }

      working = true;

      try {
        return await turn(hostText);
      } finally {
        working = false;
      }
    },
    async allow() {
      if (working) {
        return fail("still working");
      }

      const waiting = pending;

      if (waiting === undefined) {
        return fail("nothing to confirm");
      }

      working = true;

      try {
        return await perform(waiting);
      } finally {
        working = false;
      }
    },
    async refuse() {
      if (working) {
        return fail("still working");
      }

      const waiting = pending;

      if (waiting === undefined) {
        return fail("nothing to confirm");
      }

      working = true;

      try {
        pending = undefined;
        lines.push({ who: "host", text: `tool ${waiting.name}\nrefused` });
        trimThread(lines);

        return await speakReply();
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
