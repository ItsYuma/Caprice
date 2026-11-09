use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use super::buffered::{CHUNK_MS, RATE};
use super::pcm::fresh_samples;
use super::supervisor::Supervisor;
use super::{lock, SpeechState};

pub(super) struct LiveFeed {
    stop: Arc<AtomicBool>,
    cursor: Arc<Mutex<Cursor>>,
    failed: Arc<Mutex<Option<String>>>,
    thread: Option<JoinHandle<()>>,
}

struct Cursor {
    sent: usize,
}

impl LiveFeed {
    pub(super) fn join(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }

    pub(super) fn failure(&self) -> Option<String> {
        lock(&self.failed).clone()
    }

    pub(super) fn flush(
        &self,
        raw: &[f32],
        sample_rate: u32,
        supervisor: &mut Supervisor,
    ) -> Result<(), String> {
        let sent = lock(&self.cursor).sent;
        let fresh = fresh_samples(raw, sample_rate, RATE, sent, true);
        if fresh.samples.is_empty() {
            return Ok(());
        }
        supervisor.feed(&fresh.samples)?;
        lock(&self.cursor).sent = fresh.sent;
        Ok(())
    }
}

impl Drop for LiveFeed {
    fn drop(&mut self) {
        self.join();
    }
}

pub(super) fn spawn(
    state: SpeechState,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
) -> Result<LiveFeed, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let cursor = Arc::new(Mutex::new(Cursor { sent: 0 }));
    let failed = Arc::new(Mutex::new(None));
    let stop_flag = Arc::clone(&stop);
    let cursor_thread = Arc::clone(&cursor);
    let failed_thread = Arc::clone(&failed);
    let thread = std::thread::Builder::new()
        .name("parakeet-feed".into())
        .spawn(move || {
            run(
                stop_flag,
                cursor_thread,
                failed_thread,
                state,
                samples,
                sample_rate,
            )
        })
        .map_err(|err| err.to_string())?;
    Ok(LiveFeed {
        stop,
        cursor,
        failed,
        thread: Some(thread),
    })
}

fn run(
    stop: Arc<AtomicBool>,
    cursor: Arc<Mutex<Cursor>>,
    failed: Arc<Mutex<Option<String>>>,
    state: SpeechState,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
) {
    let pause = Duration::from_millis(u64::from(CHUNK_MS / 2));
    while !stop.load(Ordering::Relaxed) {
        if let Err(err) = push(&cursor, &state, &samples, sample_rate) {
            *lock(&failed) = Some(err);
            return;
        }
        std::thread::park_timeout(pause);
    }
}

fn push(
    cursor: &Mutex<Cursor>,
    state: &SpeechState,
    samples: &Mutex<Vec<f32>>,
    sample_rate: u32,
) -> Result<(), String> {
    let raw = lock(samples).clone();
    let sent = lock(cursor).sent;
    let fresh = fresh_samples(&raw, sample_rate, RATE, sent, false);
    if fresh.samples.is_empty() {
        return Ok(());
    }
    lock(&state.shared.supervisor).feed(&fresh.samples)?;
    lock(cursor).sent = fresh.sent;
    Ok(())
}
