import { openSession, stubModel } from "@caprice/core";
import { recordingSpeaker, scriptedListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import { listenAndSay, sayAndSpeak } from "./host.ts";

test("sayAndSpeak speaks the capri line", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "yo");

  expect(recording.spoken()).toEqual([line.text]);
});

test("listenAndSay feeds the heard line to say and speaks the reply", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();

  const line = await listenAndSay(
    session,
    scriptedListener(["yo"]),
    recording.speaker,
  );

  expect(line).toEqual({ who: "capri", text: "No model yet. You said: yo" });
  expect(session.lines()).toEqual([
    { who: "host", text: "yo" },
    { who: "capri", text: "No model yet. You said: yo" },
  ]);
  expect(recording.spoken()).toEqual(["No model yet. You said: yo"]);
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
