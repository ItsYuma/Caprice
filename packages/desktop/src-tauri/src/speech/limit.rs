use std::time::Duration;

pub(super) const STT_DEADLINE_MS: u64 = 180_000;
pub(super) const TTS_DEADLINE_MS: u64 = 60_000;
pub(super) const MAX_RECORDING_SECS: u64 = 180;
pub(super) const REPLY_BYTES: usize = 8 * 1024 * 1024;
pub(super) const WORKER_REQUEST_BYTES: usize = 64 * 1024 * 1024;
pub(super) const WORKER_RESPONSE_BYTES: usize = 1024 * 1024;

pub(super) fn stream_samples() -> usize {
    16_000 * MAX_RECORDING_SECS as usize
}

pub(super) fn recording_samples(rate: u32) -> usize {
    usize::try_from(u64::from(rate).saturating_mul(MAX_RECORDING_SECS)).unwrap_or(usize::MAX)
}

pub(super) fn stt_deadline() -> Result<Duration, String> {
    duration_ms("CAPRICE_STT_DEADLINE_MS", STT_DEADLINE_MS)
}

pub(super) fn tts_deadline() -> Result<Duration, String> {
    duration_ms("CAPRICE_TTS_DEADLINE_MS", TTS_DEADLINE_MS)
}

pub(super) fn duration_ms(name: &str, default_ms: u64) -> Result<Duration, String> {
    match std::env::var(name) {
        Err(_) => Ok(Duration::from_millis(default_ms)),
        Ok(raw) => parse_ms(name, raw.trim(), default_ms),
    }
}

fn parse_ms(name: &str, raw: &str, default_ms: u64) -> Result<Duration, String> {
    if raw.is_empty() {
        return Ok(Duration::from_millis(default_ms));
    }
    let ms: u64 = raw
        .parse()
        .map_err(|_| format!("{name} is not a whole number of milliseconds"))?;
    if ms == 0 {
        return Err(format!("{name} is not a whole number of milliseconds"));
    }
    Ok(Duration::from_millis(ms))
}

#[cfg(test)]
#[path = "limit_test.rs"]
mod tests;
