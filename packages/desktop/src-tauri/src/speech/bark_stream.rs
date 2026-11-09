use std::ops::Range;

use super::bark::{BarkEngine, TimedToken};

const RATE: u32 = 16_000;
const LEFT: usize = 10 * 16_000;
const CENTER: usize = 2 * 16_000;
const RIGHT: usize = 2 * 16_000;

#[derive(Debug, PartialEq, Eq)]
struct Window {
    slice: Range<usize>,
    commit: Range<usize>,
}

pub(super) struct Utterance {
    audio: Vec<f32>,
    center: usize,
    tokens: Vec<TimedToken>,
}

impl Utterance {
    pub(super) fn new() -> Self {
        Self {
            audio: Vec::new(),
            center: 0,
            tokens: Vec::new(),
        }
    }

    pub(super) fn push(&mut self, engine: &BarkEngine, samples: &[f32]) -> Result<String, String> {
        self.audio.extend_from_slice(samples);
        self.catch_up(engine, false)?;
        Ok(self.text(engine))
    }

    pub(super) fn finish(&mut self, engine: &BarkEngine) -> Result<String, String> {
        let caught = self.catch_up(engine, true);
        let text = self.text(engine);
        *self = Self::new();
        caught?;
        Ok(text)
    }

    fn catch_up(&mut self, engine: &BarkEngine, flush: bool) -> Result<(), String> {
        while let Some(window) = next_window(self.audio.len(), self.center, flush) {
            if window.commit.end <= self.center {
                break;
            }
            let start = window.slice.start;
            let end = window.slice.end;
            let commit_end = window.commit.end;
            let slice = self.audio[start..end].to_vec();
            let heard = engine.timed_tokens(&slice, RATE)?;
            self.absorb(&heard, start, commit_end);
            self.center = commit_end;
        }
        Ok(())
    }

    fn absorb(&mut self, heard: &[TimedToken], origin: usize, commit_end: usize) {
        self.tokens
            .retain(|token| token.start < origin || token.start >= commit_end);
        for token in heard {
            let start = origin.saturating_add(token.start);
            let end = origin.saturating_add(token.end);
            if start < commit_end && end > origin {
                self.tokens.push(TimedToken {
                    start,
                    end,
                    id: token.id,
                });
            }
        }
        self.tokens.sort_by_key(|token| (token.start, token.end));
    }

    fn text(&self, engine: &BarkEngine) -> String {
        if self.tokens.is_empty() {
            return String::new();
        }
        let ids: Vec<u32> = self.tokens.iter().map(|token| token.id).collect();
        engine.decode(&ids)
    }
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
