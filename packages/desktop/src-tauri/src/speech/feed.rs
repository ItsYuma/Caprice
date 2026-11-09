use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::lock;
use super::pcm::fresh_samples;
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
        samples: Arc<Mutex<Vec<f32>>>,
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
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    {
        let Some(shared) = link.upgrade() else {
            return Ok(());
        };
        lock(&shared.supervisor).ensure()?;
    }
    let mut raw = Vec::new();
    let mut copied = 0usize;
    let mut sent = 0usize;
    loop {
        let Some(shared) = link.upgrade() else {
            return Ok(());
        };
        let flushing = stop.load(Ordering::Acquire);
        let fresh = {
            let guard = lock(&samples);
            if copied < guard.len() {
                let fresh = guard[copied..].to_vec();
                copied = guard.len();
                fresh
            } else {
                Vec::new()
            }
        };
        if fresh.is_empty() && !flushing {
            drop(shared);
            thread::sleep(POLL);
            continue;
        }
        raw.extend_from_slice(&fresh);
        let (chunk, next) = next_feed(&raw, rate, sent, flushing);
        if chunk.is_empty() {
            if flushing {
                return Ok(());
            }
            drop(shared);
            thread::sleep(POLL);
            continue;
        }
        sent = next;
        lock(&shared.supervisor).feed(&chunk)?;
    }
}

fn next_feed(raw: &[f32], rate: u32, sent: usize, flushing: bool) -> (Vec<f32>, usize) {
    let fresh = fresh_samples(raw, rate, RATE, sent, flushing);
    (fresh.samples, fresh.sent)
}

#[cfg(test)]
#[path = "feed_test.rs"]
mod tests;
