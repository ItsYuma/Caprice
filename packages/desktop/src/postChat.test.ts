import { expect, test } from "bun:test";

import { completeModel, type ModelCommand } from "./postChat.ts";

test("abort cancels that shell request and ignores a rejected cancel", async () => {
  const controller = new AbortController();
  const ids: string[] = [];
  const cancels: string[] = [];

  const command: ModelCommand = {
    complete(_body, requestId) {
      ids.push(requestId);
      controller.abort();

      return new Promise(() => undefined);
    },
    cancel(requestId) {
      cancels.push(requestId);

      return Promise.reject(new Error("cancel failed"));
    },
  };

  const result = await completeModel(
    command,
    '{"model":"m"}',
    controller.signal,
    5_000,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("cancelled");
  expect(cancels).toEqual(ids);
  expect(ids[0]?.length).toBeGreaterThan(0);
});

test("the deadline cancels the shell request", async () => {
  const ids: string[] = [];
  const cancels: string[] = [];

  const command: ModelCommand = {
    complete(_body, requestId) {
      ids.push(requestId);

      return new Promise(() => undefined);
    },
    async cancel(requestId) {
      cancels.push(requestId);
    },
  };

  const result = await completeModel(
    command,
    "{}",
    new AbortController().signal,
    30,
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("the model timed out");
  expect(cancels).toEqual(ids);
});

test("each shell request has its own id", async () => {
  const ids: string[] = [];

  const command: ModelCommand = {
    async complete(_body, requestId) {
      ids.push(requestId);

      return '{"choices":[]}';
    },
    async cancel() {},
  };

  const signal = new AbortController().signal;

  await completeModel(command, "{}", signal, 1_000);
  await completeModel(command, "{}", signal, 1_000);
  expect(ids[0]).not.toBe(ids[1]);
});
