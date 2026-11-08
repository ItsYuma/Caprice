use std::path::Path;

use super::contract::Transcriber;
use super::parakeet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum EngineKind {
    Onnx,
}

impl EngineKind {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "" | "onnx" => Ok(Self::Onnx),
            other => Err(format!("unknown speech engine: {other}")),
        }
    }

    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Onnx => "onnx",
        }
    }
}

pub(super) enum Engine {
    Onnx(parakeet::ParakeetEngine),
}

impl Transcriber for Engine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        match self {
            Self::Onnx(engine) => engine.transcribe(samples, sample_rate),
        }
    }
}

impl Engine {
    pub(super) fn load(kind: EngineKind, model: &Path) -> Result<Self, String> {
        match kind {
            EngineKind::Onnx => Ok(Self::Onnx(parakeet::load_at(model)?)),
        }
    }
}

pub(super) fn requirements() -> Result<(String, EngineKind), String> {
    let model = match std::env::var("CAPRICE_STT_MODEL") {
        Ok(path) if !path.trim().is_empty() => path.trim().to_string(),
        _ => return Err("CAPRICE_STT_MODEL is not set".to_string()),
    };
    let configured = std::env::var("CAPRICE_STT_ENGINE").unwrap_or_default();
    let kind = EngineKind::parse(&configured)?;
    Ok((model, kind))
}

#[cfg(test)]
#[path = "engine_test.rs"]
mod tests;
