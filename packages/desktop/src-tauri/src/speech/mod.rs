mod bark;
mod buffered;
mod capture;
mod contract;
mod engine;
mod feed;
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

pub(crate) use woof::ReplyState;

use std::sync::{Arc, Mutex, MutexGuard};

use capture::Recording;
use engine::{requirements, EngineKind};
use phase::{press, release, Mic, Press, Released};
use supervisor::Supervisor;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct Held {
    feed: Option<feed::LiveFeed>,
    recording: Recording,
}

struct SpeechShared {
    mic: Mutex<Mic<Held>>,
    supervisor: Mutex<Supervisor>,
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(SpeechShared {
                mic: Mutex::new(Mic::Idle),
                supervisor: Mutex::new(Supervisor::new()),
            }),
        }
    }
}

pub(crate) fn speech_transcribe(state: &SpeechState, path: String) -> Result<String, String> {
    requirements()?;
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let (rate, samples) = pcm::decode_wav(&bytes)?;
    lock(&state.shared.supervisor).transcribe(&samples, rate)
}

pub(crate) fn speech_listen_start(state: &SpeechState) -> Result<(), String> {
    let (_model, kind) = requirements()?;
    let streaming = kind == EngineKind::Parakeet;
    if streaming {
        lock(&state.shared.supervisor).warm()?;
    }
    let mut mic = lock(&state.shared.mic);
    match press(std::mem::replace(&mut *mic, Mic::Idle)) {
        Press::Open => match capture::open_input() {
            Ok(recording) => {
                let live = if streaming {
                    let samples = Arc::clone(&recording.samples);
                    let rate = recording.sample_rate;
                    match feed::spawn(state.clone(), samples, rate) {
                        Ok(live) => Some(live),
                        Err(err) => {
                            drop(recording);
                            *mic = Mic::Idle;
                            return Err(err);
                        }
                    }
                } else {
                    None
                };
                *mic = Mic::Hot(Held {
                    feed: live,
                    recording,
                });
                Ok(())
            }
            Err(err) => {
                *mic = Mic::Idle;
                Err(err)
            }
        },
        Press::Busy(held) => {
            *mic = Mic::Hot(held);
            Err("already listening".to_string())
        }
    }
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    requirements()?;
    let held = {
        let mut mic = lock(&state.shared.mic);
        match release(std::mem::replace(&mut *mic, Mic::Idle)) {
            Released::Idle => return Err("not listening".to_string()),
            Released::Captured(held) => held,
        }
    };
    if held.feed.is_some() {
        stop_stream(state, held)
    } else {
        stop_clip(state, held.recording)
    }
}

fn stop_clip(state: &SpeechState, recording: Recording) -> Result<String, String> {
    let Recording {
        stream,
        samples,
        sample_rate,
    } = recording;
    drop(stream);
    let audio = lock(&samples).clone();
    lock(&state.shared.supervisor).transcribe(&audio, sample_rate)
}

fn stop_stream(state: &SpeechState, mut held: Held) -> Result<String, String> {
    let Some(mut live) = held.feed.take() else {
        return stop_clip(state, held.recording);
    };
    live.join();
    let Recording {
        stream,
        samples,
        sample_rate,
    } = held.recording;
    drop(stream);
    let audio = lock(&samples).clone();
    let failure = live.failure();
    let mut supervisor = lock(&state.shared.supervisor);
    let flushed = live.flush(&audio, sample_rate, &mut supervisor);
    let finished = supervisor.finish();
    drop(supervisor);
    drop(live);
    match (failure, flushed, finished) {
        (Some(err), _, _) => Err(err),
        (_, Err(err), _) => Err(err),
        (_, _, Err(err)) => Err(err),
        (None, Ok(()), Ok(text)) => Ok(text),
    }
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod test_support;
