import { expect, test } from "bun:test";

import { vadThreshold, voiced } from "./vad.ts";

test("sensitivity 0 is stricter than 100", () => {
  expect(vadThreshold(0)).toBeCloseTo(0.08);
  expect(vadThreshold(40)).toBeCloseTo(0.052);
  expect(vadThreshold(100)).toBeCloseTo(0.01);
  expect(vadThreshold(-20)).toBeCloseTo(0.08);
  expect(vadThreshold(140)).toBeCloseTo(0.01);
  expect(vadThreshold(Number.NaN)).toBeCloseTo(0.08);

  const quiet = new Float32Array([0.02, -0.02, 0.02, -0.02]);

  expect(voiced(quiet, 0)).toBe(false);
  expect(voiced(quiet, 100)).toBe(true);
  expect(voiced(new Float32Array(), 40)).toBe(false);
});

test("a frame at the threshold is voiced", () => {
  const level = vadThreshold(40);
  const held = new Float32Array([level, level, level, level]);

  expect(voiced(held, 40)).toBe(true);

  held[0] = 0;
  held[1] = 0;
  expect(voiced(held, 40)).toBe(false);
});
