#[cfg(test)]
pub(super) struct Fresh {
    pub samples: Vec<f32>,
    pub sent: usize,
}

#[cfg(test)]
pub(super) fn stable_resample_len(raw_len: usize, from_rate: u32, to_rate: u32) -> usize {
    if raw_len == 0 || from_rate == 0 || to_rate == 0 {
        return 0;
    }
    if from_rate == to_rate {
        return raw_len;
    }
    if raw_len < 2 {
        return 0;
    }
    let full = (raw_len as u64).saturating_mul(u64::from(to_rate)) / u64::from(from_rate);
    let last = raw_len - 1;
    let mut count = 0usize;
    for index in 0..full as usize {
        let position = index as f64 * f64::from(from_rate) / f64::from(to_rate);
        let left = position.floor() as usize;
        if left + 1 >= last {
            break;
        }
        count = index + 1;
    }
    count
}

#[cfg(test)]
pub(super) fn fresh_samples(
    raw: &[f32],
    from_rate: u32,
    to_rate: u32,
    sent: usize,
    flush: bool,
) -> Fresh {
    if raw.is_empty() || from_rate == 0 || to_rate == 0 {
        return Fresh {
            samples: Vec::new(),
            sent,
        };
    }
    let resampled = resample_linear(raw, from_rate, to_rate);
    let end = if flush {
        resampled.len()
    } else {
        stable_resample_len(raw.len(), from_rate, to_rate).min(resampled.len())
    };
    if sent >= end {
        return Fresh {
            samples: Vec::new(),
            sent,
        };
    }
    Fresh {
        samples: resampled[sent..end].to_vec(),
        sent: end,
    }
}

#[cfg(test)]
pub(super) struct Resampler {
    from_rate: u32,
    to_rate: u32,
    pending: Vec<f32>,
    origin: usize,
    next_out: usize,
}

#[cfg(test)]
impl Resampler {
    pub(super) fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            from_rate,
            to_rate,
            pending: Vec::new(),
            origin: 0,
            next_out: 0,
        }
    }

    pub(super) fn push(&mut self, samples: &[f32], flush: bool) -> Vec<f32> {
        if self.from_rate == 0 || self.to_rate == 0 {
            return Vec::new();
        }
        self.pending.extend_from_slice(samples);
        let total = self.origin + self.pending.len();
        if total == 0 {
            return Vec::new();
        }
        let end = if flush {
            output_len(total, self.from_rate, self.to_rate)
        } else {
            stable_resample_len(total, self.from_rate, self.to_rate)
        };
        let mut out = Vec::new();
        while self.next_out < end {
            out.push(self.at_output(self.next_out, total));
            self.next_out += 1;
        }
        self.discard();
        out
    }

    #[cfg(test)]
    pub(super) fn buffered(&self) -> usize {
        self.pending.len()
    }

    fn at_output(&self, index: usize, total: usize) -> f32 {
        if self.from_rate == self.to_rate {
            return self.at(index, total);
        }
        let position = index as f64 * f64::from(self.from_rate) / f64::from(self.to_rate);
        let last = total - 1;
        let left = (position.floor() as usize).min(last);
        let right = (left + 1).min(last);
        let frac = (position - left as f64) as f32;
        self.at(left, total) * (1.0 - frac) + self.at(right, total) * frac
    }

    fn at(&self, index: usize, total: usize) -> f32 {
        let index = index.min(total - 1);
        self.pending[index - self.origin]
    }

    fn discard(&mut self) {
        if self.pending.is_empty() {
            return;
        }
        let position = if self.from_rate == self.to_rate {
            self.next_out as f64
        } else {
            self.next_out as f64 * f64::from(self.from_rate) / f64::from(self.to_rate)
        };
        let keep = position.floor() as usize;
        if keep <= self.origin {
            return;
        }
        let drop = (keep - self.origin).min(self.pending.len());
        self.pending.drain(..drop);
        self.origin += drop;
    }
}

#[cfg(test)]
fn output_len(input_len: usize, from_rate: u32, to_rate: u32) -> usize {
    if from_rate == to_rate {
        return input_len;
    }
    (input_len as u64)
        .saturating_mul(u64::from(to_rate))
        .saturating_div(u64::from(from_rate)) as usize
}

pub(super) fn encode_wav(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(44 + data_len);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate.saturating_mul(2)).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&pcm_i16(*sample).to_le_bytes());
    }
    bytes
}

fn pcm_i16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * 32767.0;
    scaled.round() as i16
}

pub(super) fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || from_rate == to_rate {
        return samples.to_vec();
    }
    let out_len = (samples.len() as u64)
        .saturating_mul(u64::from(to_rate))
        .saturating_div(u64::from(from_rate)) as usize;
    let mut out = Vec::with_capacity(out_len);
    let last = samples.len() - 1;
    for index in 0..out_len {
        let position = index as f64 * f64::from(from_rate) / f64::from(to_rate);
        let left = (position.floor() as usize).min(last);
        let right = (left + 1).min(last);
        let frac = (position - left as f64) as f32;
        out.push(samples[left] * (1.0 - frac) + samples[right] * frac);
    }
    out
}

#[cfg(test)]
pub(super) fn decode_wav(bytes: &[u8]) -> Result<(u32, Vec<f32>), String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("wav must be 16-bit mono pcm".to_string());
    }
    let mut offset = 12;
    let mut rate = None;
    let mut pcm = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = le_u32(&bytes[offset + 4..offset + 8]) as usize;
        let start = offset + 8;
        if start + size > bytes.len() {
            return Err("wav must be 16-bit mono pcm".to_string());
        }
        let body = &bytes[start..start + size];
        if id == b"fmt " {
            if body.len() < 16 {
                return Err("wav must be 16-bit mono pcm".to_string());
            }
            let format = u16::from_le_bytes([body[0], body[1]]);
            let channels = u16::from_le_bytes([body[2], body[3]]);
            let bits = u16::from_le_bytes([body[14], body[15]]);
            if format != 1 || channels != 1 || bits != 16 {
                return Err("wav must be 16-bit mono pcm".to_string());
            }
            rate = Some(le_u32(&body[4..8]));
        } else if id == b"data" {
            pcm = Some(body);
        }
        offset = start + size + (size % 2);
    }
    let rate = rate.ok_or_else(|| "wav must be 16-bit mono pcm".to_string())?;
    let pcm = pcm.ok_or_else(|| "wav must be 16-bit mono pcm".to_string())?;
    let mut samples = Vec::with_capacity(pcm.len() / 2);
    for chunk in pcm.as_chunks::<2>().0 {
        let value = i16::from_le_bytes(*chunk);
        samples.push(value as f32 / 32767.0);
    }
    Ok((rate, samples))
}

#[cfg(test)]
fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

#[cfg(test)]
#[path = "pcm_test.rs"]
mod tests;
