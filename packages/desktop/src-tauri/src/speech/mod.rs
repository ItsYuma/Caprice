mod bark;
mod capture;
mod contract;
mod engine;
mod parakeet;
mod pcm;
mod phase;
mod protocol;
mod reply;
pub(crate) mod speak;
mod supervisor;
mod woof;
pub(crate) mod worker;

pub(crate) use woof::ReplyState;

use std::sync::{Arc, Mutex, MutexGuard};

use capture::Recording;
use engine::requirements;
use phase::{press, release, Mic, Press, Released};
use supervisor::Supervisor;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    supervisor: Mutex<Supervisor>,
    mic: Mutex<Mic<Recording>>,
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(SpeechShared {
                supervisor: Mutex::new(Supervisor::new()),
                mic: Mutex::new(Mic::Idle),
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
    requirements()?;
    let mut mic = lock(&state.shared.mic);
    match press(std::mem::replace(&mut *mic, Mic::Idle)) {
        Press::Open => match capture::open_input() {
            Ok(recording) => {
                *mic = Mic::Hot(recording);
                Ok(())
            }
            Err(err) => {
                *mic = Mic::Idle;
                Err(err)
            }
        },
        Press::Busy(recording) => {
            *mic = Mic::Hot(recording);
            Err("already listening".to_string())
        }
    }
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    requirements()?;
    let captured = {
        let mut mic = lock(&state.shared.mic);
        match release(std::mem::replace(&mut *mic, Mic::Idle)) {
            Released::Idle => return Err("not listening".to_string()),
            Released::Captured(recording) => {
                let Recording {
                    stream,
                    samples,
                    sample_rate,
                } = recording;
                drop(stream);
                let audio = lock(&samples).clone();
                (audio, sample_rate)
            }
        }
    };
    lock(&state.shared.supervisor).transcribe(&captured.0, captured.1)
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod test_support;
