import { captureListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import {
  formatPace,
  paceListener,
  paceText,
  type PaceMark,
  type PaceSlot,
} from "./pace.ts";

test("pace text names each wait", () => {
  expect(formatPace(0)).toBe("0ms");
  expect(formatPace(240)).toBe("240ms");
  expect(formatPace(1200)).toBe("1.2s");
  expect(formatPace(12400)).toBe("12s");
  expect(
    paceText([
      { name: "hear", ms: 1400 },
      { name: "reply", ms: 400 },
      { name: "voice", ms: 8100 },
    ]),
  ).toBe("hear 1.4s · reply 400ms · voice 8.1s");
});

test("a broken clock still lets the hold finish", async () => {
  let finished = false;

  const listener = paceListener(
    captureListener({
      async begin() {},
      async finish() {
        finished = true;

        return "hello";
      },
    }),
    {
      current: {
        begin() {
          throw new Error("clock");
        },
        end() {},
      },
    },
    () => {
      throw new Error("clock");
    },
  );

  const pending = listener.listen();

  listener.release();
  await pending;

  expect(finished).toBe(true);
});

test("hear starts when the hold releases", async () => {
  let time = 100;
  const marks: PaceMark[] = [];
  let resolveFinish = (_text: string) => {};
  let started = () => {};

  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });

  const note: PaceSlot = {
    current: {
      begin() {},
      end(name, ms) {
        marks.push({ name, ms });
      },
    },
  };

  const listener = paceListener(
    captureListener({
      async begin() {},
      finish() {
        return new Promise<string>((resolve) => {
          resolveFinish = resolve;
          started();
        });
      },
    }),
    note,
    () => time,
  );

  const pending = listener.listen();

  time = 150;
  listener.release();
  await ready;
  time = 400;
  resolveFinish("hello");
  await pending;

  expect(marks).toEqual([{ name: "hear", ms: 250 }]);
});
