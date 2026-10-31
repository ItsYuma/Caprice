import { expect, test } from "bun:test";

import { openSession, stubModel, type Model, type Tool } from "./session.ts";

test("say records the host line and the capri line", async () => {
  let persona = "";

  const model: Model = {
    async reply(turn) {
      persona = turn.persona;

      return { text: "hi" };
    },
  };

  const session = openSession("be capri", model, []);
  const line = await session.say("wake up");

  expect(persona).toBe("be capri");
  expect(line).toEqual({ who: "capri", text: "hi" });
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
  await session.say("a");
  const lines = session.lines();
  const tools = session.tools();

  expect(lines).not.toBe(session.lines());
  expect(lines).toEqual(session.lines());
  expect(tools).not.toBe(session.tools());
  expect(tools.map((item) => item.name)).toEqual(["note"]);
});

test("stub model quotes the host", async () => {
  const session = openSession("p", stubModel(), []);
  const line = await session.say("hello");

  expect(line.text).toContain("hello");
});
