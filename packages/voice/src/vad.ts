export function vadThreshold(sensitivity: number): number {
  const clamped = clampSensitivity(sensitivity);

  return 0.08 - (clamped / 100) * 0.07;
}

export function voiced(samples: Float32Array, sensitivity: number): boolean {
  if (samples.length === 0) {
    return false;
  }

  let sum = 0;

  for (const sample of samples) {
    sum += sample * sample;
  }

  const rms = Math.sqrt(sum / samples.length);

  return rms >= vadThreshold(sensitivity);
}

function clampSensitivity(sensitivity: number): number {
  if (!Number.isFinite(sensitivity)) {
    return 0;
  }

  if (sensitivity < 0) {
    return 0;
  }

  if (sensitivity > 100) {
    return 100;
  }

  return sensitivity;
}
