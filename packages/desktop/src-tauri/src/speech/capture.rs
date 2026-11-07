use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;

use super::lock;

pub(super) struct Recording {
    pub(super) stream: cpal::Stream,
    pub(super) samples: Arc<Mutex<Vec<f32>>>,
    pub(super) sample_rate: u32,
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
    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let stream = build_stream(
        &device,
        supported.config(),
        sample_format,
        channels,
        Arc::clone(&samples),
    )?;
    // cpal leaves a new stream stopped until play, including capture.
    stream.play().map_err(|err| err.to_string())?;
    Ok(Recording {
        stream,
        samples,
        sample_rate,
    })
}

fn build_stream(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String> {
    match sample_format {
        cpal::SampleFormat::I8 => stream_of::<i8>(device, config, channels, samples),
        cpal::SampleFormat::I16 => stream_of::<i16>(device, config, channels, samples),
        cpal::SampleFormat::I24 => stream_of::<cpal::I24>(device, config, channels, samples),
        cpal::SampleFormat::I32 => stream_of::<i32>(device, config, channels, samples),
        cpal::SampleFormat::I64 => stream_of::<i64>(device, config, channels, samples),
        cpal::SampleFormat::U8 => stream_of::<u8>(device, config, channels, samples),
        cpal::SampleFormat::U16 => stream_of::<u16>(device, config, channels, samples),
        cpal::SampleFormat::U24 => stream_of::<cpal::U24>(device, config, channels, samples),
        cpal::SampleFormat::U32 => stream_of::<u32>(device, config, channels, samples),
        cpal::SampleFormat::U64 => stream_of::<u64>(device, config, channels, samples),
        cpal::SampleFormat::F32 => stream_of::<f32>(device, config, channels, samples),
        cpal::SampleFormat::F64 => stream_of::<f64>(device, config, channels, samples),
        other => Err(format!("unsupported microphone format: {other}")),
    }
}

fn stream_of<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                append_frames(&samples, data, channels);
            },
            |err| {
                let _ = err;
            },
            None,
        )
        .map_err(|err| err.to_string())
}

fn append_frames<T>(samples: &Mutex<Vec<f32>>, data: &[T], channels: usize)
where
    T: Sample,
    f32: cpal::FromSample<T>,
{
    if channels == 0 {
        return;
    }
    let mut guard = lock(samples);
    for frame in data.chunks_exact(channels) {
        let mut sum = 0.0f32;
        for sample in frame.iter().copied() {
            sum += sample.to_sample::<f32>();
        }
        guard.push(sum / channels as f32);
    }
}
