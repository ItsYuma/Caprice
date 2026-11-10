use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::capture::{take_fresh, Captured};
use super::limit::recording_samples;
use super::lock;
#[cfg(test)]
use super::pcm::fresh_samples;
use super::pcm::Resampler;
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
        samples: Arc<Mutex<Captured>>,
        rate: u32,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let link = Arc::downgrade(shared);
        let done = thread::spawn(move || run(link, samples, rate, flag));
        Self {
            stop,
            done: Some(done),
        }
    }

    pub(super) fn signal(&self) {
        self.stop.store(true, Ordering::Release);
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
    samples: Arc<Mutex<Captured>>,
    rate: u32,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let Some(shared) = link.upgrade() else {
        return Ok(());
    };
    if stop.load(Ordering::Acquire) || shared.cancelled.load(Ordering::Acquire) {
        return Err("listening cancelled".to_string());
    }
    {
        let mut supervisor = lock(&shared.supervisor);
        supervisor.ensure()?;
        supervisor.abandon()?;
    }
    if stop.load(Ordering::Acquire) || shared.cancelled.load(Ordering::Acquire) {
        return Err("listening cancelled".to_string());
    }
    drop(shared);
    let mut resampler = Resampler::new(rate, RATE);
    let max = recording_samples(rate);
    let mut heard = 0usize;
    loop {
        let Some(shared) = link.upgrade() else {
            return Ok(());
        };
        if shared.cancelled.load(Ordering::Acquire) {
            return Err("listening cancelled".to_string());
        }
        let flushing = stop.load(Ordering::Acquire);
        let (fresh, failure) = take_fresh(&samples);
        if let Some(message) = failure {
            return Err(message);
        }
        heard = heard.saturating_add(fresh.len());
        if heard > max {
            return Err("recording is too long".to_string());
        }
        let chunk = resampler.push(&fresh, flushing);
        if chunk.is_empty() {
            if flushing {
                return Ok(());
            }
            drop(shared);
            thread::sleep(POLL);
            continue;
        }
        lock(&shared.supervisor).feed(&chunk)?;
    }
}

#[cfg(test)]
fn next_feed(raw: &[f32], rate: u32, sent: usize, flushing: bool) -> (Vec<f32>, usize) {
    let fresh = fresh_samples(raw, rate, RATE, sent, flushing);
    (fresh.samples, fresh.sent)
}

#[cfg(test)]
#[path = "feed_test.rs"]
mod tests;
