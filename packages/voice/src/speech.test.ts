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
    async cancel() {},
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
    async cancel() {},
  });

  const pending = listener.listen();

  await Promise.resolve();
  listener.release();
  await expect(pending).rejects.toThrow("not listening");
});

test("cancel rejects the listen and does not transcribe it", async () => {
  const capture = deferredCapture();
  capture.transcript("stale");
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  listener.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(capture.finishes()).toBe(0);
  expect(capture.cancels()).toBe(0);
  capture.allowBegin();
  await flush();
  expect(capture.finishes()).toBe(0);
  expect(capture.cancels()).toBe(1);

  capture.transcript("fresh");
  const again = listener.listen();

  capture.allowBegin();
  await flush();
  listener.release();
  await expect(again).resolves.toEqual({ text: "fresh" });
  expect(capture.finishes()).toBe(1);
  expect(capture.cancels()).toBe(1);
});

test("cancel before listen does not finish the next clip early", async () => {
  const capture = deferredCapture();
  capture.transcript("yo");
  const listener = captureListener(capture.capture);

  listener.release();
  listener.cancel();
  const pending = listener.listen();

  capture.allowBegin();
  await flush();
  expect(capture.finishes()).toBe(0);
  listener.release();
  await expect(pending).resolves.toEqual({ text: "yo" });
});

test("a finish after cancel does not satisfy a later listen", async () => {
  const capture = deferredCapture();
  capture.transcript("stale");
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  capture.allowBegin();
  await flush();
  listener.release();
  listener.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(capture.finishes()).toBe(1);
  expect(capture.cancels()).toBe(1);

  capture.transcript("next");
  const again = listener.listen();

  await flush();
  capture.allowBegin();
  await flush();
  expect(capture.finishes()).toBe(1);
  listener.release();
  await expect(again).resolves.toEqual({ text: "next" });
});

test("the next listen waits until cancel has finished", async () => {
  const capture = deferredCapture();
  capture.holdCancel();
  const listener = captureListener(capture.capture);
  const pending = listener.listen();

  capture.allowBegin();
  await flush();
  listener.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(capture.cancels()).toBe(1);

  capture.transcript("next");
  const again = listener.listen();

  await flush();
  expect(capture.begins()).toBe(1);
  capture.releaseCancel();
  await flush();
  expect(capture.begins()).toBe(2);
  capture.allowBegin();
  await flush();
  listener.release();
  await expect(again).resolves.toEqual({ text: "next" });
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
  let cancels = 0;
  let finishError: Error | undefined;
  let releaseCancel = () => {};
  let holdCancel = false;
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
    cancel() {
      cancels += 1;

      if (!holdCancel) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        releaseCancel = resolve;
      });
    },
  };

  return {
    capture,
    begins: () => begins,
    finishes: () => finishes,
    cancels: () => cancels,
    holdCancel() {
      holdCancel = true;
    },
    releaseCancel() {
      holdCancel = false;
      releaseCancel();
    },
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function takeGate(gates: BeginGate[]): BeginGate {
  const gate = gates.shift();

  if (gate === undefined) {
    throw new Error("begin was not called");
  }

  return gate;
}
