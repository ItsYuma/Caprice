const playbackFailed = "could not play speech";

const playheadSeconds = 0.032;

const deviceLimit = 1500;

export type Frame = {
  live: boolean;
  samples: Float32Array;
  rate: number;
  heard: number;
};

const hearers = new Set<(frame: Frame) => void>();

let latest = restFrame();
let generation = 0;
let activeStop: (() => void) | undefined;

export function heardAt(
  startedAt: number,
  duration: number,
  now: number,
): number {
  if (!(duration > 0)) {
    return now < startedAt ? 0 : 1;
  }

  const elapsed = (now - startedAt) / duration;

  if (elapsed <= 0) {
    return 0;
  }

  if (elapsed >= 1) {
    return 1;
  }

  return elapsed;
}

export function amplitudeAt(
  samples: Float32Array,
  rate: number,
  heard: number,
): number {
  if (samples.length === 0 || !(rate > 0) || !(heard > 0)) {
    return 0;
  }

  const end = Math.min(
    samples.length,
    Math.max(0, Math.round(heard * samples.length)),
  );

  const width = Math.max(1, Math.round(rate * playheadSeconds));
  const start = Math.max(0, end - width);
  let peak = 0;

  for (let index = start; index < end; index += 1) {
    const absolute = Math.abs(samples[index] ?? 0);

    if (absolute > peak) {
      peak = absolute;
    }
  }

  if (peak > 1) {
    return 1;
  }

  return peak;
}

export function subscribePlayback(hear: (frame: Frame) => void): () => void {
  hearers.add(hear);
  hear(latest);

  return () => {
    hearers.delete(hear);
  };
}

export async function playSpeech(
  bytes: Uint8Array,
  limit = deviceLimit,
): Promise<void> {
  if (bytes.byteLength === 0) {
    return;
  }

  const mine = generation + 1;
  generation = mine;
  releaseActive();

  const held: Held = { context: undefined };
  let opened: Opened | "stale" | undefined;

  try {
    opened = await firstReady(openDevice(bytes, mine, held), limit);
  } catch (error) {
    releaseDevice(held);

    if (mine === generation) {
      publish(restFrame());
    }

    if (isPlaybackFailure(error)) {
      throw error;
    }

    throw new Error(playbackFailed);
  }

  if (opened === undefined) {
    retire(mine);
    releaseDevice(held);
    await playClip(bytes);

    return;
  }

  if (opened === "stale") {
    releaseDevice(held);

    return;
  }

  try {
    await playBuffer(opened.context, opened.audio, mine);
  } catch (error) {
    if (mine === generation) {
      publish(restFrame());
    }

    if (isPlaybackFailure(error)) {
      throw error;
    }

    throw new Error(playbackFailed);
  } finally {
    releaseDevice({ context: opened.context });
  }
}

type Held = {
  context: AudioContext | undefined;
};

type Opened = {
  context: AudioContext;
  audio: AudioBuffer;
};

function releaseActive(): void {
  const previous = activeStop;

  activeStop = undefined;
  previous?.();
}

function retire(mine: number): void {
  if (generation === mine) {
    generation = mine + 1;
  }
}

function releaseDevice(held: Held): void {
  const context = held.context;

  held.context = undefined;

  if (context !== undefined) {
    closeContext(context);
  }
}

function firstReady<T>(
  pending: Promise<T>,
  limit: number,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(undefined);
    }, limit);

    pending.then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function openDevice(
  bytes: Uint8Array,
  mine: number,
  held: Held,
): Promise<Opened | "stale"> {
  const context = new AudioContext();

  held.context = context;
  await resumeContext(context);

  if (mine !== generation) {
    return "stale";
  }

  const audio = await context.decodeAudioData(copiedBytes(bytes));

  if (mine !== generation) {
    return "stale";
  }

  return { context, audio };
}

function playClip(bytes: Uint8Array): Promise<void> {
  const mine = generation + 1;

  generation = mine;

  const url = URL.createObjectURL(new Blob([copiedBytes(bytes)]));
  const audio = new Audio(url);

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (failed: boolean) => {
      if (settled) {
        return;
      }

      settled = true;

      if (activeStop === stop) {
        activeStop = undefined;
      }

      URL.revokeObjectURL(url);

      if (mine === generation) {
        publish(restFrame());
      }

      if (failed) {
        reject(new Error(playbackFailed));

        return;
      }

      resolve();
    };

    const stop = () => {
      audio.pause();
      finish(false);
    };

    activeStop = stop;
    audio.addEventListener("ended", () => {
      finish(false);
    });
    audio.addEventListener("error", () => {
      finish(true);
    });

    void audio.play().then(
      () => undefined,
      () => {
        finish(true);
      },
    );

    if (!settled && mine === generation) {
      publish({
        live: true,
        samples: new Float32Array(),
        rate: 0,
        heard: 0,
      });
    }
  });
}

function publish(frame: Frame): void {
  latest = frame;

  for (const hear of hearers) {
    hear(frame);
  }
}

function restFrame(): Frame {
  return {
    live: false,
    samples: new Float32Array(),
    rate: 0,
    heard: 0,
  };
}

function copiedBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);

  return copy;
}

function playBuffer(
  context: AudioContext,
  audio: AudioBuffer,
  mine: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const source = context.createBufferSource();
    let frameId: number | undefined;
    let settled = false;

    const stopClock = () => {
      if (frameId === undefined) {
        return;
      }

      cancelAnimationFrame(frameId);
      frameId = undefined;
    };

    const finish = (failed: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      stopClock();
      source.onended = null;
      source.disconnect();

      if (mine === generation) {
        activeStop = undefined;
        publish(restFrame());
      }

      if (failed) {
        reject(new Error(playbackFailed));

        return;
      }

      resolve();
    };

    const stop = () => {
      try {
        source.stop();
      } catch {
        finish(false);
      }
    };

    activeStop = stop;

    source.onended = () => {
      finish(false);
    };

    try {
      const samples = audio.getChannelData(0).slice();
      const rate = audio.sampleRate;
      const duration = audio.duration;
      const startedAt = context.currentTime;
      source.buffer = audio;
      source.connect(context.destination);
      source.start();

      const tick = () => {
        if (settled || mine !== generation) {
          return;
        }

        const heard = heardAt(startedAt, duration, context.currentTime);
        publish({ live: true, samples, rate, heard });

        if (heard < 1) {
          frameId = requestAnimationFrame(tick);
        }
      };

      tick();
    } catch {
      finish(true);
    }
  });
}

function resumeContext(context: AudioContext): Promise<void> {
  if (context.state === "running") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let frames = 0;

    const succeed = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    const fail = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(playbackFailed));
    };

    context.resume().then(
      () => {
        if (context.state === "suspended" || context.state === "closed") {
          fail();

          return;
        }

        succeed();
      },
      () => {
        fail();
      },
    );

    const watch = () => {
      if (settled) {
        return;
      }

      if (context.state === "running") {
        succeed();

        return;
      }

      frames += 1;

      if (
        frames >= 30 &&
        (context.state === "suspended" || context.state === "closed")
      ) {
        fail();

        return;
      }

      requestAnimationFrame(watch);
    };

    try {
      requestAnimationFrame(watch);
    } catch {
      return;
    }
  });
}

function closeContext(context: AudioContext): void {
  void context.close().then(
    () => undefined,
    () => undefined,
  );
}

function isPlaybackFailure(value: unknown): value is Error {
  return value instanceof Error && value.message === playbackFailed;
}
