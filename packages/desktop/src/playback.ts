const playbackFailed = "could not play speech";

const playheadSeconds = 0.032;

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

export function stopPlayback(): void {
  generation += 1;
  const stop = activeStop;

  activeStop = undefined;
  stop?.();
  publish(restFrame());
}

export async function playSpeech(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }

  if (bytes.byteLength === 0) {
    return;
  }

  const mine = generation + 1;
  generation = mine;
  const previous = activeStop;
  activeStop = undefined;
  previous?.();

  const onAbort = () => {
    if (mine === generation) {
      stopPlayback();
    }
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  let context: AudioContext | undefined;

  try {
    context = new AudioContext();
    await resumeContext(context);
    throwIfCancelled(signal);

    if (mine !== generation) {
      return;
    }

    const audio = await context.decodeAudioData(copiedBytes(bytes));
    throwIfCancelled(signal);

    if (mine !== generation) {
      return;
    }

    await playBuffer(context, audio, mine);
    throwIfCancelled(signal);
  } catch (error) {
    if (mine === generation) {
      publish(restFrame());
    }

    if (isCancelled(error) || isPlaybackFailure(error)) {
      throw error;
    }

    throw new Error(playbackFailed);
  } finally {
    signal?.removeEventListener("abort", onAbort);

    if (context !== undefined) {
      await closeContext(context);
    }
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

function isCancelled(value: unknown): value is Error {
  return value instanceof Error && value.message === "cancelled";
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

async function closeContext(context: AudioContext): Promise<void> {
  await context.close().then(
    () => undefined,
    () => undefined,
  );
}

function isPlaybackFailure(value: unknown): value is Error {
  return value instanceof Error && value.message === playbackFailed;
}
