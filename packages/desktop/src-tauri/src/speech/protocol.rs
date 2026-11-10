use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(super) enum Request {
    Load { model: String, engine: String },
    Transcribe { rate: u32, pcm: String },
    Feed { pcm: String },
    Finish,
    Reset,
    Cancel,
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(super) enum Response {
    Ready,
    Text { text: String },
    Partial { text: String },
    Error { message: String },
}

pub(super) fn encode_pcm(samples: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    STANDARD.encode(bytes)
}

pub(super) fn decode_pcm(encoded: &str) -> Result<Vec<f32>, String> {
    let bytes = STANDARD
        .decode(encoded.trim())
        .map_err(|_| "pcm must be f32 little-endian".to_string())?;
    if bytes.len() % 4 != 0 {
        return Err("pcm must be f32 little-endian".to_string());
    }
    let mut samples = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.as_chunks::<4>().0 {
        samples.push(f32::from_le_bytes(*chunk));
    }
    Ok(samples)
}

#[cfg(test)]
#[path = "protocol_test.rs"]
mod tests;
