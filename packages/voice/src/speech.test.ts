import { expect, test } from "bun:test";

import { captureListener, type Capture } from "./speech.ts";

test("listen begins and waits until release", async () => {
  const order: string[] = [];
  let releaseBegin = () => {};

  const listener = captureListener({
    begin() {
      order.push("begin");

      return new Promise<void>((resolve) => {
        releaseBegin = resolve;
      });
    },
    async finish() {
      order.push("finish");

      return "  wake up  ";
    },
  });

  const pending = listener.listen();

  expect(order).toEqual(["begin"]);
  releaseBegin();
  await Promise.resolve();
  expect(order).toEqual(["begin"]);
  listener.release();
  await expect(pending).resolves.toEqual({ text: "wake up" });
  expect(order).toEqual(["begin", "finish"]);
});

test("a second listen rejects already listening", async () => {
  const capture = deferredCapture();
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  await expect(listener.listen()).rejects.toThrow("already listening");
  expect(capture.begins()).toBe(1);
  listener.release();
  capture.allowBegin();
  await pending;
  expect(capture.finishes()).toBe(1);
});

test("release with no active listen finishes the next listen after begin", async () => {
  const capture = deferredCapture();
  capture.transcript("  yo  ");
  const listener = captureListener(capture.capture);

  listener.release();
  const pending = listener.listen();

  expect(capture.begins()).toBe(1);
  expect(capture.finishes()).toBe(0);
  capture.allowBegin();
  await expect(pending).resolves.toEqual({ text: "yo" });
  expect(capture.finishes()).toBe(1);

  capture.transcript("next");
  const again = listener.listen();

  capture.allowBegin();
  await Promise.resolve();
  expect(capture.finishes()).toBe(1);
  listener.release();
  await expect(again).resolves.toEqual({ text: "next" });
  expect(capture.finishes()).toBe(2);
});

test("two releases do not finish twice", async () => {
  const capture = deferredCapture();
  capture.transcript("yo");
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  listener.release();
  listener.release();
  expect(capture.finishes()).toBe(0);
  capture.allowBegin();
  await expect(pending).resolves.toEqual({ text: "yo" });
  expect(capture.finishes()).toBe(1);

  const again = listener.listen();

  capture.allowBegin();
  await Promise.resolve();
  listener.release();
  listener.release();
  await expect(again).resolves.toEqual({ text: "yo" });
  expect(capture.finishes()).toBe(2);
});

test("begin rejection rejects listen and does not finish", async () => {
  const capture = deferredCapture();
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  listener.release();
  capture.rejectBegin(new Error("no microphone is available"));
  await expect(pending).rejects.toThrow("no microphone is available");
  expect(capture.finishes()).toBe(0);

  capture.transcript("later");
  const again = listener.listen();

  capture.allowBegin();
  await Promise.resolve();
  listener.release();
  await expect(again).resolves.toEqual({ text: "later" });
  expect(capture.begins()).toBe(2);
  expect(capture.finishes()).toBe(1);
});

test("finish rejection rejects listen", async () => {
  const capture = deferredCapture();
  capture.failFinish(new Error("could not hear"));
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  capture.allowBegin();
  await Promise.resolve();
  listener.release();
  await expect(pending).rejects.toThrow("could not hear");
  expect(capture.finishes()).toBe(1);
  listener.release();
  expect(capture.finishes()).toBe(1);
});

test("a string from finish rejects listen with that message", async () => {
  const listener = captureListener({
    async begin() {},
    finish() {
      return Promise.reject("not listening");
    },
  });

  const pending = listener.listen();

  await Promise.resolve();
  listener.release();
  await expect(pending).rejects.toThrow("not listening");
});

test("blank text from finish resolves empty", async () => {
  const capture = deferredCapture();
  capture.transcript("   ");
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  capture.allowBegin();
  await Promise.resolve();
  listener.release();
  await expect(pending).resolves.toEqual({ text: "" });
});

type BeginGate = {
  resolve: () => void;
  reject: (error: Error) => void;
};

function deferredCapture() {
  let transcript = "";
  let begins = 0;
  let finishes = 0;
  let finishError: Error | undefined;
  const gates: BeginGate[] = [];

  const capture: Capture = {
    begin() {
      begins += 1;

      return new Promise<void>((resolve, reject) => {
        gates.push({ resolve, reject });
      });
    },
    async finish() {
      finishes += 1;

      if (finishError !== undefined) {
        throw finishError;
      }

      return transcript;
    },
  };

  return {
    capture,
    begins: () => begins,
    finishes: () => finishes,
    transcript(text: string) {
      transcript = text;
    },
    failFinish(error: Error) {
      finishError = error;
    },
    allowBegin() {
      const gate = takeGate(gates);

      gate.resolve();
    },
    rejectBegin(error: Error) {
      const gate = takeGate(gates);

      gate.reject(error);
    },
  };
}

function takeGate(gates: BeginGate[]): BeginGate {
  const gate = gates.shift();

  if (gate === undefined) {
    throw new Error("begin was not called");
  }

  return gate;
}
