use std::path::Path;

use super::bark;
use super::contract::Transcriber;
use super::parakeet;
use super::unified;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum EngineKind {
    Onnx,
    Bark,
    Parakeet,
}

impl EngineKind {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "" | "onnx" => Ok(Self::Onnx),
            "bark" => Ok(Self::Bark),
            "parakeet" => Ok(Self::Parakeet),
            other => Err(format!("unknown speech engine: {other}")),
        }
    }

    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Onnx => "onnx",
            Self::Bark => "bark",
            Self::Parakeet => "parakeet",
        }
    }
}

pub(super) enum Engine {
    Onnx(parakeet::ParakeetEngine),
    Bark(Box<bark::BarkEngine>),
    Parakeet(unified::UnifiedEngine),
}

impl Transcriber for Engine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        match self {
            Self::Onnx(engine) => engine.transcribe(samples, sample_rate),
            Self::Bark(engine) => engine.transcribe(samples, sample_rate),
            Self::Parakeet(engine) => engine.transcribe(samples, sample_rate),
        }
    }
}

impl Engine {
    pub(super) fn feed(&mut self, samples: &[f32]) -> Result<String, String> {
        match self {
            Self::Parakeet(engine) => engine.feed(samples),
            Self::Onnx(_) | Self::Bark(_) => Err("speech engine does not stream".to_string()),
        }
    }

    pub(super) fn finish(&mut self) -> Result<String, String> {
        match self {
            Self::Parakeet(engine) => engine.finish(),
            Self::Onnx(_) | Self::Bark(_) => Err("speech engine does not stream".to_string()),
        }
    }
}

impl Engine {
    pub(super) fn load(kind: EngineKind, model: &Path) -> Result<Self, String> {
        match kind {
            EngineKind::Onnx => Ok(Self::Onnx(parakeet::load_at(model)?)),
            EngineKind::Bark => Ok(Self::Bark(Box::new(bark::load_at(model)?))),
            EngineKind::Parakeet => Ok(Self::Parakeet(unified::load_at(model)?)),
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
