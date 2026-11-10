import { openSession, stubModel } from "@caprice/core";
import {
  captureListener,
  recordingSpeaker,
  type Capture,
} from "@caprice/voice";
import { expect, test } from "bun:test";

import { listenAndSay } from "./host.ts";
import {
  bindTalkButton,
  dragInsteadOfTalk,
  bindCancel,
  bindTalk,
  holdToTalk,
  isTalkChord,
  pointerMoved,
  releasesChord,
  talkChordLabel,
  talkChordShortcuts,
  talkDragDistance,
  type TalkPhase,
  type TalkTarget,
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
  expect(releasesChord("alt", { code: "Space", key: " " })).toBe(true);
  expect(releasesChord("ctrl", { code: "Space", key: " " })).toBe(true);
  expect(releasesChord("alt", { code: "AltLeft", key: "Alt" })).toBe(true);
  expect(releasesChord("ctrl", { code: "AltLeft", key: "Alt" })).toBe(false);
  expect(releasesChord("ctrl", { code: "ControlLeft", key: "Control" })).toBe(
    true,
  );
  expect(releasesChord("alt", { code: "ControlLeft", key: "Control" })).toBe(
    false,
  );
  expect(releasesChord("alt", { code: "KeyA", key: "a" })).toBe(false);
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
      done = listenAndSay(
        session,
        listener,
        recording.speaker,
        new AbortController().signal,
      ).then(() => {});

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

  expect(session.events()[0]).toEqual({ kind: "user", text: "yo" });
  expect(recording.spoken()).toEqual(["No model yet. You said: yo"]);
  expect(phases).toEqual(["armed", "listening", "busy", "idle"]);
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
  expect(hold.phase()).toBe("armed");
  hold.release();
  start();
  expect(turns).toBe(0);
  expect(hold.phase()).toBe("idle");
  expect(phases).toEqual(["armed", "idle"]);

  hold.press();
  start();
  expect(hold.phase()).toBe("listening");
  expect(turns).toBe(1);
  manual.say("yo");
  hold.release();
  expect(hold.phase()).toBe("busy");
});

test("a move before listening drags the window and does not send", () => {
  expect(pointerMoved(0, 0, 3, 4)).toBe(false);
  expect(pointerMoved(0, 0, talkDragDistance, 0)).toBe(false);
  expect(pointerMoved(0, 0, talkDragDistance + 1, 0)).toBe(true);
  expect(pointerMoved(2, 5, 8, 11)).toBe(true);
  expect(dragInsteadOfTalk("idle", true)).toBe(true);
  expect(dragInsteadOfTalk("armed", true)).toBe(true);
  expect(dragInsteadOfTalk("busy", true)).toBe(true);
  expect(dragInsteadOfTalk("listening", true)).toBe(false);
  expect(dragInsteadOfTalk("idle", false)).toBe(false);

  const box = talkBox();
  let turns = 0;
  let drags = 0;
  let start = () => {};

  const hold = holdToTalk(
    captureListener(heldCapture().capture),
    () => {
      turns += 1;

      return Promise.resolve();
    },
    () => {},
    (run) => {
      start = run;

      return () => {
        start = () => {};
      };
    },
  );

  bindTalkButton(box.button, hold, () => {
    drags += 1;
  });

  box.fire(press("pointerdown", 10, 20));
  box.fire(press("pointermove", 12, 21));
  expect(drags).toBe(0);
  expect(turns).toBe(0);
  box.fire(press("pointermove", 10 + talkDragDistance + 1, 20));
  start();
  box.fire(press("pointerup", 30, 20));
  expect(drags).toBe(1);
  expect(turns).toBe(0);
  expect(hold.phase()).toBe("idle");
});

