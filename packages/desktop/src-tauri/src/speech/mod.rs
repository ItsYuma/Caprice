mod bark;
mod bark_stream;
mod buffered;
mod capture;
mod child;
mod contract;
mod engine;
mod feed;
mod limit;
mod parakeet;
mod pcm;
mod phase;
mod protocol;
mod reply;
pub(crate) mod speak;
mod supervisor;
mod unified;
mod woof;
pub(crate) mod worker;

pub(crate) use woof::speech_reply_cancel;
pub(crate) use woof::ReplyState;

use std::mem;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use capture::Recording;
use child::WorkerIo;
use engine::requirements;
use limit::stt_deadline;
use phase::{
    cancel_mic, cease, press, publish, settle, Cancelled, ListenOutcome, Mic, Press, Stop,
};
use supervisor::{try_retire, Supervisor};

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    feed: Mutex<Option<feed::Feeder>>,
    supervisor: Mutex<Supervisor>,
    io: Arc<WorkerIo>,
    mic: Mutex<Mic<Recording>>,
    cancelled: AtomicBool,
    abort_notice: AtomicBool,
    generation: AtomicU64,
}

impl Drop for SpeechShared {
    fn drop(&mut self) {
        *lock(&self.mic) = Mic::Idle;
        self.io.process.kill_and_reap();
        let feeder = lock(&self.feed).take();
        drop(feeder);
    }
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        let io = Arc::new(WorkerIo::new());
        Self {
            shared: Arc::new(SpeechShared {
                feed: Mutex::new(None),
                supervisor: Mutex::new(Supervisor::new(Arc::clone(&io))),
                io,
                mic: Mutex::new(Mic::Idle),
                cancelled: AtomicBool::new(false),
                abort_notice: AtomicBool::new(false),
                generation: AtomicU64::new(0),
            }),
        }
    }
}

pub(crate) fn speech_listen_start(state: &SpeechState) -> Result<(), String> {
    let (_, kind) = requirements()?;
    stt_deadline()?;
    let ticket = state.shared.generation.load(Ordering::Acquire);
    let opened = capture::open_input()?;
    let mut mic = lock(&state.shared.mic);
    match press(mem::replace(&mut *mic, Mic::Idle)) {
        Press::Open => {
            if state.shared.generation.load(Ordering::Acquire) != ticket {
                *mic = Mic::Idle;
                drop(opened);
                return Err("listening cancelled".to_string());
            }
            if kind.streams() {
                let feeder = feed::Feeder::start(
                    &state.shared,
                    Arc::clone(&opened.captured),
                    opened.sample_rate,
                );
                *lock(&state.shared.feed) = Some(feeder);
            }
            *mic = Mic::Recording(opened);
            state.shared.cancelled.store(false, Ordering::Release);
            state.shared.abort_notice.store(false, Ordering::Release);
            Ok(())
        }
        Press::Busy(existing) => {
            *mic = existing;
            drop(opened);
            Err("already listening".to_string())
        }
    }
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    let (_, kind) = requirements()?;
    stt_deadline()?;
    let (recording, ticket) = {
        let mut mic = lock(&state.shared.mic);
        let ticket = state.shared.generation.load(Ordering::Acquire);
        let (next, stopped) = cease(mem::replace(&mut *mic, Mic::Idle));
        *mic = next;
        match stopped {
            Stop::Begin(recording) => (recording, ticket),
            Stop::Idle => {
                if state.shared.abort_notice.swap(false, Ordering::AcqRel) {
                    return Err("listening cancelled".to_string());
                }
                return Err("not listening".to_string());
            }
        }
    };
    let captured = Arc::clone(&recording.captured);
    let sample_rate = recording.sample_rate;
    drop(recording);
    let feeder = lock(&state.shared.feed).take();
    let fed = match feeder {
        Some(feeder) => feeder.stop(),
        None => Ok(()),
    };
    let (microphone, audio) = {
        let (samples, failure) = capture::take_fresh(&captured);
        (failure, samples)
    };
    let mut cancelled = state.shared.cancelled.load(Ordering::Acquire)
        || state.shared.generation.load(Ordering::Acquire) != ticket;
    let blocked = cancelled || microphone.is_some() || fed.is_err();
    if blocked {
        let _ = lock(&state.shared.supervisor).abandon();
    }
    let transcript = if blocked {
        Err("listening cancelled".to_string())
    } else if kind.streams() {
        lock(&state.shared.supervisor).finish()
    } else {
        lock(&state.shared.supervisor).transcribe(&audio, sample_rate)
    };
    cancelled = state.shared.cancelled.load(Ordering::Acquire)
        || state.shared.generation.load(Ordering::Acquire) != ticket;
    if cancelled {
        let _ = lock(&state.shared.supervisor).abandon();
    }
    {
        let mut mic = lock(&state.shared.mic);
        *mic = settle(mem::replace(&mut *mic, Mic::Idle));
    }
    publish(ListenOutcome {
        transcript,
        feed: fed,
        microphone,
        cancelled,
    })
}

pub(crate) fn speech_cancel(state: &SpeechState) -> Result<(), String> {
    state.shared.generation.fetch_add(1, Ordering::AcqRel);
    {
        let mic = lock(&state.shared.mic);
        if !matches!(*mic, Mic::Idle) {
            state.shared.cancelled.store(true, Ordering::Release);
        }
    }
    state.shared.io.process.kill();
    if let Some(feeder) = lock(&state.shared.feed).as_ref() {
        feeder.signal();
    }
    state.shared.io.send_cancel();
    state.shared.io.process.kill_and_reap();
    let feeder = lock(&state.shared.feed).take();
    if let Some(feeder) = feeder {
        let _ = feeder.stop();
    }
    try_retire(&state.shared.supervisor);
    let stopped = {
        let mut mic = lock(&state.shared.mic);
        let (next, cancelled) = cancel_mic(mem::replace(&mut *mic, Mic::Idle));
        *mic = next;
        cancelled
    };
    if let Cancelled::Stopped(recording) = stopped {
        drop(recording);
        state.shared.abort_notice.store(true, Ordering::Release);
    }
    Ok(())
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod lifecycle {
    use super::{speech_cancel, SpeechState};

    #[test]
    fn cancel_while_idle_can_run_twice() {
        let state = SpeechState::new();
        speech_cancel(&state).expect("cancel");
        speech_cancel(&state).expect("cancel again");
        assert!(!state
            .shared
            .cancelled
            .load(std::sync::atomic::Ordering::Acquire));
    }
}
