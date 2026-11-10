import { ok, openSession, type Model } from "@caprice/core";
import { recordingSpeaker } from "@caprice/voice";
import { expect, test } from "bun:test";

import {
  openMatchRemarks,
  type RemarkHost,
  type RemarkSpeak,
} from "./matchRemarks.ts";

test("an idle host hears the remark", async () => {
  const recording = recordingSpeaker();
  const speak = started(host(recording.speaker, () => true));

  expect(await speak("Live match. You died.", "You died.")).toBe(true);
  expect(recording.spoken()).toEqual(["Noted."]);
});

test("a busy host skips the line", async () => {
  const recording = recordingSpeaker();
  const model = hangingModel();
  const speak = started(host(recording.speaker, () => false, model.model));

  expect(await speak("Live match. You died.", "You died.")).toBe(false);
  expect(model.calls()).toBe(0);
  expect(recording.spoken()).toEqual([]);
});

test("a missing session skips the line", async () => {
  const recording = recordingSpeaker();
  const life = new AbortController();
  let speak: RemarkSpeak | undefined;

  openMatchRemarks(
    {
      session: () => undefined,
      speaker: recording.speaker,
      idle: () => true,
    },
    life.signal,
  ).follow([
    (say) => {
      speak = say;

      return Promise.resolve();
    },
  ]);

  expect(await mustSpeak(speak)("Live match.", "Quiet.")).toBe(false);
  expect(recording.spoken()).toEqual([]);
  life.abort();
});

test("a second line is skipped while one is speaking", async () => {
  const recording = recordingSpeaker();
  const model = hangingModel();
  const speak = started(host(recording.speaker, () => true, model.model));
  const first = speak("Live match. One.", "One.");
  const second = await speak("Live match. Two.", "Two.");

  expect(second).toBe(false);
  expect(model.calls()).toBe(1);
  model.release();
  expect(await first).toBe(true);
  expect(recording.spoken()).toEqual(["Late."]);
});

test("a press cancels the line and leaves the follower running", async () => {
  const recording = recordingSpeaker();
  const model = hangingModel();
  const opened = host(recording.speaker, () => true, model.model);
  let speak: RemarkSpeak | undefined;
  let follower: AbortSignal | undefined;

  const remarks = openMatchRemarks(opened.host, opened.life.signal);

  remarks.follow([
    (say, signal) => {
      speak = say;
      follower = signal;

      return Promise.resolve();
    },
  ]);

  const first = mustSpeak(speak)("Live match. One.", "One.");

  remarks.stop();
  model.release();

  expect(await first).toBe(false);
  expect(follower?.aborted).toBe(false);
  expect(opened.life.signal.aborted).toBe(false);
  expect(recording.spoken()).toEqual([]);

  expect(await mustSpeak(speak)("Live match. Two.", "Two.")).toBe(true);
  expect(recording.spoken()).toEqual(["Second."]);
  opened.life.abort();
});

function host(
  speaker: RemarkHost["speaker"],
  idle: () => boolean,
  model: Model = {
    async complete() {
      return ok({ kind: "message", text: "Noted." });
    },
  },
) {
  const session = openSession("p", model, []);

  return {
    life: new AbortController(),
    host: {
      session: () => session,
      speaker,
      idle,
    },
  };
}

function started(opened: ReturnType<typeof host>): RemarkSpeak {
  let speak: RemarkSpeak | undefined;

  openMatchRemarks(opened.host, opened.life.signal).follow([
    (say) => {
      speak = say;

      return Promise.resolve();
    },
  ]);

  return mustSpeak(speak);
}

function mustSpeak(speak: RemarkSpeak | undefined): RemarkSpeak {
  if (speak === undefined) {
    throw new Error("the follower did not start");
  }

  return speak;
}

function hangingModel() {
  let calls = 0;
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const model: Model = {
    async complete() {
      calls += 1;

      if (calls === 1) {
        await gate;

        return ok({ kind: "message", text: "Late." });
      }

      return ok({ kind: "message", text: "Second." });
    },
  };

  return {
    calls: () => calls,
    release,
    model,
  };
}
