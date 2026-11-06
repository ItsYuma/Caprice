use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    worker: Mutex<Option<SpeechWorker>>,
    recording: Mutex<Option<Recording>>,
}

struct SpeechWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    next_id: u64,
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
                worker: Mutex::new(None),
                recording: Mutex::new(None),
            }),
        }
    }
}

impl Drop for SpeechWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(crate) fn speech_transcribe(state: &SpeechState, path: String) -> Result<String, String> {
    let mut slot = lock(&state.shared.worker);
    if slot.is_none() {
        *slot = Some(spawn_worker()?);
    }
    let worker = slot
        .as_mut()
        .ok_or_else(|| "speech worker exited".to_string())?;
    let id = worker.next_id.to_string();
    worker.next_id = worker.next_id.saturating_add(1);
    write_transcribe(worker, &id, &path)
}

pub(crate) fn speech_listen_start(state: &SpeechState) -> Result<(), String> {
    worker_script()?;
    let mut slot = lock(&state.shared.recording);
    if slot.is_some() {
        return Err("already listening".to_string());
    }
    *slot = Some(open_input()?);
    Ok(())
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<String, String> {
    worker_script()?;
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
    let bytes = encode_wav(sample_rate, &captured);
    let path = wav_file_path();
    if let Err(err) = std::fs::write(&path, &bytes) {
        let _ = std::fs::remove_file(&path);
        return Err(err.to_string());
    }
    let result = speech_transcribe(state, path.to_string_lossy().into_owned());
    let _ = std::fs::remove_file(&path);
    result
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

fn worker_script() -> Result<String, String> {
    match std::env::var("CAPRICE_STT_WORKER") {
        Ok(path) if !path.is_empty() => Ok(path),
        _ => Err("CAPRICE_STT_WORKER is not set".to_string()),
    }
}

fn python_program() -> String {
    match std::env::var("CAPRICE_STT_PYTHON") {
        Ok(program) if !program.is_empty() => program,
        _ => "python3".to_string(),
    }
}

fn spawn_worker() -> Result<SpeechWorker, String> {
    let script = worker_script()?;
    let mut child = Command::new(python_program())
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| err.to_string())?;
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => return Err(reap(&mut child)),
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => return Err(reap(&mut child)),
    };
    let mut worker = SpeechWorker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_id: 1,
    };
    read_ready(&mut worker)?;
    Ok(worker)
}

fn reap(child: &mut Child) -> String {
    let _ = child.kill();
    let _ = child.wait();
    "speech worker exited".to_string()
}

fn read_ready(worker: &mut SpeechWorker) -> Result<(), String> {
    let mut line = String::new();
    match worker.stdout.read_line(&mut line) {
        Ok(0) | Err(_) => return Err("speech worker exited".to_string()),
        Ok(_) => {}
    }
    let value: serde_json::Value =
        serde_json::from_str(line.trim()).map_err(|err| err.to_string())?;
    match value.get("type").and_then(|kind| kind.as_str()) {
        Some("ready") => Ok(()),
        Some("error") => {
            let message = value
                .get("message")
                .and_then(|message| message.as_str())
                .unwrap_or("")
                .to_string();
            Err(message)
        }
        _ => Err("speech worker exited".to_string()),
    }
}

fn write_transcribe(worker: &mut SpeechWorker, id: &str, path: &str) -> Result<String, String> {
    let request = serde_json::json!({
        "id": id,
        "op": "transcribe",
        "path": path,
    });
    let line = serde_json::to_string(&request).map_err(|err| err.to_string())?;
    if writeln!(worker.stdin, "{line}").is_err() || worker.stdin.flush().is_err() {
        return Err(reap(&mut worker.child));
    }
    let mut response = String::new();
    match worker.stdout.read_line(&mut response) {
        Ok(0) | Err(_) => Err(reap(&mut worker.child)),
        Ok(_) => parse_transcript(&response, id),
    }
}

fn parse_transcript(line: &str, id: &str) -> Result<String, String> {
    let value: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(value) => value,
        Err(_) => return Err("speech worker response did not match".to_string()),
    };
    let response_id = value.get("id").and_then(|item| item.as_str()).unwrap_or("");
    if response_id != id {
        return Err("speech worker response did not match".to_string());
    }
    if let Some(error) = value.get("error").and_then(|error| error.as_str()) {
        return Err(error.to_string());
    }
    if let Some(text) = value.get("text").and_then(|text| text.as_str()) {
        return Ok(text.to_string());
    }
    Err("speech worker response did not match".to_string())
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

fn pcm_i16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * 32767.0;
    scaled.round() as i16
}

