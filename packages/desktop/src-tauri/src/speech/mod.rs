mod capture;
mod http_stt;
mod limit;
mod pcm;
mod reply;
pub(crate) mod speak;
#[cfg(test)]
mod test_support;
mod unified;
mod vad;

pub(crate) use http_stt::post_clip;
pub(crate) use reply::speech_reply_cancel;
pub(crate) use reply::ReplyState;

use std::mem;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use capture::Recording;
use http_stt::SttClip;
use limit::stt_deadline;
use tauri::Emitter;
use unified::UnifiedEngine;
use vad::{frame_samples, Endpoint};

use crate::talk_keys::TALK_RELEASE;

#[derive(Clone)]
pub(crate) struct SpeechState {
    shared: Arc<SpeechShared>,
}

struct SpeechShared {
    mic: Mutex<Mic>,
    engine: Mutex<Option<LoadedModel>>,
    generation: AtomicU64,
    abort_notice: AtomicBool,
}

struct LoadedModel {
    path: std::path::PathBuf,
    engine: Arc<UnifiedEngine>,
}

enum Mic {
    Idle,
    Live(LiveListen),
}

struct LiveListen {
    recording: Recording,
    stop: Arc<AtomicBool>,
    watch: Option<JoinHandle<()>>,
    ticket: u64,
}

impl Drop for LiveListen {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(watch) = self.watch.take() {
            let _ = watch.join();
        }
    }
}

#[derive(Debug)]
pub(crate) enum ListenStop {
    Text(String),
    Http(SttClip),
}

impl SpeechState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(SpeechShared {
                mic: Mutex::new(Mic::Idle),
                engine: Mutex::new(None),
                generation: AtomicU64::new(0),
                abort_notice: AtomicBool::new(false),
            }),
        }
    }
}

pub(crate) fn speech_listen_start(
    app: &tauri::AppHandle,
    state: &SpeechState,
) -> Result<(), String> {
    let _ = stt_deadline()?;
    let _choice = stt_choice()?;
    let vad_mode = crate::settings::recording_mode() == "vad";
    let sensitivity = f32::from(crate::settings::vad_sensitivity());
    let ticket = state.shared.generation.load(Ordering::Acquire);
    let opened = capture::open_input()?;
    if state.shared.generation.load(Ordering::Acquire) != ticket {
        drop(opened);
        return Err("listening cancelled".to_string());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let watch = if vad_mode {
        Some(spawn_watch(
            app.clone(),
            Arc::clone(&opened.captured),
            opened.sample_rate,
            sensitivity,
            Arc::clone(&stop),
        )?)
    } else {
        None
    };
    let mut mic = lock(&state.shared.mic);
    if state.shared.generation.load(Ordering::Acquire) != ticket {
        drop(mic);
        drop(LiveListen {
            recording: opened,
            stop,
            watch,
            ticket,
        });
        return Err("listening cancelled".to_string());
    }
    if !matches!(*mic, Mic::Idle) {
        drop(mic);
        drop(LiveListen {
            recording: opened,
            stop,
            watch,
            ticket,
        });
        return Err("already listening".to_string());
    }
    *mic = Mic::Live(LiveListen {
        recording: opened,
        stop,
        watch,
        ticket,
    });
    state.shared.abort_notice.store(false, Ordering::Release);
    Ok(())
}

pub(crate) fn speech_listen_stop(state: &SpeechState) -> Result<ListenStop, String> {
    let live = {
        let mut mic = lock(&state.shared.mic);
        match mem::replace(&mut *mic, Mic::Idle) {
            Mic::Live(live) => live,
            Mic::Idle => {
                if state.shared.abort_notice.swap(false, Ordering::AcqRel) {
                    return Err("listening cancelled".to_string());
                }
                return Err("not listening".to_string());
            }
        }
    };
    let ticket = live.ticket;
    let sample_rate = live.recording.sample_rate;
    let (samples, failure) = capture::take_fresh(&live.recording.captured);
    drop(live);
    if state.shared.generation.load(Ordering::Acquire) != ticket {
        return Err("listening cancelled".to_string());
    }
    if let Some(failure) = failure {
        return Err(failure);
    }
    match stt_choice()? {
        SttChoice::Parakeet(path) => {
            let engine = engine_for(state, &path)?;
            if state.shared.generation.load(Ordering::Acquire) != ticket {
                engine.cancel();
                return Err("listening cancelled".to_string());
            }
            let text = engine.transcribe(&samples, sample_rate)?;
            if state.shared.generation.load(Ordering::Acquire) != ticket {
                return Err("listening cancelled".to_string());
            }
            Ok(ListenStop::Text(text))
        }
        SttChoice::Http { url, model } => Ok(ListenStop::Http(SttClip {
            samples,
            rate: sample_rate,
            url,
            model,
        })),
    }
}

pub(crate) fn speech_cancel(state: &SpeechState) -> Result<(), String> {
    state.shared.generation.fetch_add(1, Ordering::AcqRel);
    let engine = lock(&state.shared.engine)
        .as_ref()
        .map(|loaded| Arc::clone(&loaded.engine));
    if let Some(engine) = engine {
        engine.cancel();
    }
    let stopped = {
        let mut mic = lock(&state.shared.mic);
        match mem::replace(&mut *mic, Mic::Idle) {
            Mic::Live(live) => Some(live),
            Mic::Idle => None,
        }
    };
    if let Some(live) = stopped {
        drop(live);
        state.shared.abort_notice.store(true, Ordering::Release);
    }
    Ok(())
}

#[derive(Debug)]
enum SttChoice {
    Parakeet(String),
    Http { url: String, model: String },
}

fn stt_choice() -> Result<SttChoice, String> {
    let configured = crate::settings::stt_engine();
    let name = configured.trim();
    match name {
        "" | "parakeet" => {
            let model = crate::settings::stt_model();
            if model.trim().is_empty() {
                return Err("CAPRICE_STT_MODEL is not set".to_string());
            }
            Ok(SttChoice::Parakeet(model.trim().to_string()))
        }
        "http" => {
            let url = crate::settings::stt_url();
            let model = crate::settings::stt_model();
            if url.trim().is_empty() {
                return Err("CAPRICE_STT_URL is not set".to_string());
            }
            if model.trim().is_empty() {
                return Err("CAPRICE_STT_MODEL is not set".to_string());
            }
            Ok(SttChoice::Http {
                url: url.trim().to_string(),
                model: model.trim().to_string(),
            })
        }
        "bark" | "bark-stream" | "onnx" => Err(format!("{name} is retired. Use parakeet or http.")),
        other => Err(format!("unknown speech engine: {other}")),
    }
}

fn engine_for(state: &SpeechState, path: &str) -> Result<Arc<UnifiedEngine>, String> {
    let mut slot = lock(&state.shared.engine);
    if let Some(loaded) = slot.as_ref() {
        if loaded.path == Path::new(path) {
            return Ok(Arc::clone(&loaded.engine));
        }
    }
    let engine = Arc::new(unified::load_at(Path::new(path))?);
    *slot = Some(LoadedModel {
        path: Path::new(path).to_path_buf(),
        engine: Arc::clone(&engine),
    });
    Ok(engine)
}

fn spawn_watch(
    app: tauri::AppHandle,
    captured: Arc<Mutex<capture::Captured>>,
    rate: u32,
    sensitivity: f32,
    stop: Arc<AtomicBool>,
) -> Result<JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name("speech-vad".to_string())
        .spawn(move || watch(app, captured, rate, sensitivity, stop))
        .map_err(|err| err.to_string())
}

