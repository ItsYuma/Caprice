use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

const PARAKEET_RATE: u32 = 16_000;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    model: Mutex<Option<ParakeetModel>>,
    recording: Mutex<Option<Recording>>,
}

struct Recording {
    stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
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
    model_dir()?;
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    let (rate, samples) = decode_wav(&bytes)?;
    transcribe_samples(state, &samples, rate)
}

pub(crate) fn speech_listen_start(state: &SpeechState) -> Result<(), String> {
    model_dir()?;
    let mut slot = lock(&state.shared.recording);
    if slot.is_some() {
        return Err("already listening".to_string());
    }
    *slot = Some(open_input()?);
    Ok(())
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    model_dir()?;
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

#[tauri::command]
pub(crate) async fn speech_speak(text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }
    let url = match std::env::var("CAPRICE_TTS_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return Err("speech is not configured".to_string()),
    };
    let model = match std::env::var("CAPRICE_TTS_MODEL") {
        Ok(model) if !model.is_empty() => model,
        _ => return Err("CAPRICE_TTS_MODEL is not set".to_string()),
    };
    let voice = std::env::var("CAPRICE_TTS_VOICE").unwrap_or_default();
    let api_key = std::env::var("CAPRICE_TTS_API_KEY").unwrap_or_default();
    let mut payload = serde_json::json!({
        "model": model,
        "input": text,
    });
    if !voice.is_empty() {
        payload["voice"] = serde_json::Value::String(voice);
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .body(payload.to_string());
    if !api_key.is_empty() {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("speech request failed: {}", status.as_u16()));
    }
    Ok(STANDARD.encode(bytes))
}

fn model_dir() -> Result<PathBuf, String> {
    match std::env::var("CAPRICE_STT_MODEL") {
        Ok(path) if !path.trim().is_empty() => Ok(PathBuf::from(path.trim())),
        _ => Err("CAPRICE_STT_MODEL is not set".to_string()),
    }
}

fn load_parakeet() -> Result<ParakeetModel, String> {
    let dir = model_dir()?;
    ParakeetModel::load(&dir, &Quantization::Int8).map_err(|err| err.to_string())
}

fn transcribe_samples(
    state: &SpeechState,
    samples: &[f32],
    sample_rate: u32,
) -> Result<String, String> {
    let mut slot = lock(&state.shared.model);
    with_resident(&mut slot, load_parakeet, |model| {
        hear(model, samples, sample_rate)
    })
}

fn hear(model: &mut ParakeetModel, samples: &[f32], sample_rate: u32) -> Result<String, String> {
    let audio = resample_linear(samples, sample_rate, PARAKEET_RATE);
    if audio.is_empty() {
        return Ok(String::new());
    }
    let result = model
        .transcribe(&audio, &TranscribeOptions::default())
        .map_err(|err| err.to_string())?;
    Ok(result.text.trim().to_string())
}

fn with_resident<T, R>(
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

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if samples.is_empty() || from_rate == 0 || from_rate == to_rate {
        return samples.to_vec();
    }
    let out_len = (samples.len() as u64)
        .saturating_mul(u64::from(to_rate))
        .saturating_div(u64::from(from_rate)) as usize;
    let mut out = Vec::with_capacity(out_len);
    let last = samples.len() - 1;
    for index in 0..out_len {
        let position = index as f64 * f64::from(from_rate) / f64::from(to_rate);
        let left = (position.floor() as usize).min(last);
        let right = (left + 1).min(last);
        let frac = (position - left as f64) as f32;
        out.push(samples[left] * (1.0 - frac) + samples[right] * frac);
    }
    out
}

fn open_input() -> Result<Recording, String> {
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

fn encode_wav(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(44 + data_len);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.saturating_mul(2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&pcm_i16(*sample).to_le_bytes());
    }
    bytes
}

fn decode_wav(bytes: &[u8]) -> Result<(u32, Vec<f32>), String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("wav must be 16-bit mono pcm".to_string());
    }
    let mut offset = 12;
    let mut rate = None;
    let mut pcm = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = le_u32(&bytes[offset + 4..offset + 8]) as usize;
        let start = offset + 8;
        if start + size > bytes.len() {
            return Err("wav must be 16-bit mono pcm".to_string());
        }
        let body = &bytes[start..start + size];
        if id == b"fmt " {
            if body.len() < 16 {
                return Err("wav must be 16-bit mono pcm".to_string());
            }
            let format = u16::from_le_bytes([body[0], body[1]]);
            let channels = u16::from_le_bytes([body[2], body[3]]);
            let bits = u16::from_le_bytes([body[14], body[15]]);
            if format != 1 || channels != 1 || bits != 16 {
                return Err("wav must be 16-bit mono pcm".to_string());
            }
            rate = Some(le_u32(&body[4..8]));
        } else if id == b"data" {
            pcm = Some(body);
        }
        offset = start + size + (size % 2);
    }
    let rate = rate.ok_or_else(|| "wav must be 16-bit mono pcm".to_string())?;
    let pcm = pcm.ok_or_else(|| "wav must be 16-bit mono pcm".to_string())?;
    let mut samples = Vec::with_capacity(pcm.len() / 2);
    for chunk in pcm.chunks_exact(2) {
        let value = i16::from_le_bytes([chunk[0], chunk[1]]);
        samples.push(value as f32 / 32767.0);
    }
    Ok((rate, samples))
}

