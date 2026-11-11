use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::capture::{capture_failure, captured_len, copy_range, Captured};
use super::limit::recording_samples;
use super::pcm::Resampler;
use super::unified::UnifiedEngine;
use super::SpeechShared;

const RATE: u32 = 16_000;
const POLL: Duration = Duration::from_millis(20);

pub(super) struct Feeder {
    stop: Arc<AtomicBool>,
    done: Option<JoinHandle<Result<(), String>>>,
}

impl Feeder {
    pub(super) fn start(
        shared: &Arc<SpeechShared>,
        engine: Arc<UnifiedEngine>,
        samples: Arc<Mutex<Captured>>,
        rate: u32,
        ticket: u64,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let link = Arc::downgrade(shared);
        let done = thread::spawn(move || run(link, engine, samples, rate, ticket, flag));
        Self {
            stop,
            done: Some(done),
        }
    }

    pub(super) fn stop(mut self) -> Result<(), String> {
        self.stop.store(true, Ordering::Release);
        let Some(done) = self.done.take() else {
            return Err("speech feeder stopped".to_string());
        };
        match done.join() {
            Ok(result) => result,
            Err(_) => Err("speech feeder stopped".to_string()),
        }
    }
}

impl Drop for Feeder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let Some(done) = self.done.take() else {
            return;
        };
        if done.thread().id() != thread::current().id() {
            let _ = done.join();
        }
    }
}

fn run(
    link: Weak<SpeechShared>,
    engine: Arc<UnifiedEngine>,
    samples: Arc<Mutex<Captured>>,
    rate: u32,
    ticket: u64,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut resampler = Resampler::new(rate, RATE);
    let mut sent = 0usize;
    loop {
        let Some(shared) = link.upgrade() else {
            return Ok(());
        };
        if shared.generation.load(Ordering::Acquire) != ticket {
            return Err("listening cancelled".to_string());
        }
        let flushing = stop.load(Ordering::Acquire);
        let chunk = pull_chunk(&samples, rate, &mut resampler, &mut sent, flushing)?;
        drop(shared);
        if !chunk.is_empty() {
            engine.feed(&chunk)?;
        }
        if flushing {
            return Ok(());
        }
        if chunk.is_empty() {
            thread::sleep(POLL);
        }
    }
}

pub(super) fn pull_chunk(
    captured: &Mutex<Captured>,
    rate: u32,
    resampler: &mut Resampler,
    sent: &mut usize,
    flushing: bool,
) -> Result<Vec<f32>, String> {
    if let Some(message) = capture_failure(captured) {
        return Err(message);
    }
    let total = captured_len(captured);
    if total > recording_samples(rate) {
        return Err("recording is too long".to_string());
    }
    let fresh = if total > *sent {
        let chunk = copy_range(captured, *sent, total);
        *sent = total;
        chunk
    } else {
        Vec::new()
    };
    Ok(resampler.push(&fresh, flushing))
}

#[cfg(test)]
#[path = "feed_test.rs"]
mod tests;