test("a still hold on the box still listens", () => {
  const box = talkBox();
  let start = () => {};
  let drags = 0;

  const hold = holdToTalk(
    captureListener(heldCapture().capture),
    () => Promise.resolve(),
    () => {},
    (run) => {
      start = run;

      return () => {
        start = () => {};
      };
    },
  );

  bindTalkButton(box.button, hold, () => {
    drags += 1;
  });

  box.fire(press("pointerdown", 4, 4));
  box.fire(press("pointermove", 6, 5));
  start();
  expect(hold.phase()).toBe("listening");
  expect(drags).toBe(0);
  box.fire(press("pointermove", 40, 40));
  expect(drags).toBe(0);
  expect(hold.phase()).toBe("listening");
  box.fire(press("pointerup", 40, 40));
  expect(hold.phase()).toBe("busy");
});

function talkBox() {
  const listeners = new Map<string, (event: Event) => void>();
  let captured: number | undefined;

  const button: TalkTarget = {
    setPointerCapture(pointerId) {
      captured = pointerId;
    },
    releasePointerCapture(pointerId) {
      if (captured === pointerId) {
        captured = undefined;
      }
    },
    hasPointerCapture(pointerId) {
      return captured === pointerId;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
  };

  return {
    button,
    fire(event: Event) {
      const listener = listeners.get(event.type);

      if (listener !== undefined) {
        listener(event);
      }
    },
  };
}

function press(type: string, x: number, y: number): Event {
  const moving = type === "pointermove";
  const released = type === "pointerup" || type === "pointercancel";

  return Object.assign(new Event(type), {
    button: moving ? -1 : 0,
    buttons: released ? 0 : 1,
    clientX: x,
    clientY: y,
    pointerId: 1,
  });
}

test("an unrelated modifier does not release the active chord", () => {
  const target = new EventTarget();
  const phases: TalkPhase[] = [];
  let releases = 0;

  const hold = holdToTalk(
    captureListener({
      async begin() {},
      async finish() {
        return "";
      },
      async cancel() {},
    }),
    () =>
      new Promise((resolve) => {
        resolve();
      }),
    (phase) => {
      phases.push(phase);
    },
    beginNow,
  );

  bindTalk(hold, target);
  target.dispatchEvent(key("keydown", { code: "Space", ctrlKey: true }));
  expect(hold.phase()).toBe("listening");
  target.dispatchEvent(key("keyup", { code: "AltLeft", key: "Alt" }));
  expect(hold.phase()).toBe("listening");
  expect(releases).toBe(0);
  target.dispatchEvent(key("keyup", { code: "ControlLeft", key: "Control" }));
  expect(hold.phase()).toBe("busy");
});

test("a rejected turn returns to idle", async () => {
  const phases: TalkPhase[] = [];

  const hold = holdToTalk(
    captureListener({
      async begin() {},
      async finish() {
        return "";
      },
      async cancel() {},
    }),
    () => Promise.reject(new Error("no")),
    (phase) => {
      phases.push(phase);
    },
    beginNow,
  );

  hold.press();
  await Promise.resolve();
  await Promise.resolve();
  expect(hold.phase()).toBe("idle");
  expect(phases).toEqual(["armed", "listening", "idle"]);
});

test("escape cancels through the bound target", () => {
  const target = new EventTarget();
  let cancels = 0;

  const stop = bindCancel(target, () => {
    cancels += 1;
  });

  target.dispatchEvent(key("keydown", { code: "Escape" }));
  target.dispatchEvent(key("keydown", { code: "Escape", repeat: true }));
  target.dispatchEvent(key("keydown", { code: "KeyK" }));
  expect(cancels).toBe(1);
  stop();
  target.dispatchEvent(key("keydown", { code: "Escape" }));
  expect(cancels).toBe(1);
});

function key(
  type: string,
  fields: {
    code: string;
    key?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    repeat?: boolean;
  },
): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    code: fields.code,
    key: fields.key ?? "",
    altKey: fields.altKey ?? false,
    ctrlKey: fields.ctrlKey ?? false,
    metaKey: false,
    shiftKey: false,
    repeat: fields.repeat ?? false,
  });
}

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
    async cancel() {},
  };

  return {
    capture,
    say(text: string) {
      transcript = text;
    },
  };
}
