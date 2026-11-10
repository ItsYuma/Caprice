import { captureListener } from "@caprice/voice";
import { expect, test } from "bun:test";

import { paceListener, type PaceMark, type PaceSlot } from "./pace.ts";

test("a broken clock still lets the hold finish", async () => {
  let finished = false;

  const listener = paceListener(
    captureListener({
      async begin() {},
      async finish() {
        finished = true;

        return "hello";
      },
      async cancel() {},
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
      async cancel() {},
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
