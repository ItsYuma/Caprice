import { expect, test } from "bun:test";

import { recordingSpeaker, scriptedListener } from "./ports.ts";

test("scripted listener yields each line once", async () => {
  const listener = scriptedListener(["wake up", "again"]);

  expect(await listener.listen()).toEqual({ text: "wake up" });
  expect(await listener.listen()).toEqual({ text: "again" });
  expect(listener.listen()).rejects.toThrow("no more lines");
});

test("recording speaker keeps a copy of what it said", async () => {
  const recording = recordingSpeaker();
  await recording.speaker.speak("hey");
  const spoken = recording.spoken();

  expect(spoken).not.toBe(recording.spoken());
  expect(spoken).toEqual(["hey"]);
});
