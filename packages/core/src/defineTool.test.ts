import { expect, test } from "bun:test";
import { z } from "zod";

import { ok } from "./result.ts";
import { openSession, type Model } from "./session.ts";
import { defineTool } from "./tool.ts";

test("defineTool returns canonical json and runs the parsed value", async () => {
  let seen = "";

  const note = defineTool({
    name: "note",
    description: "Keep a note.",
    kind: "read",
    schema: z.object({ text: z.string() }),
    async run(value) {
      seen = value.text;

      return value.text;
    },
  });

  expect(note.parse('{"skip":true,"text":"hi"}')).toEqual({
    ok: true,
    value: '{"text":"hi"}',
  });
  expect(note.parse("no").ok).toBe(false);

  const model: Model = {
    async complete(turn) {
      const last = turn.events.at(-1);

      if (last?.kind === "tool-result") {
        return ok({ kind: "message", text: "done" });
      }

      return ok({
        kind: "calls",
        calls: [{ id: "1", name: "note", input: '{"text":"hi"}' }],
      });
    },
  };

  const line = await openSession("p", model, [note]).say("look");

  expect(seen).toBe("hi");
  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "done" },
  });
});
