use super::woof::ReplyState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReplyKind {
    Http,
    Woof,
}

impl ReplyKind {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "" | "http" => Ok(Self::Http),
            "woof" => Ok(Self::Woof),
            other => Err(format!("unknown reply engine: {other}")),
        }
    }

    pub(super) fn credit(self) -> &'static str {
        match self {
            Self::Woof => "Voice by Underdog Woof",
            Self::Http => "",
        }
    }
}

pub(super) fn credit() -> Result<String, String> {
    let configured = std::env::var("CAPRICE_TTS_ENGINE").unwrap_or_default();
    Ok(ReplyKind::parse(&configured)?.credit().to_string())
}

pub(super) async fn perform(state: &ReplyState, text: String) -> Result<Vec<u8>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let configured = std::env::var("CAPRICE_TTS_ENGINE").unwrap_or_default();
    match ReplyKind::parse(&configured)? {
        ReplyKind::Http => super::speak::post(text).await,
        ReplyKind::Woof => {
            let state = state.clone();
            tauri::async_runtime::spawn_blocking(move || super::woof::speak(&state, text))
                .await
                .map_err(|err| err.to_string())?
        }
    }
}

#[cfg(test)]
#[path = "reply_test.rs"]
mod tests;
