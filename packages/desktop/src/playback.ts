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

export function waveColumns(
  samples: Float32Array,
  columns: number,
): Float32Array {
  const count = columns > 0 ? Math.floor(columns) : 0;
  const peaks = new Float32Array(count);

  if (samples.length === 0 || count === 0) {
    return peaks;
  }

  for (let column = 0; column < count; column += 1) {
    const start = Math.floor((column * samples.length) / count);
    let end = Math.floor(((column + 1) * samples.length) / count);

    if (end <= start) {
      end = start + 1;
    }

    let peak = 0;

    for (let index = start; index < end && index < samples.length; index += 1) {
      const absolute = Math.abs(samples[index] ?? 0);

      if (absolute > peak) {
        peak = absolute;
      }
    }

    peaks[column] = peak > 1 ? 1 : peak;
  }

  return peaks;
}

export function subscribePlayback(hear: (frame: Frame) => void): () => void {
  hearers.add(hear);
  hear(latest);

  return () => {
    hearers.delete(hear);
  };
}

export async function playSpeech(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength === 0) {
    return;
  }

  let context: AudioContext | undefined;

  try {
    context = new AudioContext();
    await resumeContext(context);
    const audio = await context.decodeAudioData(copiedBytes(bytes));
    await playBuffer(context, audio);
  } catch (error) {
    publish(restFrame());

    if (isPlaybackFailure(error)) {
      throw error;
    }

    throw new Error(playbackFailed);
  } finally {
    if (context !== undefined) {
      await closeContext(context);
    }
  }
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

function playBuffer(context: AudioContext, audio: AudioBuffer): Promise<void> {
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
      publish(restFrame());

      if (failed) {
        reject(new Error(playbackFailed));

        return;
      }

      resolve();
    };

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
        if (settled) {
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
