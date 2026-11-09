import { expect, test } from "bun:test";

import { ok } from "./result.ts";
import {
  openSession,
  stubModel,
  threadLimit,
  toolTurnLimit,
  type Line,
  type Model,
  type Tool,
} from "./session.ts";

test("say records the host line and the capri line", async () => {
  let persona = "";

  const model: Model = {
    async reply(turn) {
      persona = turn.persona;

      return ok({ text: "hi" });
    },
  };

  const session = openSession("be capri", model, []);
  const line = await session.say("wake up");

  expect(persona).toBe("be capri");
  expect(line).toEqual({ ok: true, value: { who: "capri", text: "hi" } });
  expect(session.lines()).toEqual([
    { who: "host", text: "wake up" },
    { who: "capri", text: "hi" },
  ]);
});

test("lines and tools are copies", async () => {
  const tool: Tool = {
    name: "note",
    async run(input) {
      return input;
    },
  };

  const session = openSession("p", stubModel(), [tool]);
  const said = await session.say("a");

  expect(said.ok).toBe(true);
  const lines = session.lines();
  const tools = session.tools();

  expect(lines).not.toBe(session.lines());
  expect(lines).toEqual(session.lines());
  expect(tools).not.toBe(session.tools());
  expect(tools.map((item) => item.name)).toEqual(["note"]);
});

test("a saved thread comes back and stays within the limit", async () => {
  const seen: Line[][] = [];

  const model: Model = {
    async reply(turn) {
      seen.push(turn.lines.slice());

      return ok({ text: "n" });
    },
  };

  const prior: Line[] = [];

  for (let index = 0; index < 12; index += 1) {
    prior.push({ who: "host", text: `h${index}` });
    prior.push({ who: "capri", text: `c${index}` });
  }

  const session = openSession("p", model, [], prior);

  expect(session.lines()).toHaveLength(threadLimit);
  expect(session.lines()[0]).toEqual({ who: "host", text: "h2" });
  await session.say("next");
  expect(seen[0]?.at(-1)).toEqual({ who: "host", text: "next" });
  expect(session.lines()).toHaveLength(threadLimit);
  expect(prior).toHaveLength(24);
});

test("stub model quotes the host", async () => {
  const session = openSession("p", stubModel(), []);
  const line = await session.say("hello");

  expect(line.ok).toBe(true);

  if (!line.ok) {
    return;
  }

  expect(line.value.text).toContain("hello");
});

test("a tool call runs and the answer after the result is the reply", async () => {
  const seen: string[] = [];
  const turns: string[] = [];
  const replies = ["call note\nhi", "call note\nagain", "done"];

  const model: Model = {
    async reply(turn) {
      turns.push(turn.lines.map((line) => line.text).join(" | "));

      return ok({ text: replies.shift() ?? "empty" });
    },
  };

  const session = openSession("p", model, [
    {
      name: "note",
      async run(input) {
        seen.push(input);

        return `saw ${input}`;
      },
    },
  ]);

  const answered = await session.say("look");

  expect(seen).toEqual(["hi", "again"]);
  expect(answered).toEqual({ ok: true, value: { who: "capri", text: "done" } });
  expect(session.lines()).toEqual([
    { who: "host", text: "look" },
    { who: "host", text: "tool note\nsaw hi" },
    { who: "host", text: "tool note\nsaw again" },
    { who: "capri", text: "done" },
  ]);
  expect(turns[1]).toContain("tool note\nsaw hi");
  expect(turns[2]).toContain("tool note\nsaw again");
});

test("a turn stops after the tool limit", async () => {
  let runs = 0;
  const replies: string[] = [];

  for (let index = 0; index < toolTurnLimit + 1; index += 1) {
    replies.push("call note hi");
  }

  const model: Model = {
    async reply() {
      return ok({ text: replies.shift() ?? "empty" });
    },
  };

  const session = openSession("p", model, [
    {
      name: "note",
      async run() {
        runs += 1;

        return "ran";
      },
    },
  ]);

  const line = await session.say("look");

  expect(runs).toBe(toolTurnLimit);
  expect(line.ok).toBe(false);

  if (line.ok) {
    return;
  }

  expect(line.error.message).toBe("too many tool calls");
});

test("a tool that throws fails the turn", async () => {
  const session = openSession(
    "p",
    {
      async reply() {
        return ok({ text: "call note hi" });
      },
    },
    [
      {
        name: "note",
        async run() {
          throw new Error("note broke");
        },
      },
    ],
  );

  const line = await session.say("look");

  expect(line.ok).toBe(false);

  if (line.ok) {
    return;
  }

  expect(line.error.message).toBe("note broke");
  expect(session.lines()).toEqual([{ who: "host", text: "look" }]);
});

test("a call for an unknown tool is spoken", async () => {
  const session = openSession(
    "p",
    {
      async reply() {
        return ok({ text: "call me later" });
      },
    },
    [],
  );

  const line = await session.say("hey");

  expect(line).toEqual({
    ok: true,
    value: { who: "capri", text: "call me later" },
  });
});
