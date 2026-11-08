use std::path::Path;

use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

use super::contract::Transcriber;
use super::pcm::resample_linear;

const RATE: u32 = 16_000;

pub(super) struct ParakeetEngine {
    model: ParakeetModel,
}

impl Transcriber for ParakeetEngine {
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

pub(super) fn load_at(dir: &Path) -> Result<ParakeetEngine, String> {
    let model = ParakeetModel::load(dir, &Quantization::Int8).map_err(|err| err.to_string())?;
    Ok(ParakeetEngine { model })
}
