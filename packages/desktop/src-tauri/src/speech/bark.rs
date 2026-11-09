use std::path::Path;

use telmo::parakeet::{Options, Parakeet, Token};
use telmo::quant::Precision;

use super::contract::Transcriber;
use super::pcm::resample_linear;

const RATE: u32 = 16_000;
const FRAME: i64 = 1_280;
const LEAD: i64 = (RATE / 4) as i64;
const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

pub(super) struct TimedToken {
    pub start: usize,
    pub end: usize,
    pub id: u32,
}

pub(super) struct BarkEngine {
    model: Parakeet,
}

impl Transcriber for BarkEngine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        let Some(audio) = prepare(samples, sample_rate) else {
            return Ok(String::new());
        };
        let transcript = self
            .model
            .transcribe(&audio)
            .map_err(|err| err.to_string())?;
        Ok(transcript.text.trim().to_string())
    }
}

impl BarkEngine {
    pub(super) fn timed_tokens(
        &self,
        samples: &[f32],
        sample_rate: u32,
    ) -> Result<Vec<TimedToken>, String> {
        let Some(audio) = prepare(samples, sample_rate) else {
            return Ok(Vec::new());
        };
        let transcript = self
            .model
            .transcribe(&audio)
            .map_err(|err| err.to_string())?;
        Ok(place_tokens(&transcript.tokens))
    }

    pub(super) fn decode(&self, ids: &[u32]) -> String {
        self.model.tokenizer().decode(ids).trim().to_string()
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

fn prepare(samples: &[f32], sample_rate: u32) -> Option<Vec<f32>> {
    let audio = resample_linear(samples, sample_rate, RATE);
    if audio.is_empty() {
        return None;
    }
    Some(with_quarter_second(&audio))
}

fn with_quarter_second(audio: &[f32]) -> Vec<f32> {
    let lead = (RATE / 4) as usize;
    let mut samples = vec![0.0; lead + audio.len()];
    samples[lead..].copy_from_slice(audio);
    samples
}

fn place_tokens(tokens: &[Token]) -> Vec<TimedToken> {
    tokens
        .iter()
        .filter_map(|token| {
            let (start, end) = token_span(token.frame, token.duration)?;
            Some(TimedToken {
                start,
                end,
                id: token.id,
            })
        })
        .collect()
}

fn token_span(frame: u32, duration: u32) -> Option<(usize, usize)> {
    let frames = i64::from(duration.max(1));
    let start = i64::from(frame) * FRAME - LEAD;
    let end = (i64::from(frame) + frames) * FRAME - LEAD;
    if end <= 0 {
        return None;
    }
    Some((start.max(0) as usize, end as usize))
}

#[cfg(test)]
#[path = "bark_test.rs"]
mod tests;
