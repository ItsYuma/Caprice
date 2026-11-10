const voiceSemitones = 2;

const echoSeconds = 0.04;

const echoGains = [10 ** (-10 / 20), 10 ** (-16 / 20)];

const tremoloHertz = 80;

const tremoloWetPercent = 15;

const grainSeconds = 0.04;

const tremoloDepth = tremoloWetPercent / 200;

const tremoloOffset = 1 - tremoloDepth;

export function radioReply(samples: Float32Array, rate: number): Float32Array {
  if (samples.length === 0 || !(rate > 0)) {
    return samples;
  }

  const voice = raisePitch(samples, rate, voiceSemitones);
  const delay = Math.round(echoSeconds * rate);
  let length = voice.length;

  for (let echo = 0; echo < echoGains.length; echo += 1) {
    const end = (echo + 1) * delay + voice.length;

    if (end > length) {
      length = end;
    }
  }

  const mixed = new Float32Array(length);

  for (let index = 0; index < voice.length; index += 1) {
    mixed[index] = voice[index] ?? 0;
  }

  for (let echo = 0; echo < echoGains.length; echo += 1) {
    const gain = echoGains[echo] ?? 0;
    const offset = (echo + 1) * delay;

    for (let index = 0; index < voice.length; index += 1) {
      const at = offset + index;
      mixed[at] = (mixed[at] ?? 0) + (voice[index] ?? 0) * gain;
    }
  }

  const step = (Math.PI * 2 * tremoloHertz) / rate;

  for (let index = 0; index < length; index += 1) {
    const wobble = tremoloOffset - tremoloDepth * Math.cos(step * index);
    mixed[index] = clampUnit((mixed[index] ?? 0) * wobble);
  }

  return mixed;
}

export function raisePitch(
  samples: Float32Array,
  rate: number,
  semitones: number,
): Float32Array {
  if (samples.length === 0 || !(rate > 0) || semitones <= 0) {
    return samples;
  }

  const ratio = 2 ** (semitones / 12);
  let grain = Math.max(32, Math.round(rate * grainSeconds));

  if (grain % 2 === 1) {
    grain += 1;
  }

  if (samples.length < grain * 2) {
    return samples;
  }

  const shifted = new Float32Array(samples.length);
  const step = ratio - 1;
  let delayA = grain * 0.25;
  let delayB = grain * 0.75;

  for (let index = 0; index < samples.length; index += 1) {
    const weightA = triangle(delayA / grain);
    const weightB = triangle(delayB / grain);
    const cover = weightA + weightB;

    const pitched =
      cover > 0
        ? (readAt(samples, index - delayA) * weightA +
            readAt(samples, index - delayB) * weightB) /
          cover
        : 0;

    const dry = samples[index] ?? 0;

    if (index < grain) {
      const fade = index / grain;
      shifted[index] = dry * (1 - fade) + pitched * fade;
    } else {
      shifted[index] = pitched;
    }

    delayA = wrap(delayA - step, grain);
    delayB = wrap(delayB - step, grain);
  }

  return shifted;
}

function triangle(phase: number): number {
  return 1 - Math.abs(2 * phase - 1);
}

function wrap(delay: number, grain: number): number {
  let next = delay % grain;

  if (next < 0) {
    next += grain;
  }

  return next;
}

function readAt(samples: Float32Array, position: number): number {
  if (!(position >= 0)) {
    return 0;
  }

  const last = samples.length - 1;
  const left = Math.min(Math.floor(position), last);
  const right = Math.min(left + 1, last);
  const frac = position - Math.floor(position);
  const sample = samples[left] ?? 0;
  const next = samples[right] ?? sample;

  return sample * (1 - frac) + next * frac;
}

function clampUnit(sample: number): number {
  if (sample > 1) {
    return 1;
  }

  if (sample < -1) {
    return -1;
  }

  return sample;
}
