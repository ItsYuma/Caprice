use std::ops::Range;

use super::bark::{BarkEngine, TimedToken};
use super::contract::Transcriber;
use super::limit::stream_samples;

const RATE: u32 = 16_000;
const LEFT: usize = 10 * 16_000;
const CENTER: usize = 2 * 16_000;
const RIGHT: usize = 2 * 16_000;

#[derive(Debug, PartialEq, Eq)]
struct Window {
    slice: Range<usize>,
    commit: Range<usize>,
}

pub(super) struct Stream {
    engine: BarkEngine,
    utterance: Utterance,
}

impl Stream {
    pub(super) fn new(engine: BarkEngine) -> Self {
        Self {
            engine,
            utterance: Utterance::new(),
        }
    }

    pub(super) fn transcribe(
        &mut self,
        samples: &[f32],
        sample_rate: u32,
    ) -> Result<String, String> {
        self.utterance = Utterance::new();
        self.engine.transcribe(samples, sample_rate)
    }

    pub(super) fn push(&mut self, samples: &[f32]) -> Result<String, String> {
        self.utterance.push(&self.engine, samples)
    }

    pub(super) fn finish(&mut self) -> Result<String, String> {
        self.utterance.finish(&self.engine)
    }

    pub(super) fn reset(&mut self) {
        self.utterance = Utterance::new();
    }
}

pub(super) struct Utterance {
    origin: usize,
    audio: Vec<f32>,
    center: usize,
    tokens: Vec<TimedToken>,
    failed: Option<String>,
}

impl Utterance {
    pub(super) fn new() -> Self {
        Self {
            origin: 0,
            audio: Vec::new(),
            center: 0,
            tokens: Vec::new(),
            failed: None,
        }
    }

    pub(super) fn push(&mut self, engine: &BarkEngine, samples: &[f32]) -> Result<String, String> {
        if let Some(message) = self.failed.clone() {
            return Err(message);
        }
        let received = self
            .origin
            .saturating_add(self.audio.len())
            .saturating_add(samples.len());
        if received > stream_samples() {
            return self.fail("recording is too long".to_string());
        }
        self.audio.extend_from_slice(samples);
        if let Err(message) = self.catch_up(engine, false) {
            return self.fail(message);
        }
        Ok(self.text(engine))
    }

    pub(super) fn finish(&mut self, engine: &BarkEngine) -> Result<String, String> {
        if let Some(message) = self.failed.clone() {
            *self = Self::new();
            return Err(message);
        }
        let caught = self.catch_up(engine, true);
        let text = if caught.is_ok() {
            self.text(engine)
        } else {
            String::new()
        };
        *self = Self::new();
        caught?;
        Ok(text)
    }

    fn fail(&mut self, message: String) -> Result<String, String> {
        self.failed = Some(message.clone());
        self.tokens.clear();
        Err(message)
    }

    fn catch_up(&mut self, engine: &BarkEngine, flush: bool) -> Result<(), String> {
        let received = self.origin + self.audio.len();
        while let Some(window) = next_window(received, self.center, flush) {
            if window.commit.end <= self.center {
                break;
            }
            let start = window.slice.start;
            let end = window.slice.end;
            let commit_end = window.commit.end;
            if start < self.origin || end > self.origin + self.audio.len() {
                return Err("bark window fell outside the buffered audio".to_string());
            }
            let slice = self.audio[start - self.origin..end - self.origin].to_vec();
            let heard = engine.timed_tokens(&slice, RATE)?;
            self.absorb(&heard, start, commit_end);
            self.center = commit_end;
            self.trim();
        }
        Ok(())
    }

    fn absorb(&mut self, heard: &[TimedToken], origin: usize, commit_end: usize) {
        let mut accepted = Vec::new();
        for token in heard {
            let start = origin.saturating_add(token.start);
            let end = origin.saturating_add(token.end);
            if start >= commit_end || end > commit_end || end <= start {
                continue;
            }
            let candidate = TimedToken {
                start,
                end,
                id: token.id,
            };
            if accepted.iter().any(|earlier| overlaps(earlier, &candidate)) {
                continue;
            }
            accepted.push(candidate);
        }
        self.tokens.retain(|token| {
            let in_revision = token.start >= origin && token.start < commit_end;
            let covered = accepted.iter().any(|candidate| overlaps(token, candidate));
            !in_revision && !covered
        });
        self.tokens.extend(accepted);
        self.tokens
            .sort_by_key(|token| (token.start, token.end, token.id));
    }

    fn trim(&mut self) {
        let keep = self.center.saturating_sub(LEFT);
        if keep <= self.origin {
            return;
        }
        let drop = keep - self.origin;
        if drop >= self.audio.len() {
            self.audio.clear();
            self.origin = keep;
            return;
        }
        self.audio.drain(..drop);
        self.origin = keep;
    }

    fn text(&self, engine: &BarkEngine) -> String {
        if self.tokens.is_empty() {
            return String::new();
        }
        let ids: Vec<u32> = self.tokens.iter().map(|token| token.id).collect();
        engine.decode(&ids)
    }
}

fn overlaps(left: &TimedToken, right: &TimedToken) -> bool {
    left.start < right.end && right.start < left.end
}

fn next_window(received: usize, center: usize, flush: bool) -> Option<Window> {
    if center >= received {
        return None;
    }
    let center_end = center.saturating_add(CENTER).min(received);
    let wanted_end = center_end.saturating_add(RIGHT);
    if !flush && received < wanted_end {
        return None;
    }
    let slice_start = center.saturating_sub(LEFT);
    let slice_end = wanted_end.min(received);
    Some(Window {
        slice: slice_start..slice_end,
        commit: center..center_end,
    })
}

#[cfg(test)]
#[path = "bark_stream_test.rs"]
mod tests;
