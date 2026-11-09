pub(super) fn stable_resample_len(samples: usize, from_rate: u32, to_rate: u32) -> usize {
    if samples == 0 || from_rate == 0 || from_rate == to_rate {
        return samples;
    }
    let out_len = (samples as u64)
        .saturating_mul(u64::from(to_rate))
        .saturating_div(u64::from(from_rate)) as usize;
    if out_len == 0 {
        return 0;
    }
    let last = (samples - 1) as f64;
    let mut lo = 0;
    let mut hi = out_len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let position = mid as f64 * f64::from(from_rate) / f64::from(to_rate);
        if position <= last {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
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
