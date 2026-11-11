use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use super::limit::{stt_deadline, TRANSCRIPT_BYTES};
use super::pcm::{encode_wav, resample_linear};

const RATE: u32 = 16_000;

#[derive(Debug)]
pub(crate) struct SttClip {
    pub samples: Vec<f32>,
    pub rate: u32,
    pub url: String,
    pub model: String,
}

pub(crate) async fn post_clip(clip: SttClip) -> Result<String, String> {
    let audio = resample_linear(&clip.samples, clip.rate, RATE);
    if audio.is_empty() {
        return Ok(String::new());
    }
    let wav = encode_wav(RATE, &audio);
    let payload = serde_json::json!({
        "model": clip.model,
        "input": STANDARD.encode(wav),
    });
    let client = reqwest::Client::builder()
        .timeout(stt_deadline()?)
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .post(clip.url)
        .header("content-type", "application/json")
        .body(payload.to_string())
        .send()
        .await
        .map_err(show_http)?;
    let status = response.status();
    let bytes = read_body(response).await?;
    if !status.is_success() {
        return Err(format!("speech request failed: {}", status.as_u16()));
    }
    transcript_of(&bytes)
}

pub(super) fn transcript_of(bytes: &[u8]) -> Result<String, String> {
    let text =
        String::from_utf8(bytes.to_vec()).map_err(|_| "speech reply was not text".to_string())?;
    let trimmed = text.trim();
    if let Some(rest) = trimmed.strip_prefix('{') {
        if rest.ends_with('}') {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(field) = value.get("text").and_then(|item| item.as_str()) {
                    return Ok(field.trim().to_string());
                }
            }
        }
    }
    Ok(trimmed.to_string())
}

async fn read_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|len| len > TRANSCRIPT_BYTES as u64)
    {
        return Err("speech reply is too large".to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(show_http)? {
        if body.len().saturating_add(chunk.len()) > TRANSCRIPT_BYTES {
            return Err("speech reply is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn show_http(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "speech timed out".to_string()
    } else {
        err.to_string()
    }
}

#[cfg(test)]
#[path = "http_stt_test.rs"]
mod tests;