fn watch(
    app: tauri::AppHandle,
    captured: Arc<Mutex<capture::Captured>>,
    rate: u32,
    sensitivity: f32,
    stop: Arc<AtomicBool>,
) {
    let mut endpoint = Endpoint::new(rate);
    let frame = frame_samples(rate);
    let mut seen = 0usize;
    while !stop.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(20));
        if stop.load(Ordering::Acquire) {
            return;
        }
        let total = capture::captured_len(&captured);
        while seen + frame <= total {
            let samples = capture::copy_range(&captured, seen, seen + frame);
            seen += frame;
            if endpoint.push(&samples, sensitivity) {
                let _ = app.emit(TALK_RELEASE, ());
                return;
            }
        }
    }
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
mod lifecycle {
    use super::{speech_cancel, speech_listen_stop, stt_choice, SpeechState};
    use crate::speech::test_support::{env_lock, EnvGuard};

    #[test]
    fn cancel_while_idle_can_run_twice() {
        let state = SpeechState::new();
        speech_cancel(&state).expect("cancel");
        speech_cancel(&state).expect("cancel again");
        assert_eq!(speech_listen_stop(&state).unwrap_err(), "not listening");
    }

    #[test]
    fn an_empty_engine_is_parakeet_and_retired_names_are_rejected() {
        let _lock = env_lock();
        let _engine = EnvGuard::set("CAPRICE_STT_ENGINE", None);
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", None);
        let _url = EnvGuard::set("CAPRICE_STT_URL", None);
        assert_eq!(stt_choice().unwrap_err(), "CAPRICE_STT_MODEL is not set");
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some("/models/parakeet.gguf"));
        match stt_choice().unwrap() {
            super::SttChoice::Parakeet(path) => assert_eq!(path, "/models/parakeet.gguf"),
            super::SttChoice::Http { .. } => panic!("http"),
        }
        let _engine = EnvGuard::set("CAPRICE_STT_ENGINE", Some(" bark-stream "));
        assert_eq!(
            stt_choice().unwrap_err(),
            "bark-stream is retired. Use parakeet or http."
        );
        let _engine = EnvGuard::set("CAPRICE_STT_ENGINE", Some("onnx"));
        assert_eq!(
            stt_choice().unwrap_err(),
            "onnx is retired. Use parakeet or http."
        );
        let _engine = EnvGuard::set("CAPRICE_STT_ENGINE", Some("http"));
        let _url = EnvGuard::set("CAPRICE_STT_URL", None);
        assert_eq!(stt_choice().unwrap_err(), "CAPRICE_STT_URL is not set");
        let _url = EnvGuard::set("CAPRICE_STT_URL", Some("http://127.0.0.1/stt"));
        let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some(" remote "));
        match stt_choice().unwrap() {
            super::SttChoice::Http { url, model } => {
                assert_eq!(url, "http://127.0.0.1/stt");
                assert_eq!(model, "remote");
            }
            super::SttChoice::Parakeet(_) => panic!("parakeet"),
        }
        let _engine = EnvGuard::set("CAPRICE_STT_ENGINE", Some("whisper"));
        assert_eq!(stt_choice().unwrap_err(), "unknown speech engine: whisper");
    }
}
