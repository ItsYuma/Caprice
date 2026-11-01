import { openSession, stubModel } from "@caprice/core";
import { expect, test } from "bun:test";
import { recordingSpeaker } from "@caprice/voice";

import { sayAndSpeak } from "./host.ts";

test("sayAndSpeak speaks the capri line", async () => {
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const line = await sayAndSpeak(session, recording.speaker, "yo");

  expect(recording.spoken()).toEqual([line.text]);
});
