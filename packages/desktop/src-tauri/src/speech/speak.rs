use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use super::limit::{tts_deadline, REPLY_BYTES};
use super::reply;

fn encode_audio(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        String::new()
    } else {
        STANDARD.encode(bytes)
    }
}

#[tauri::command]
pub(crate) async fn speech_speak(
    state: tauri::State<'_, super::ReplyState>,
    text: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    let bytes = reply::perform(&state, text).await?;
    Ok(encode_audio(&bytes))
}

#[tauri::command]
pub(crate) fn speech_credit() -> Result<String, String> {
    reply::credit()
}

pub(super) async fn post(text: String) -> Result<Vec<u8>, String> {
    let url = match std::env::var("CAPRICE_TTS_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return Err("speech is not configured".to_string()),
    };
    let model = match std::env::var("CAPRICE_TTS_MODEL") {
        Ok(model) if !model.is_empty() => model,
        _ => return Err("CAPRICE_TTS_MODEL is not set".to_string()),
    };
    let voice = std::env::var("CAPRICE_TTS_VOICE").unwrap_or_default();
    let api_key = std::env::var("CAPRICE_TTS_API_KEY").unwrap_or_default();
    let mut payload = serde_json::json!({
        "model": model,
        "input": text,
    });
    if !voice.is_empty() {
        payload["voice"] = serde_json::Value::String(voice);
    }

    let client = reqwest::Client::builder()
        .timeout(tts_deadline()?)
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .body(payload.to_string());
    if !api_key.is_empty() {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }

    let response = request.send().await.map_err(show_http)?;
    let status = response.status();
    let bytes = read_body(response).await?;
    if !status.is_success() {
        return Err(format!("speech request failed: {}", status.as_u16()));
    }
    Ok(bytes)
}

async fn read_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|len| len > REPLY_BYTES as u64)
    {
        return Err("speech reply is too large".to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(show_http)? {
        if body.len().saturating_add(chunk.len()) > REPLY_BYTES {
            return Err("speech reply is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn show_http(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "speech reply timed out".to_string()
    } else {
        err.to_string()
    }
}

#[cfg(test)]
#[path = "speak_test.rs"]
mod tests;
