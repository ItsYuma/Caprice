import {
  ok,
  openSession,
  stubModel,
  type Model,
  type ModelOutput,
  type Tool,
} from "@caprice/core";
import { recordingSpeaker, scriptedListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import { listenAndSay, sayAndSpeak, type TurnPace } from "./host.ts";
import type { PaceMark, PaceNote } from "./pace.ts";

const signal = new AbortController().signal;

test("a tool call is not spoken", async () => {
  const replies: ModelOutput[] = [
    {
      kind: "calls",
      calls: [{ id: "1", name: "note", input: "hi" }],
    },
    { kind: "message", text: "noted" },
  ];

  const model: Model = {
    async complete() {
      return ok(replies.shift() ?? { kind: "message", text: "empty" });
    },
  };

  const session = openSession("p", model, [noteTool(async (input) => input)]);

  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "look", signal);

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "noted" },
  });
  expect(recording.spoken()).toEqual(["noted"]);
});

test("sayAndSpeak speaks the capri line", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "yo", signal);

  expect(line.ok).toBe(true);

  if (!line.ok) {
    return;
  }

  expect(recording.spoken()).toEqual([line.value.text]);
});

test("listenAndSay feeds the heard line to say and speaks the reply", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();

  const line = await listenAndSay(
    session,
    scriptedListener(["yo"]),
    recording.speaker,
    signal,
  );

  expect(line).toEqual({
    ok: true,
    value: { kind: "assistant", text: "No model yet. You said: yo" },
  });
  expect(session.events()).toEqual([
    { kind: "user", text: "yo" },
    { kind: "assistant", text: "No model yet. You said: yo" },
  ]);
  expect(recording.spoken()).toEqual(["No model yet. You said: yo"]);
});

test("reply and voice are timed apart from playback", async () => {
  const session = openSession("p", stubModel(), []);
  const marks: PaceMark[] = [];
  let time = 10;

  const note: PaceNote = {
    begin() {},
    end(name, ms) {
      marks.push({ name, ms });
    },
  };

  const pace: TurnPace = {
    note,
    now: () => time,
    watchVoice(ready) {
      ready(40);

      return () => {};
    },
  };

  time = 25;

  const line = await sayAndSpeak(
    session,
    {
      async speak() {
        time = 90;
      },
    },
    "yo",
    signal,
    pace,
  );

  expect(line.ok).toBe(true);
  expect(marks).toEqual([
    { name: "reply", ms: 0 },
    { name: "voice", ms: 40 },
  ]);
});

test("listenAndSay drops a blank transcript before say", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();

  const line = await listenAndSay(
    session,
    scriptedListener(["   "]),
    recording.speaker,
    signal,
  );

  expect(line).toBeUndefined();
  expect(session.events()).toEqual([]);
  expect(recording.spoken()).toEqual([]);
});

function noteTool(run: (input: string) => Promise<string>): Tool {
  return {
    name: "note",
    description: "Keep a note.",
    kind: "read",
    parse(input) {
      return ok(input);
    },
    async run(input) {
      return run(input);
    },
  };
}
