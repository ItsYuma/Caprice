use std::path::PathBuf;

use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

use super::pcm::resample_linear;
use super::resident::ResidentStt;

const RATE: u32 = 16_000;

pub(super) struct ParakeetEngine {
    model: ParakeetModel,
}

impl ResidentStt for ParakeetEngine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        let audio = resample_linear(samples, sample_rate, RATE);
        if audio.is_empty() {
            return Ok(String::new());
        }
        let result = self
            .model
            .transcribe(&audio, &TranscribeOptions::default())
            .map_err(|err| err.to_string())?;
        Ok(result.text.trim().to_string())
    }
}

pub(super) fn require_model() -> Result<(), String> {
    model_dir().map(|_| ())
}

pub(super) fn load() -> Result<ParakeetEngine, String> {
    let dir = model_dir()?;
    let model = ParakeetModel::load(&dir, &Quantization::Int8).map_err(|err| err.to_string())?;
    Ok(ParakeetEngine { model })
}

fn model_dir() -> Result<PathBuf, String> {
    match std::env::var("CAPRICE_STT_MODEL") {
        Ok(path) if !path.trim().is_empty() => Ok(PathBuf::from(path.trim())),
        _ => Err("CAPRICE_STT_MODEL is not set".to_string()),
    }
}
