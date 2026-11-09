import { expect, test } from "bun:test";

import { ok } from "./result.ts";
import {
  openSession,
  stubModel,
  threadLimit,
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

test("a tool call waits and does not run until the host allows it", async () => {
  const seen: string[] = [];
  const turns: string[] = [];
  const replies = ["call note\nhi", "done"];

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

  const asked = await session.say("look");

  expect(asked).toEqual({ ok: true, value: { who: "capri", text: "" } });
  expect(session.pending()).toEqual({ name: "note", input: "hi" });
  expect(session.lines()).toEqual([{ who: "host", text: "look" }]);
  expect(seen).toEqual([]);

  const answered = await session.allow();

  expect(seen).toEqual(["hi"]);
  expect(answered).toEqual({ ok: true, value: { who: "capri", text: "done" } });
  expect(session.pending()).toBeUndefined();
  expect(session.lines()).toEqual([
    { who: "host", text: "look" },
    { who: "host", text: "tool note\nsaw hi" },
    { who: "capri", text: "done" },
  ]);
  expect(turns[1]).toContain("tool note\nsaw hi");
});

test("refuse and a later question do not run the tool", async () => {
  let runs = 0;
  const replies = ["call note\nhi", "left it", "call note\nhi", "weather"];

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

  await session.say("look");
  const refused = await session.refuse();

  expect(runs).toBe(0);
  expect(refused).toEqual({
    ok: true,
    value: { who: "capri", text: "left it" },
  });
  expect(session.lines().map((line) => line.text)).toContain(
    "tool note\nrefused",
  );

  await session.say("look");
  const moved = await session.say("what's the score");

  expect(runs).toBe(0);
  expect(moved.ok).toBe(true);

  if (!moved.ok) {
    return;
  }

  expect(moved.value.text).toBe("weather");
});

test("yes runs the waiting tool and no does not", async () => {
  let runs = 0;
  const replies = ["call note\nhi", "ran it", "call note\nhi", "left it"];

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

  await session.say("look");
  const allowed = await session.say("yes");

  expect(runs).toBe(1);
  expect(allowed).toEqual({
    ok: true,
    value: { who: "capri", text: "ran it" },
  });

  await session.say("look");
  const refused = await session.say("no");

  expect(runs).toBe(1);
  expect(refused).toEqual({
    ok: true,
    value: { who: "capri", text: "left it" },
  });
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
  expect(session.pending()).toBeUndefined();
});

test("allow with nothing waiting is an error", async () => {
  const session = openSession("p", stubModel(), []);
  const allowed = await session.allow();

  expect(allowed.ok).toBe(false);

  if (allowed.ok) {
    return;
  }

  expect(allowed.error.message).toBe("nothing to confirm");
});
