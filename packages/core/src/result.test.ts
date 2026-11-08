import { expect, test } from "bun:test";

import { tryCatch } from "./result.ts";

test("tryCatch returns the resolved value", async () => {
  const result = await tryCatch(Promise.resolve("yo"), "failed");

  expect(result).toEqual({ ok: true, value: "yo" });
});

test("tryCatch keeps an Error rejection", async () => {
  const result = await tryCatch(Promise.reject(new Error("down")), "failed");

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("down");
});

test("tryCatch wraps a string rejection", async () => {
  const result = await tryCatch(
    Promise.reject("model request failed: 500"),
    "failed",
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("model request failed: 500");
});

test("tryCatch uses the fallback for anything else", async () => {
  const result = await tryCatch(
    Promise.reject(null),
    "the model request failed",
  );

  expect(result.ok).toBe(false);

  if (result.ok) {
    return;
  }

  expect(result.error.message).toBe("the model request failed");
});
