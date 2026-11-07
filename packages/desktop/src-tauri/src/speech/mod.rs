mod capture;
mod parakeet;
mod pcm;
mod resident;
pub(crate) mod speak;

use std::sync::{Arc, Mutex, MutexGuard};

use capture::Recording;
use resident::{load_engine, require_model, with_resident, ResidentStt};

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    model: Mutex<Option<resident::SttEngine>>,
    recording: Mutex<Option<Recording>>,
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(SpeechShared {
                model: Mutex::new(None),
                recording: Mutex::new(None),
            }),
        }
    }
}

pub(crate) fn speech_transcribe(state: &SpeechState, path: String) -> Result<String, String> {
    require_model()?;
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let (rate, samples) = pcm::decode_wav(&bytes)?;
    transcribe_samples(state, &samples, rate)
}

pub(crate) fn speech_listen_start(state: &SpeechState) -> Result<(), String> {
    require_model()?;
    let mut slot = lock(&state.shared.recording);
    if slot.is_some() {
        return Err("already listening".to_string());
    }
    *slot = Some(capture::open_input()?);
    Ok(())
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    require_model()?;
    let recording = {
        let mut slot = lock(&state.shared.recording);
        slot.take().ok_or_else(|| "not listening".to_string())?
    };
    let Recording {
        stream,
        samples,
        sample_rate,
    } = recording;
    drop(stream);
    let captured = lock(&samples).clone();
    transcribe_samples(state, &captured, sample_rate)
}

fn transcribe_samples(
    state: &SpeechState,
    samples: &[f32],
    sample_rate: u32,
) -> Result<String, String> {
    let mut slot = lock(&state.shared.model);
    with_resident(&mut slot, load_engine, |engine| {
        engine.transcribe(samples, sample_rate)
    })
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
#[path = "listen_test.rs"]
mod listen_test;
