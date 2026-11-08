use std::path::Path;

use telmo::parakeet::{Options, Parakeet};
use telmo::quant::Precision;

use super::contract::Transcriber;
use super::pcm::resample_linear;

const RATE: u32 = 16_000;
const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

pub(super) struct BarkEngine {
    model: Parakeet,
}

impl Transcriber for BarkEngine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        let audio = resample_linear(samples, sample_rate, RATE);
        if audio.is_empty() {
            return Ok(String::new());
        }
        let audio = with_quarter_second(&audio);
        let transcript = self
            .model
            .transcribe(&audio)
            .map_err(|err| err.to_string())?;
        Ok(transcript.text.trim().to_string())
    }
}

pub(super) fn load_at(dir: &Path) -> Result<BarkEngine, String> {
    for name in FILES {
        if !dir.join(name).is_file() {
            return Err(format!("bark model is missing {name}"));
        }
    }
    let model = Parakeet::load(
        dir,
        &Options {
            precision: Precision::Bf16,
            ..Options::default()
        },
    )
    .map_err(|err| err.to_string())?;
    Ok(BarkEngine { model })
}

fn with_quarter_second(audio: &[f32]) -> Vec<f32> {
    let lead = (RATE / 4) as usize;
    let mut samples = vec![0.0; lead + audio.len()];
    samples[lead..].copy_from_slice(audio);
    samples
}

#[cfg(test)]
#[path = "bark_test.rs"]
mod tests;