fn wav_file_path() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("caprice-{}-{n}.wav", std::process::id()))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
fn worker_pid(state: &SpeechState) -> Option<u32> {
    lock(&state.shared.worker)
        .as_ref()
        .map(|worker| worker.child.id())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use super::{
        encode_wav, speech_listen_start, speech_listen_stop, speech_speak, speech_transcribe,
        worker_pid, SpeechState,
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

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("caprice-{label}-{}-{n}", std::process::id()));
            std::fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write_script(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("worker.py");
        std::fs::write(&path, body).expect("script");
        path
    }

    #[test]
    fn resident_worker_transcribes_twice() {
        let _lock = env_lock();
        let dir = TempDir::new("resident");
        let log = dir.0.join("log.txt");
        let clip = dir.0.join("clip.wav");
        std::fs::write(&clip, b"not-audio").expect("clip");
        let script = write_script(
            &dir.0,
            r#"
import json, os, sys
print("ignored", file=sys.stderr, flush=True)
log = os.environ["CAPRICE_STT_LOG"]
with open(log, "a", encoding="utf-8") as handle:
    handle.write("start %s\n" % os.getpid())
print(json.dumps({"type": "ready", "device": "cpu", "compute": "int8"}), flush=True)
while True:
    line = sys.stdin.readline()
    if line == "":
        break
    req = json.loads(line)
    with open(log, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(req, separators=(",", ":")) + "\n")
    if os.path.isfile(req["path"]):
        print(json.dumps({"id": req["id"], "text": "heard"}), flush=True)
    else:
        print(json.dumps({"id": req["id"], "error": "missing"}), flush=True)
"#,
        );
        let _python = EnvGuard::set("CAPRICE_STT_PYTHON", None);
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", script.to_str());
        let _log = EnvGuard::set("CAPRICE_STT_LOG", log.to_str());
        let state = SpeechState::new();
        let clip_arg = clip.to_string_lossy().into_owned();

        let first = speech_transcribe(&state, clip_arg.clone()).expect("first");
        let pid = worker_pid(&state);
        let second = speech_transcribe(&state, clip_arg.clone()).expect("second");
        let missing = speech_transcribe(
            &state,
            dir.0.join("gone.wav").to_string_lossy().into_owned(),
        );

        assert_eq!(first, "heard");
        assert_eq!(second, "heard");
        assert_eq!(missing.unwrap_err(), "missing");
        assert!(pid.is_some());
        assert_eq!(pid, worker_pid(&state));
        let log_text = std::fs::read_to_string(&log).expect("log");
        let starts: Vec<_> = log_text
            .lines()
            .filter(|line| line.starts_with("start "))
            .collect();
        assert_eq!(starts.len(), 1);
        let logged_pid: u32 = starts[0].trim_start_matches("start ").parse().expect("pid");
        assert_eq!(Some(logged_pid), pid);
        assert!(Path::new(&format!("/proc/{logged_pid}")).exists());
        let requests: Vec<serde_json::Value> = log_text
            .lines()
            .filter(|line| line.starts_with('{'))
            .map(|line| serde_json::from_str(line).expect("request"))
            .collect();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["id"], "1");
        assert_eq!(requests[1]["id"], "2");
        assert_eq!(requests[0]["op"], "transcribe");
        assert_eq!(requests[0]["path"], clip_arg);
        assert_eq!(requests[1]["path"], clip_arg);

        drop(state);
        let mut gone = false;
        for _ in 0..100 {
            if !Path::new(&format!("/proc/{logged_pid}")).exists() {
                gone = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(gone, "worker still running");
    }

    #[test]
    fn missing_stt_worker() {
        let _lock = env_lock();
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", None);
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "CAPRICE_STT_WORKER is not set"
        );
        assert_eq!(
            speech_listen_start(&state).unwrap_err(),
            "CAPRICE_STT_WORKER is not set"
        );
        assert_eq!(
            speech_listen_stop(&state).unwrap_err(),
            "CAPRICE_STT_WORKER is not set"
        );
        assert!(worker_pid(&state).is_none());
    }

    #[test]
    fn worker_ready_error_is_the_message() {
        let _lock = env_lock();
        let dir = TempDir::new("ready-error");
        let script = write_script(
            &dir.0,
            r#"
import json
print(json.dumps({"type": "error", "message": "weights missing"}), flush=True)
"#,
        );
        let _python = EnvGuard::set("CAPRICE_STT_PYTHON", None);
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", script.to_str());
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "weights missing"
        );
        assert!(worker_pid(&state).is_none());
    }

    #[test]
    fn worker_response_id_must_match() {
        let _lock = env_lock();
        let dir = TempDir::new("mismatch");
        let script = write_script(
            &dir.0,
            r#"
import json, sys
print(json.dumps({"type": "ready", "device": "cuda", "compute": "float16"}), flush=True)
sys.stdin.readline()
print(json.dumps({"id": "other", "text": "nope"}), flush=True)
"#,
        );
        let _python = EnvGuard::set("CAPRICE_STT_PYTHON", None);
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", script.to_str());
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "speech worker response did not match"
        );
    }

    #[test]
    fn worker_exit_is_reported() {
        let _lock = env_lock();
        let dir = TempDir::new("exit");
        let script = write_script(
            &dir.0,
            r#"
import json, sys
print(json.dumps({"type": "ready", "device": "cpu", "compute": "int8"}), flush=True)
sys.exit(0)
"#,
        );
        let _python = EnvGuard::set("CAPRICE_STT_PYTHON", None);
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", script.to_str());
        let state = SpeechState::new();
        assert_eq!(
            speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
            "speech worker exited"
        );
    }

    #[test]
    fn listen_stop_when_idle() {
        let _lock = env_lock();
        let _worker = EnvGuard::set("CAPRICE_STT_WORKER", Some("/tmp/caprice-not-a-worker.py"));
        let state = SpeechState::new();
        assert_eq!(speech_listen_stop(&state).unwrap_err(), "not listening");
        assert!(worker_pid(&state).is_none());
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
