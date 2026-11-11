use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::JoinHandle;

use transcribe_cpp::sys::TRANSCRIBE_EXT_KIND_PARAKEET_BUFFERED_STREAM;
use transcribe_cpp::{CancelToken, ErrorKind, ExtSlot, Feature, RunOptions, Session};

use super::pcm::resample_linear;

const RATE: u32 = 16_000;
// transcribe.cpp overflows the default thread stack.
const STACK: usize = 16 * 1024 * 1024;

pub(super) struct UnifiedEngine {
    tx: Sender<Ask>,
    thread: Option<JoinHandle<()>>,
    cancel: CancelToken,
    cancellable: bool,
}

enum Ask {
    Transcribe(Vec<f32>, Sender<Result<String, String>>),
    Stop,
}

impl UnifiedEngine {
    pub(super) fn transcribe(&self, samples: &[f32], sample_rate: u32) -> Result<String, String> {
        let audio = resample_linear(samples, sample_rate, RATE);
        if audio.is_empty() {
            return Ok(String::new());
        }
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Ask::Transcribe(audio, tx))
            .map_err(|_| "parakeet stream stopped".to_string())?;
        rx.recv()
            .map_err(|_| "parakeet stream stopped".to_string())?
    }

    pub(super) fn cancel(&self) {
        if self.cancellable {
            self.cancel.cancel();
        }
    }
}

impl Drop for UnifiedEngine {
    fn drop(&mut self) {
        self.cancel();
        let _ = self.tx.send(Ask::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub(super) fn load_at(path: &Path) -> Result<UnifiedEngine, String> {
    let weights = weights_file(path)?;
    ensure_runtime()?;
    let model = transcribe_cpp::Model::load(&weights).map_err(show)?;
    if !model.accepts_ext(
        ExtSlot::Stream,
        TRANSCRIBE_EXT_KIND_PARAKEET_BUFFERED_STREAM,
    ) {
        return Err("parakeet model is not unified English 0.6B".to_string());
    }
    let cancellable = model.supports(Feature::Cancellation);
    let mut session = model.session().map_err(show)?;
    let cancel = CancelToken::new();
    if cancellable {
        session.set_cancel_token(&cancel);
    }
    spawn(session, cancel, cancellable)
}

fn spawn(
    session: Session,
    cancel: CancelToken,
    cancellable: bool,
) -> Result<UnifiedEngine, String> {
    let (tx, rx) = mpsc::channel();
    let installed = cancel.clone();
    let thread = std::thread::Builder::new()
        .name("parakeet".into())
        .stack_size(STACK)
        .spawn(move || serve(session, installed, cancellable, rx))
        .map_err(|err| err.to_string())?;
    Ok(UnifiedEngine {
        tx,
        thread: Some(thread),
        cancel,
        cancellable,
    })
}

fn serve(mut session: Session, cancel: CancelToken, cancellable: bool, rx: Receiver<Ask>) {
    while let Ok(ask) = rx.recv() {
        match ask {
            Ask::Stop => return,
            Ask::Transcribe(pcm, reply) => {
                let _ = reply.send(run_offline(&mut session, &cancel, cancellable, &pcm));
            }
        }
    }
}

fn run_offline(
    session: &mut Session,
    cancel: &CancelToken,
    cancellable: bool,
    samples: &[f32],
) -> Result<String, String> {
    if samples.is_empty() {
        return Ok(String::new());
    }
    if cancellable {
        cancel.reset();
    }
    let transcript = session
        .run(samples, &RunOptions::default())
        .map_err(show_run)?;
    Ok(transcript.text.trim().to_string())
}

fn ensure_runtime() -> Result<(), String> {
    static READY: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    READY
        .get_or_init(|| {
            transcribe_cpp::disable_logging();
            transcribe_cpp::init_backends_default().map_err(show)
        })
        .clone()
}

fn weights_file(path: &Path) -> Result<PathBuf, String> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    if !path.is_dir() {
        return Err("parakeet model path is missing".to_string());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let candidate = entry.path();
        if is_gguf(&candidate) {
            files.push(candidate);
        }
    }
    files.sort();
    match files.len() {
        0 => Err("parakeet model is missing a .gguf file".to_string()),
        1 => Ok(files.remove(0)),
        _ => {
            let mut preferred = Vec::new();
            for file in files {
                if is_q8(&file) {
                    preferred.push(file);
                }
            }
            if preferred.len() == 1 {
                Ok(preferred.remove(0))
            } else {
                Err("parakeet model directory has more than one .gguf".to_string())
            }
        }
    }
}

fn is_gguf(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
}

fn is_q8(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.contains("Q8_0"))
}

fn show(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn show_run(err: transcribe_cpp::Error) -> String {
    if err.kind() == ErrorKind::Aborted {
        return "parakeet was cancelled".to_string();
    }
    err.to_string()
}

#[cfg(test)]
#[path = "unified_test.rs"]
mod tests;
