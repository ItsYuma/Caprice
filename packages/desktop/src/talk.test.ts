import { openSession, stubModel } from "@caprice/core";
import {
  captureListener,
  recordingSpeaker,
  type Capture,
} from "@caprice/voice";
import { expect, test } from "bun:test";

import { listenAndSay } from "./host.ts";
import {
  holdToTalk,
  isTalkChord,
  isTalkRelease,
  talkChordLabel,
  talkChordShortcuts,
  type TalkPhase,
} from "./talk.ts";

const chord = {
  code: "Space",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
};

test("the talk chord is named once", () => {
  expect(talkChordLabel()).toBe("Alt+Space or Ctrl+Space");
  expect(talkChordShortcuts()).toBe("Alt+Space Control+Space");
  expect(isTalkChord(chord)).toBe(true);
  expect(isTalkChord({ ...chord, altKey: false, ctrlKey: true })).toBe(true);
  expect(isTalkChord({ ...chord, altKey: false })).toBe(false);
  expect(isTalkChord({ ...chord, ctrlKey: true })).toBe(false);
  expect(isTalkChord({ ...chord, code: "KeyK" })).toBe(false);
  expect(isTalkChord({ ...chord, metaKey: true })).toBe(false);
  expect(isTalkChord({ ...chord, shiftKey: true })).toBe(false);
  expect(isTalkChord({ ...chord, repeat: true })).toBe(false);
  expect(isTalkRelease({ code: "Space", key: " " })).toBe(true);
  expect(isTalkRelease({ code: "AltLeft", key: "Alt" })).toBe(true);
  expect(isTalkRelease({ code: "ControlLeft", key: "Control" })).toBe(true);
  expect(isTalkRelease({ code: "KeyA", key: "a" })).toBe(false);
});

test("holding the chord sends the heard line through say and the speaker", async () => {
  const manual = heldCapture();
  const listener = captureListener(manual.capture);
  const session = openSession("p", stubModel(), []);
  const recording = recordingSpeaker();
  const phases: TalkPhase[] = [];
  let done = Promise.resolve();

  const hold = holdToTalk(
    listener,
    () => {
      done = listenAndSay(session, listener, recording.speaker).then(() => {});

      return done;
    },
    (phase) => {
      phases.push(phase);
    },
    beginNow,
  );

  hold.press();
  hold.press();
  expect(hold.phase()).toBe("listening");
  manual.say("yo");
  hold.release();
  expect(hold.phase()).toBe("busy");
  await done;
  await Promise.resolve();

  expect(session.lines()[0]).toEqual({ who: "host", text: "yo" });
  expect(recording.spoken()).toEqual(["No model yet. You said: yo"]);
  expect(phases).toEqual(["listening", "busy", "idle"]);
});

test("a tap does not send", () => {
  const manual = heldCapture();
  const listener = captureListener(manual.capture);
  const phases: TalkPhase[] = [];
  let turns = 0;
  let start = () => {};

  const hold = holdToTalk(
    listener,
    () => {
      turns += 1;

      return Promise.resolve();
    },
    (phase) => {
      phases.push(phase);
    },
    (run) => {
      start = run;

      return () => {
        start = () => {};
      };
    },
  );

  hold.press();
  expect(hold.phase()).toBe("idle");
  hold.release();
  start();
  expect(turns).toBe(0);
  expect(phases).toEqual([]);

  hold.press();
  start();
  expect(hold.phase()).toBe("listening");
  expect(turns).toBe(1);
  manual.say("yo");
  hold.release();
  expect(hold.phase()).toBe("busy");
});

function beginNow(run: () => void): () => void {
  run();

  return () => {};
}

function heldCapture() {
  let transcript = "";

  const capture: Capture = {
    async begin() {},
    async finish() {
      return transcript;
    },
  };

  return {
    capture,
    say(text: string) {
      transcript = text;
    },
  };
}