fn le_u32(bytes: &[u8]) -> u32 {
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn pcm_i16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * 32767.0;
    scaled.round() as i16
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::sync::Mutex;

    use super::{
        decode_wav, encode_wav, resample_linear, speech_listen_stop, speech_speak,
        speech_transcribe, with_resident, SpeechState,
    };

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: Option<&str>) -> Self {
            let previous = std::env::var(key).ok();
            match value {
                Some(value) => unsafe { std::env::set_var(key, value) },
                None => unsafe { std::env::remove_var(key) },
            }
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => unsafe { std::env::set_var(self.key, value) },
                None => unsafe { std::env::remove_var(self.key) },
            }
        }
    }

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        match ENV_LOCK.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    #[test]
    fn missing_stt_model() {
        let _lock = env_lock();
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", None);
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "CAPRICE_STT_MODEL is not set"
        );
        assert_eq!(
            speech_listen_stop(&state).unwrap_err(),
            "CAPRICE_STT_MODEL is not set"
        );
    }

    #[test]
    fn blank_stt_model_is_missing() {
        let _lock = env_lock();
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some("   "));
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "CAPRICE_STT_MODEL is not set"
        );
    }

    #[test]
    fn listen_stop_when_idle() {
        let _lock = env_lock();
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some("/tmp/caprice-parakeet"));
        let state = SpeechState::new();
        assert_eq!(speech_listen_stop(&state).unwrap_err(), "not listening");
    }

    #[test]
    fn model_stays_loaded_across_requests() {
        let mut slot = None;
        let mut loads = 0;
        let first = with_resident(
            &mut slot,
            || {
                loads += 1;
                Ok(7_u8)
            },
            |model| Ok(model.to_string()),
        )
        .unwrap();
        let second = with_resident(
            &mut slot,
            || {
                loads += 1;
                Ok(9_u8)
            },
            |model| Ok(model.to_string()),
        )
        .unwrap();
        assert_eq!(first, "7");
        assert_eq!(second, "7");
        assert_eq!(loads, 1);
    }

    #[test]
    fn a_failed_load_does_not_stick() {
        let mut slot: Option<u8> = None;
        let err = with_resident(
            &mut slot,
            || Err("CAPRICE_STT_MODEL is not set".to_string()),
            |model| Ok(*model),
        )
        .unwrap_err();
        assert_eq!(err, "CAPRICE_STT_MODEL is not set");
        assert!(slot.is_none());
    }

    #[test]
    fn resample_doubles_an_integer_rate() {
        let out = resample_linear(&[0.0, 1.0], 8_000, 16_000);
        assert_eq!(out.len(), 4);
        assert!((out[0] - 0.0).abs() < 0.001);
        assert!((out[1] - 0.5).abs() < 0.001);
        assert!((out[2] - 1.0).abs() < 0.001);
        assert!((out[3] - 1.0).abs() < 0.001);
        assert_eq!(resample_linear(&[0.25], 16_000, 16_000), vec![0.25]);
        assert!(resample_linear(&[], 48_000, 16_000).is_empty());
    }

    #[test]
    fn wav_round_trip_keeps_rate_and_pcm() {
        let bytes = encode_wav(16_000, &[0.0, 1.0, -1.0]);
        let (rate, samples) = decode_wav(&bytes).unwrap();
        assert_eq!(rate, 16_000);
        assert_eq!(samples.len(), 3);
        assert!((samples[0]).abs() < 0.001);
        assert!((samples[1] - 1.0).abs() < 0.001);
        assert!((samples[2] + 1.0).abs() < 0.001);
        assert_eq!(
            decode_wav(b"not-a-wav").unwrap_err(),
            "wav must be 16-bit mono pcm"
        );
    }

    #[test]
    fn wav_encodes_pcm16_mono() {
        let samples = [0.0, 1.0, -1.0, 0.25, 0.5, 2.0, -2.0];
        let bytes = encode_wav(16_000, &samples);
        assert_eq!(bytes.len(), 44 + samples.len() * 2);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            (bytes.len() - 8) as u32
        );
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 16);
        assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(
            u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
            32_000
        );
        assert_eq!(u16::from_le_bytes(bytes[32..34].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bytes[34..36].try_into().unwrap()), 16);
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(
            u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
            (samples.len() * 2) as u32
        );
        assert_eq!(
            &bytes[44..52],
            &[0x00, 0x00, 0xff, 0x7f, 0x01, 0x80, 0x00, 0x20]
        );
        let pcm: Vec<i16> = bytes[44..]
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        assert_eq!(pcm, vec![0, 32767, -32767, 8192, 16384, 32767, -32767]);

        let empty = encode_wav(48_000, &[]);
        assert_eq!(empty.len(), 44);
        assert_eq!(
            u32::from_le_bytes(empty[24..28].try_into().unwrap()),
            48_000
        );
        assert_eq!(
            u32::from_le_bytes(empty[28..32].try_into().unwrap()),
            96_000
        );
        assert_eq!(u32::from_le_bytes(empty[40..44].try_into().unwrap()), 0);
    }

    #[test]
    fn missing_tts_url() {
        let _lock = env_lock();
        let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
        let err = tauri::async_runtime::block_on(speech_speak("hello".into())).unwrap_err();
        assert_eq!(err, "speech is not configured");
    }

    #[test]
    fn blank_text_does_not_speak() {
        let _lock = env_lock();
        let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
        let blank = tauri::async_runtime::block_on(speech_speak(" \n\t".into())).unwrap();
        let empty = tauri::async_runtime::block_on(speech_speak(String::new())).unwrap();
        assert_eq!(blank, "");
        assert_eq!(empty, "");
    }

    #[test]
    fn speech_speak_returns_base64_audio() {
        let _lock = env_lock();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let payload = [0x00_u8, 0x01, 0xff, b'A'];
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for status in [200_u16, 200, 503] {
                let (mut stream, _) = listener.accept().expect("accept");
                let request = read_request(&mut stream);
                if status == 200 {
                    let header = format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        payload.len()
                    );
                    stream.write_all(header.as_bytes()).expect("write");
                    stream.write_all(&payload).expect("body");
                } else {
                    let header = "HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
                    stream.write_all(header.as_bytes()).expect("write");
                }
                requests.push(request);
            }
            requests
        });

        let _url = EnvGuard::set(
            "CAPRICE_TTS_URL",
            Some(&format!("http://127.0.0.1:{port}/custom/speech")),
        );
        let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
        let missing_model =
            tauri::async_runtime::block_on(speech_speak("say \"hi\"".into())).unwrap_err();
        assert_eq!(missing_model, "CAPRICE_TTS_MODEL is not set");

        let _model = EnvGuard::set("CAPRICE_TTS_MODEL", Some("shell-voice"));
        let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("capri"));
        let _key = EnvGuard::set("CAPRICE_TTS_API_KEY", Some("secret"));
        let audio =
            tauri::async_runtime::block_on(speech_speak("say \"hi\"".into())).expect("speak");

        let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", None);
        let _key = EnvGuard::set("CAPRICE_TTS_API_KEY", None);
        let plain =
            tauri::async_runtime::block_on(speech_speak("say \"hi\"".into())).expect("plain");

        let failed = tauri::async_runtime::block_on(speech_speak("say \"hi\"".into())).unwrap_err();
        let requests = server.join().expect("server");

        assert_eq!(audio, "AAH/QQ==");
        assert_eq!(plain, "AAH/QQ==");
        assert_eq!(failed, "speech request failed: 503");
        assert_request(&requests[0], true, true);
        assert_request(&requests[1], false, false);
    }

    fn assert_request(request: &str, bearer: bool, voice: bool) {
        let lower = request.to_ascii_lowercase();
        assert!(lower.starts_with("post /custom/speech "));
        assert!(lower.contains("content-type: application/json"));
        if bearer {
            assert!(lower.contains("authorization: bearer secret"));
        } else {
            assert!(!lower.contains("authorization:"));
        }
        let body = request.split("\r\n\r\n").nth(1).expect("body");
        let json: serde_json::Value = serde_json::from_str(body).expect("json");
        assert_eq!(json["model"], "shell-voice");
        assert_eq!(json["input"], "say \"hi\"");
        if voice {
            assert_eq!(json["voice"], "capri");
        } else {
            assert!(json.get("voice").is_none());
        }
    }

    fn read_request(stream: &mut std::net::TcpStream) -> String {
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("timeout");
        let mut buf = Vec::new();
        let mut tmp = [0_u8; 2048];
        let mut header_end = None;
        let mut content_length = 0usize;
        loop {
            let read = stream.read(&mut tmp).expect("read");
            assert!(read > 0, "eof before request");
            buf.extend_from_slice(&tmp[..read]);
            if header_end.is_none() {
                if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&buf[..pos]).to_string();
                    header_end = Some(pos + 4);
                    content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            if name.eq_ignore_ascii_case("content-length") {
                                value.trim().parse().ok()
                            } else {
                                None
                            }
                        })
                        .expect("content-length");
                }
            }
            if let Some(start) = header_end {
                if buf.len() >= start + content_length {
                    buf.truncate(start + content_length);
                    break;
                }
            }
        }
        String::from_utf8(buf).expect("utf8")
    }

    fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }
}
