use super::parakeet;

pub(super) trait ResidentStt {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String>;
}

pub(super) enum SttEngine {
    Parakeet(parakeet::ParakeetEngine),
}

impl ResidentStt for SttEngine {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        match self {
            Self::Parakeet(engine) => engine.transcribe(samples, sample_rate),
        }
    }
}

pub(super) fn require_model() -> Result<(), String> {
    parakeet::require_model()
}

pub(super) fn load_engine() -> Result<SttEngine, String> {
    Ok(SttEngine::Parakeet(parakeet::load()?))
}

pub(super) fn with_resident<T, R>(
    slot: &mut Option<T>,
    load: impl FnOnce() -> Result<T, String>,
    use_model: impl FnOnce(&mut T) -> Result<R, String>,
) -> Result<R, String> {
    if slot.is_none() {
        *slot = Some(load()?);
    }
    let model = match slot.as_mut() {
        Some(model) => model,
        None => return Err("speech model is not loaded".to_string()),
    };
    use_model(model)
}

#[cfg(test)]
#[path = "resident_test.rs"]
mod tests;
