import { expect, test } from "bun:test";

import {
  amplitudeAt,
  heardAt,
  playSpeech,
  subscribePlayback,
  type Frame,
} from "./playback.ts";
import { radioReply } from "./radio.ts";

const originalAudioContext = Object.getOwnPropertyDescriptor(
  globalThis,
  "AudioContext",
);

test("heardAt is the fraction of the buffer already played", () => {
  expect(heardAt(10, 4, 12)).toBe(0.5);
  expect(heardAt(10, 4, 10)).toBe(0);
  expect(heardAt(10, 4, 9)).toBe(0);
  expect(heardAt(10, 4, 14)).toBe(1);
  expect(heardAt(10, 4, 20)).toBe(1);
  expect(heardAt(0, 8, 2)).toBe(0.25);
  expect(heardAt(5, 0, 5)).toBe(1);
  expect(heardAt(5, 0, 4)).toBe(0);
  expect(heardAt(5, -2, 9)).toBe(1);
});

test("amplitudeAt is the peak in the 32 ms window at the playhead", () => {
  const rate = 1000;
  const samples = new Float32Array(100);
  samples[17] = 1;
  samples[18] = 0.25;
  samples[49] = -0.75;

  expect(amplitudeAt(new Float32Array(), rate, 1)).toBe(0);
  expect(amplitudeAt(samples, 0, 1)).toBe(0);
  expect(amplitudeAt(samples, -10, 1)).toBe(0);
  expect(amplitudeAt(samples, rate, 0)).toBe(0);
  expect(amplitudeAt(samples, rate, 0.5)).toBe(0.75);

  samples[30] = -2;
  expect(amplitudeAt(samples, rate, 0.5)).toBe(1);
});

test("empty speech resolves without drawing", async () => {
  let opened = 0;

  install(
    class {
      constructor() {
        opened += 1;
      }
    },
  );

  try {
    let frames = 0;

    const stop = subscribePlayback(() => {
      frames += 1;
    });

    const baseline = frames;

    await playSpeech(new Uint8Array());
    expect(opened).toBe(0);
    expect(frames).toBe(baseline);
    stop();
  } finally {
    restore();
  }
});

test("playback resolves when the buffer ends", async () => {
  script = "play";
  install(ScriptedContext);

  try {
    const seen: Frame[] = [];
    let ignored = 0;

    const stop = subscribePlayback((frame) => {
      seen.push({
        live: frame.live,
        samples: frame.samples.slice(),
        rate: frame.rate,
        heard: frame.heard,
      });
    });

    const stopIgnored = subscribePlayback(() => {
      ignored += 1;
    });

    const marked = ignored;
    stopIgnored();
    const before = seen.length;

    await playSpeech(new Uint8Array([1, 2, 3, 4]));
    const added = seen.slice(before);
    expect(added.map((frame) => frame.live)).toEqual([true, false]);
    expect(added[0]?.heard).toBe(1);
    expect(added[0]?.rate).toBe(1000);
    expect(Array.from(added[0]?.samples ?? [])).toEqual(
      Array.from(radioReply(new Float32Array([0, 0.5, -1, 0.25]), 1000)),
    );
    expect(ignored).toBe(marked);
    expect(ScriptedContext.latest?.closed).toBe(1);
    expect(ScriptedContext.latest?.started).toBe(1);
    expect(ScriptedContext.latest?.decoded).toBe(4);
    stop();
  } finally {
    restore();
  }
});

