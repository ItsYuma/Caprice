mod bark;
mod bark_stream;
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
use engine::requirements;
use phase::{press, release, Mic, Press, Released};
use supervisor::Supervisor;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    feed: Mutex<Option<feed::Feeder>>,
    supervisor: Mutex<Supervisor>,
    mic: Mutex<Mic<Recording>>,
}

impl Drop for SpeechShared {
    fn drop(&mut self) {
        *lock(&self.mic) = Mic::Idle;
        let feeder = lock(&self.feed).take();
        drop(feeder);
    }
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(SpeechShared {
                feed: Mutex::new(None),
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
    let (_, kind) = requirements()?;
    let mut mic = lock(&state.shared.mic);
    match press(std::mem::replace(&mut *mic, Mic::Idle)) {
        Press::Open => match capture::open_input() {
            Ok(recording) => {
                if kind.streams() {
                    let feeder = feed::Feeder::start(
                        &state.shared,
                        Arc::clone(&recording.samples),
                        recording.sample_rate,
                    );
                    *lock(&state.shared.feed) = Some(feeder);
                }
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
    let (_, kind) = requirements()?;
    let (samples, sample_rate) = {
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
                (samples, sample_rate)
            }
        }
    };
    let fed = match lock(&state.shared.feed).take() {
        Some(feeder) => feeder.stop(),
        None => Ok(()),
    };
    if kind.streams() {
        let text = lock(&state.shared.supervisor).finish();
        fed?;
        return text;
    }
    fed?;
    let audio = lock(&samples).clone();
    lock(&state.shared.supervisor).transcribe(&audio, sample_rate)
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod test_support;
