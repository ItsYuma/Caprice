pub(super) fn threshold(sensitivity: f32) -> f32 {
    let clamped = if sensitivity.is_finite() {
        sensitivity.clamp(0.0, 100.0)
    } else {
        0.0
    };
    0.08 - (clamped / 100.0) * 0.07
}

pub(super) fn voiced(samples: &[f32], sensitivity: f32) -> bool {
    if samples.is_empty() {
        return false;
    }
    let mut sum = 0.0f32;
    for sample in samples {
        sum += sample * sample;
    }
    let rms = (sum / samples.len() as f32).sqrt();
    rms >= threshold(sensitivity)
}

pub(super) struct Endpoint {
    rate: u32,
    speech: bool,
    quiet: u64,
}

impl Endpoint {
    pub(super) fn new(rate: u32) -> Self {
        Self {
            rate,
            speech: false,
            quiet: 0,
        }
    }

    pub(super) fn push(&mut self, frame: &[f32], sensitivity: f32) -> bool {
        if voiced(frame, sensitivity) {
            self.speech = true;
            self.quiet = 0;
            return false;
        }
        if !self.speech || frame.is_empty() {
            return false;
        }
        self.quiet = self.quiet.saturating_add(frame.len() as u64);
        self.quiet >= quiet_samples(self.rate)
    }
}

pub(super) fn frame_samples(rate: u32) -> usize {
    let len = usize::try_from(u64::from(rate).saturating_mul(20) / 1_000).unwrap_or(1);
    if len == 0 {
        1
    } else {
        len
    }
}

fn quiet_samples(rate: u32) -> u64 {
    u64::from(rate).saturating_mul(800) / 1_000
}

#[cfg(test)]
#[path = "vad_test.rs"]
mod tests;