test("playback failure rejects could not play speech", async () => {
  install(ScriptedContext);

  try {
    for (const mode of ["resume", "decode", "start"] as const) {
      script = mode;
      const seen: boolean[] = [];

      const stop = subscribePlayback((frame) => {
        seen.push(frame.live);
      });

      await expect(playSpeech(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
        "could not play speech",
      );
      expect(seen.some((live) => live)).toBe(false);
      expect(ScriptedContext.latest?.closed).toBe(1);

      if (mode === "resume") {
        expect(ScriptedContext.latest?.decoded).toBe(0);
      }

      if (mode === "start") {
        expect(ScriptedContext.latest?.started).toBe(0);
      }

      stop();
    }
  } finally {
    restore();
  }

  let opened = 0;

  install(
    class {
      constructor() {
        opened += 1;
        throw new Error("no device");
      }
    },
  );

  try {
    await expect(playSpeech(new Uint8Array([9]))).rejects.toThrow(
      "could not play speech",
    );
    expect(opened).toBe(1);
  } finally {
    restore();
  }
});

test("a device that never opens plays the clip", async () => {
  script = "frozen";
  install(ScriptedContext);
  installFrameHold();
  installClip();

  try {
    const seen: boolean[] = [];

    const stop = subscribePlayback((frame) => {
      seen.push(frame.live);
    });

    await playSpeech(new Uint8Array([1, 2, 3, 4]), undefined, 20);
    expect(seen.includes(true)).toBe(true);
    expect(ScriptedContext.latest?.started).toBe(0);
    expect(ScriptedContext.latest?.decoded).toBe(0);
    expect(ScriptedClip.played).toBe(1);
    stop();
  } finally {
    restore();
    restoreFrame();
    restoreClip();
  }
});

test("a suspended device rejects without playing", async () => {
  script = "stuck";
  install(ScriptedContext);
  installFrame();

  try {
    let live = false;

    const stop = subscribePlayback((frame) => {
      if (frame.live) {
        live = true;
      }
    });

    await expect(playSpeech(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(
      "could not play speech",
    );
    expect(live).toBe(false);
    expect(ScriptedContext.latest?.decoded).toBe(0);
    stop();
  } finally {
    restore();
    restoreFrame();
  }
});

type Script = "play" | "resume" | "decode" | "start" | "stuck" | "frozen";

let script: Script = "play";

class ScriptedBuffer {
  readonly sampleRate: number;
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly channel: Float32Array;

  constructor(channel: Float32Array, sampleRate: number, channels = 1) {
    this.channel = channel;
    this.sampleRate = sampleRate;
    this.length = channel.length;
    this.numberOfChannels = channels;
    this.duration = channel.length / sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    if (channel === 0) {
      return this.channel;
    }

    return new Float32Array();
  }
}

class ScriptedSource {
  buffer: ScriptedBuffer | null = null;
  onended: (() => void) | null = null;

  constructor(private readonly context: ScriptedContext) {}

  connect(): void {}

  disconnect(): void {}

  start(): void {
    if (script === "start") {
      throw new Error("device");
    }

    this.context.started += 1;
    this.context.currentTime += this.buffer?.duration ?? 0;
    queueMicrotask(() => {
      this.onended?.();
    });
  }
}

class ScriptedContext {
  static latest: ScriptedContext | undefined;

  currentTime = 0;
  state: AudioContextState | undefined = undefined;
  readonly destination = {};
  closed = 0;
  decoded = 0;
  started = 0;

  constructor() {
    ScriptedContext.latest = this;
  }

  resume(): Promise<void> {
    if (script === "resume") {
      return Promise.reject(new Error("device"));
    }

    if (script === "stuck" || script === "frozen") {
      if (script === "stuck") {
        this.state = "suspended";
      }

      return new Promise(() => undefined);
    }

    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed += 1;

    return Promise.resolve();
  }

  createBuffer(channels: number, length: number, rate: number): ScriptedBuffer {
    return new ScriptedBuffer(new Float32Array(length), rate, channels);
  }

  decodeAudioData(buffer: ArrayBuffer): Promise<ScriptedBuffer> {
    this.decoded = buffer.byteLength;

    if (script === "decode") {
      return Promise.reject(new Error("decode"));
    }

    return Promise.resolve(
      new ScriptedBuffer(new Float32Array([0, 0.5, -1, 0.25]), 1000),
    );
  }

  createBufferSource(): ScriptedSource {
    return new ScriptedSource(this);
  }
}

const originalFrame = Object.getOwnPropertyDescriptor(
  globalThis,
  "requestAnimationFrame",
);

class ScriptedClip {
  static played = 0;

  play(): Promise<void> {
    ScriptedClip.played += 1;
    queueMicrotask(() => {
      this.onended?.();
    });

    return Promise.resolve();
  }

  pause(): void {}

  addEventListener(kind: string, listener: () => void): void {
    if (kind === "ended") {
      this.onended = listener;
    }
  }

  private onended: (() => void) | undefined;
}

const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function installClip(): void {
  ScriptedClip.played = 0;

  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    writable: true,
    value: ScriptedClip,
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:caprice",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

function restoreClip(): void {
  if (originalAudio === undefined) {
    Reflect.deleteProperty(globalThis, "Audio");
  } else {
    Object.defineProperty(globalThis, "Audio", originalAudio);
  }

  if (originalCreate === undefined) {
    Reflect.deleteProperty(URL, "createObjectURL");
  } else {
    Object.defineProperty(URL, "createObjectURL", originalCreate);
  }

  if (originalRevoke === undefined) {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  } else {
    Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
  }
}

function installFrameHold(): void {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => 1,
  });
}

function installFrame(): void {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: (time: number) => void) => {
      queueMicrotask(() => {
        callback(0);
      });

      return 1;
    },
  });
}

function restoreFrame(): void {
  if (originalFrame === undefined) {
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    return;
  }

  Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame);
}

function install(constructor: new () => object): void {
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    writable: true,
    value: constructor,
  });
}

function restore(): void {
  if (originalAudioContext === undefined) {
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    return;
  }

  Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
}
