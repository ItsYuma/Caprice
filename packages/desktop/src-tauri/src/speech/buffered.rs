pub(super) const RATE: u32 = 16_000;
pub(super) const LEFT_MS: u32 = 5_600;
pub(super) const CHUNK_MS: u32 = 80;
pub(super) const RIGHT_MS: u32 = 80;

pub(super) const LEFT_SAMPLES: usize = samples_for(LEFT_MS);
pub(super) const CHUNK_SAMPLES: usize = samples_for(CHUNK_MS);
pub(super) const RIGHT_SAMPLES: usize = samples_for(RIGHT_MS);

const fn samples_for(ms: u32) -> usize {
    (ms as usize) * (RATE as usize) / 1_000
}

pub(super) trait RangeDecoder {
    fn observe(&mut self, _audio: &[f32]) -> Result<(), String> {
        Ok(())
    }

    fn text_for(
        &mut self,
        audio: &[f32],
        window_start: usize,
        window_end: usize,
        commit_start: usize,
        commit_end: usize,
    ) -> Result<String, String>;

    fn partial_text(&self) -> Option<String> {
        None
    }

    fn final_transcript(&self) -> Option<String> {
        None
    }
}

impl<F> RangeDecoder for F
where
    F: FnMut(&[f32], usize, usize, usize, usize) -> Result<String, String>,
{
    fn text_for(
        &mut self,
        audio: &[f32],
        window_start: usize,
        window_end: usize,
        commit_start: usize,
        commit_end: usize,
    ) -> Result<String, String> {
        self(audio, window_start, window_end, commit_start, commit_end)
    }
}

pub(super) struct Utterance<D> {
    audio: Vec<f32>,
    committed_until: usize,
    text: String,
    decoder: D,
}

impl<D> Utterance<D> {
    pub(super) fn new(decoder: D) -> Self {
        Self {
            audio: Vec::new(),
            committed_until: 0,
            text: String::new(),
            decoder,
        }
    }
}

impl<D: RangeDecoder> Utterance<D> {
    pub(super) fn feed(&mut self, samples: &[f32]) -> Result<String, String> {
        if !samples.is_empty() {
            if self.audio.len().saturating_add(samples.len()) > super::limit::stream_samples() {
                return Err("recording is too long".to_string());
            }
            self.audio.extend_from_slice(samples);
            self.decoder.observe(&self.audio)?;
            self.commit_ready()?;
        }
        if let Some(text) = self.decoder.partial_text() {
            return Ok(text);
        }
        Ok(self.text.clone())
    }

    pub(super) fn finish(&mut self) -> Result<String, String> {
        self.decoder.observe(&self.audio)?;
        self.commit_ready()?;
        if self.committed_until < self.audio.len() {
            let end = self.audio.len();
            let start = self.committed_until;
            let window_start = start.saturating_sub(LEFT_SAMPLES);
            let piece = self
                .decoder
                .text_for(&self.audio, window_start, end, start, end)?;
            self.text.push_str(&piece);
            self.committed_until = end;
        }
        if let Some(text) = self.decoder.final_transcript() {
            return Ok(text);
        }
        Ok(self.text.trim().to_string())
    }

    fn commit_ready(&mut self) -> Result<(), String> {
        while self.audio.len() >= self.committed_until + CHUNK_SAMPLES + RIGHT_SAMPLES {
            let commit_start = self.committed_until;
            let commit_end = commit_start + CHUNK_SAMPLES;
            let window_start = commit_start.saturating_sub(LEFT_SAMPLES);
            let window_end = commit_end + RIGHT_SAMPLES;
            let piece = self.decoder.text_for(
                &self.audio,
                window_start,
                window_end,
                commit_start,
                commit_end,
            )?;
            self.text.push_str(&piece);
            self.committed_until = commit_end;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "buffered_test.rs"]
mod tests;
