pub(super) trait Transcriber {
    fn transcribe(&mut self, samples: &[f32], sample_rate: u32) -> Result<String, String>;
}
