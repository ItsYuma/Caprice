use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct ReplyState {
    generation: Arc<AtomicU64>,
}

impl ReplyState {
    pub(crate) fn new() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReplyKind {
    Http,
    Local(&'static str),
}

impl ReplyKind {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "" | "http" => Ok(Self::Http),
            "piper" => Ok(Self::Local("piper")),
            "kokoro" => Ok(Self::Local("kokoro")),
            "woof" => Err("woof is retired. Use http.".to_string()),
            other => Err(format!("unknown reply engine: {other}")),
        }
    }
}

pub(crate) fn speech_reply_cancel(state: &ReplyState) -> Result<(), String> {
    state.generation.fetch_add(1, Ordering::AcqRel);
    Ok(())
}

pub(super) fn credit() -> Result<String, String> {
    let configured = crate::settings::tts_engine();
    let _kind = ReplyKind::parse(&configured)?;
    Ok(String::new())
}

pub(super) async fn perform(state: &ReplyState, text: String) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let ticket = state.generation();
    let configured = crate::settings::tts_engine();
    let result = match ReplyKind::parse(&configured)? {
        ReplyKind::Http => super::speak::post(text).await,
        ReplyKind::Local(family) => Err(format!("{family} is not loaded yet")),
    };
    if state.generation() != ticket {
        return Err("speech reply cancelled".to_string());
    }
    result
}

#[cfg(test)]
#[path = "reply_test.rs"]
mod tests;
