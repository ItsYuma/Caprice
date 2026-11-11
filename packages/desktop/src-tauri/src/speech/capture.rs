use std::mem;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;

use super::limit::recording_samples;
use super::lock;

pub(super) struct Captured {
    samples: Vec<f32>,
    failure: Option<String>,
}

pub(super) struct Recording {
    stream: cpal::Stream,
    pub(super) captured: Arc<Mutex<Captured>>,
    pub(super) sample_rate: u32,
}

impl Drop for Recording {
    fn drop(&mut self) {
        let _ = self.stream.pause();
    }
}

pub(super) fn open_input() -> Result<Recording, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no microphone is available".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|err| err.to_string())?;
    let sample_rate = supported.sample_rate();
    let channels = usize::from(supported.channels());
    let sample_format = supported.sample_format();
    let captured = Arc::new(Mutex::new(Captured {
        samples: Vec::new(),
        failure: None,
    }));
    let stream = build_stream(
        &device,
        supported.config(),
        sample_format,
        channels,
        sample_rate,
        Arc::clone(&captured),
    )?;
    // cpal leaves a new stream stopped until play, including capture.
    stream.play().map_err(|err| err.to_string())?;
    Ok(Recording {
        stream,
        captured,
        sample_rate,
    })
}

pub(super) fn take_fresh(captured: &Mutex<Captured>) -> (Vec<f32>, Option<String>) {
    let mut guard = lock(captured);
    (mem::take(&mut guard.samples), guard.failure.clone())
}

pub(super) fn captured_len(captured: &Mutex<Captured>) -> usize {
    lock(captured).samples.len()
}

pub(super) fn copy_range(captured: &Mutex<Captured>, start: usize, end: usize) -> Vec<f32> {
    let guard = lock(captured);
    let end = end.min(guard.samples.len());
    let start = start.min(end);
    guard.samples[start..end].to_vec()
}

fn build_stream(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    sample_rate: u32,
    captured: Arc<Mutex<Captured>>,
) -> Result<cpal::Stream, String> {
    match sample_format {
        cpal::SampleFormat::I8 => stream_of::<i8>(device, config, channels, sample_rate, captured),
        cpal::SampleFormat::I16 => {
            stream_of::<i16>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::I24 => {
            stream_of::<cpal::I24>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::I32 => {
            stream_of::<i32>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::I64 => {
            stream_of::<i64>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::U8 => stream_of::<u8>(device, config, channels, sample_rate, captured),
        cpal::SampleFormat::U16 => {
            stream_of::<u16>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::U24 => {
            stream_of::<cpal::U24>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::U32 => {
            stream_of::<u32>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::U64 => {
            stream_of::<u64>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::F32 => {
            stream_of::<f32>(device, config, channels, sample_rate, captured)
        }
        cpal::SampleFormat::F64 => {
            stream_of::<f64>(device, config, channels, sample_rate, captured)
        }
        other => Err(format!("unsupported microphone format: {other}")),
    }
}

fn stream_of<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    sample_rate: u32,
    captured: Arc<Mutex<Captured>>,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let max = recording_samples(sample_rate);
    let failure = Arc::clone(&captured);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                append_frames(&captured, data, channels, max);
            },
            move |err| {
                note_failure(&failure, format!("microphone closed: {err}"));
            },
            None,
        )
        .map_err(|err| err.to_string())
}

fn append_frames<T>(captured: &Mutex<Captured>, data: &[T], channels: usize, max: usize)
where
    T: Sample,
    f32: cpal::FromSample<T>,
{
    if channels == 0 {
        return;
    }
    for frame in data.chunks_exact(channels) {
        let mut sum = 0.0f32;
        for sample in frame.iter().copied() {
            sum += sample.to_sample::<f32>();
        }
        if !push_sample(captured, sum / channels as f32, max) {
            return;
        }
    }
}

fn push_sample(captured: &Mutex<Captured>, sample: f32, max: usize) -> bool {
    let mut guard = lock(captured);
    if guard.failure.is_some() {
        return false;
    }
    if guard.samples.len() >= max {
        guard.failure = Some("recording is too long".to_string());
        return false;
    }
    guard.samples.push(sample);
    true
}

fn note_failure(captured: &Mutex<Captured>, message: String) {
    let mut guard = lock(captured);
    if guard.failure.is_none() {
        guard.failure = Some(message);
    }
}

#[cfg(test)]
#[path = "capture_test.rs"]
mod tests;
