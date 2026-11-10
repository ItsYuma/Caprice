import { expect, test } from "bun:test";

import { radioReply, raisePitch } from "./radio.ts";

test("an empty or untimed buffer is left as it is", () => {
  const samples = new Float32Array([0.25]);
  const empty = new Float32Array();

  expect(radioReply(empty, 24_000)).toBe(empty);
  expect(radioReply(samples, 0)).toBe(samples);
  expect(radioReply(samples, Number.NaN)).toBe(samples);
});

test("the source samples stay put", () => {
  const samples = new Float32Array([0.2, -0.2]);
  const copy = samples.slice();

  radioReply(samples, 16_000);

  expect(Array.from(samples)).toEqual(Array.from(copy));
});

test("the echo length rounds to the nearest sample", () => {
  const colored = radioReply(new Float32Array([1]), 44_100);

  expect(colored.length).toBe(1 + 1_764 * 2);
});

test("two quiet echoes follow a click and a third does not", () => {
  const rate = 48_000;
  const colored = radioReply(new Float32Array([1]), rate);
  const delay = 1_920;

  expect(colored.length).toBe(1 + delay * 2);
  expect(bare(colored, 0, rate)).toBeCloseTo(1, 4);
  expect(bare(colored, delay, rate)).toBeCloseTo(10 ** (-10 / 20), 4);
  expect(bare(colored, delay * 2, rate)).toBeCloseTo(10 ** (-16 / 20), 4);
});

test("before the echo, tremolo dips to 85 percent and the peak stays unity", () => {
  const rate = 16_000;
  const samples = new Float32Array(200);
  samples[100] = -0.4;
  const colored = radioReply(samples, rate);

  expect(colored[0]).toBeCloseTo(0, 6);
  expect(colored[100]).toBeCloseTo(-0.4, 5);
});

test("a full-scale echo stays inside the unit range", () => {
  const rate = 16_000;
  const positive = new Float32Array(800);
  const negative = new Float32Array(800);
  positive.fill(1);
  negative.fill(-1);
  const up = radioReply(positive, rate);
  const down = radioReply(negative, rate);

  expect(peak(up)).toBe(1);
  expect(up[500]).toBe(1);
  expect(peak(down)).toBe(1);
  expect(down[500]).toBe(-1);
});

test("a sustained tone is raised two semitones and keeps its length", () => {
  const rate = 16_000;
  const hz = 200;
  const samples = tone(hz, rate, 0.6);
  const raised = raisePitch(samples, rate, 2);
  const target = hz * 2 ** (2 / 12);

  expect(raised.length).toBe(samples.length);
  expect(Math.abs(dominantHz(raised, rate) - target)).toBeLessThan(8);
  expect(rms(raised)).toBeGreaterThan(rms(samples) * 0.6);
  expect(rms(raised)).toBeLessThan(rms(samples) * 1.4);
});

test("coloring ten seconds of audio stays under a second", () => {
  const rate = 48_000;
  const samples = new Float32Array(rate * 10);
  samples[0] = 0.5;
  const started = performance.now();
  const colored = radioReply(samples, rate);
  const elapsed = performance.now() - started;

  expect(colored.length).toBeGreaterThanOrEqual(samples.length);
  expect(colored.length - samples.length).toBeLessThan(rate);
  expect(elapsed).toBeLessThan(1_000);
});

function bare(samples: Float32Array, index: number, rate: number): number {
  const depth = 15 / 200;

  const wobble =
    1 - depth - depth * Math.cos((Math.PI * 2 * 80 * index) / rate);

  return (samples[index] ?? 0) / wobble;
}

function tone(hz: number, rate: number, seconds: number): Float32Array {
  const length = Math.round(rate * seconds);
  const samples = new Float32Array(length);
  const step = (Math.PI * 2 * hz) / rate;

  for (let index = 0; index < length; index += 1) {
    samples[index] = 0.5 * Math.sin(step * index);
  }

  return samples;
}

function dominantHz(samples: Float32Array, rate: number): number {
  const start = Math.round(rate * 0.08);
  const end = samples.length - start;
  const minLag = Math.round(rate / 400);
  const maxLag = Math.round(rate / 140);
  let bestLag = minLag;
  let best = Number.NEGATIVE_INFINITY;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;

    for (let index = start; index < end - lag; index += 2) {
      corr += (samples[index] ?? 0) * (samples[index + lag] ?? 0);
    }

    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }

  return rate / bestLag;
}

function rms(samples: Float32Array): number {
  let sum = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples.length);
}

function peak(samples: Float32Array): number {
  let loudest = 0;

  for (const sample of samples) {
    loudest = Math.max(loudest, Math.abs(sample));
  }

  return loudest;
}
