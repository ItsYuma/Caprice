import { ok, openSession, stubModel, type Model } from "@caprice/core";
import { recordingSpeaker, scriptedListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import { listenAndSay, sayAndSpeak, type TurnPace } from "./host.ts";
import type { PaceMark, PaceNote } from "./pace.ts";

test("a tool call is not spoken", async () => {
  const model: Model = {
    async reply() {
      return ok({ text: "call note\nhi" });
    },
  };

  const session = openSession("p", model, [
    {
      name: "note",
      async run(input) {
        return input;
      },
    },
  ]);

  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "look");

  expect(line).toEqual({ ok: true, value: { who: "capri", text: "" } });
  expect(recording.spoken()).toEqual([]);
  expect(session.pending()).toEqual({ name: "note", input: "hi" });
});

test("sayAndSpeak speaks the capri line", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "yo");

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
  );

  expect(line).toEqual({
    ok: true,
    value: { who: "capri", text: "No model yet. You said: yo" },
  });
  expect(session.lines()).toEqual([
    { who: "host", text: "yo" },
    { who: "capri", text: "No model yet. You said: yo" },
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
  );

  expect(line).toBeUndefined();
  expect(session.lines()).toEqual([]);
  expect(recording.spoken()).toEqual([]);
});
