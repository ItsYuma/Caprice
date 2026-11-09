pub(super) struct Fresh {
    pub samples: Vec<f32>,
    pub sent: usize,
}

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

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

#[cfg(test)]
#[path = "pcm_test.rs"]
mod tests;
