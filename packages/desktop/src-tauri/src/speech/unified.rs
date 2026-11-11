use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::JoinHandle;

use transcribe_cpp::sys::TRANSCRIBE_EXT_KIND_PARAKEET_BUFFERED_STREAM;
use transcribe_cpp::{
    CancelToken, ErrorKind, ExtSlot, Feature, ParakeetBufferedStreamOptions, RunOptions, Session,
    Stream, StreamExtension, StreamOptions,
};

use super::buffered::{RangeDecoder, Utterance, CHUNK_MS, LEFT_MS, RIGHT_MS};

const STACK: usize = 16 * 1024 * 1024;

pub(super) struct UnifiedEngine {
    tx: Sender<Ask>,
    thread: Option<JoinHandle<()>>,
    cancel: CancelToken,
    cancellable: bool,
}

enum Ask {
    Feed(Vec<f32>, Sender<Result<String, String>>),
    Finish(Sender<Result<String, String>>),
    Reset(Sender<()>),
    Stop,
}

struct Native<'stream, 'session> {
    stream: &'stream mut Stream<'session>,
    fed: usize,
    shown: String,
    finalized: bool,
    full: Option<String>,
}

impl<'stream, 'session> Native<'stream, 'session> {
    fn new(stream: &'stream mut Stream<'session>) -> Self {
        Self {
            stream,
            fed: 0,
            shown: String::new(),
            finalized: false,
            full: None,
        }
    }

    fn pull(&mut self) {
        let text = self.stream.text();
        self.shown = text.committed;
        if self.finalized {
            self.full = Some(text.full.trim().to_string());
        }
    }
}

impl RangeDecoder for Native<'_, '_> {
    fn observe(&mut self, audio: &[f32]) -> Result<(), String> {
        if audio.len() < self.fed {
            return Err("parakeet audio went backwards".to_string());
        }
        if audio.len() > self.fed {
            self.stream.feed(&audio[self.fed..]).map_err(show_run)?;
            self.fed = audio.len();
        }
        self.pull();
        Ok(())
    }

    fn text_for(
        &mut self,
        audio: &[f32],
        _window_start: usize,
        window_end: usize,
        _commit_start: usize,
        commit_end: usize,
    ) -> Result<String, String> {
        if !self.finalized && commit_end == audio.len() && window_end == audio.len() {
            self.stream.finalize().map_err(show_run)?;
            self.finalized = true;
            self.pull();
        }
        Ok(String::new())
    }

    fn partial_text(&self) -> Option<String> {
        Some(self.shown.clone())
    }

    fn final_transcript(&self) -> Option<String> {
        let full = self.full.clone()?;
        if full.is_empty() && !self.shown.is_empty() {
            return Some(self.shown.trim().to_string());
        }
        Some(full)
    }
}

impl UnifiedEngine {
    pub(super) fn feed(&self, samples: &[f32]) -> Result<String, String> {
        if samples.is_empty() {
            return Ok(String::new());
        }
        self.round(|reply| Ask::Feed(samples.to_vec(), reply))
    }

    pub(super) fn finish(&self) -> Result<String, String> {
        self.round(Ask::Finish)
    }

    pub(super) fn cancel(&self) {
        if self.cancellable {
            self.cancel.cancel();
        }
    }

    pub(super) fn reset(&self) {
        self.cancel.reset();
        let (tx, rx) = mpsc::channel();
        if self.tx.send(Ask::Reset(tx)).is_err() {
            return;
        }
        let _ = rx.recv();
    }

    fn round(
        &self,
        make: impl FnOnce(Sender<Result<String, String>>) -> Ask,
    ) -> Result<String, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(make(tx))
            .map_err(|_| "parakeet stream stopped".to_string())?;
        rx.recv()
            .map_err(|_| "parakeet stream stopped".to_string())?
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
        .spawn(move || serve(session, installed, rx))
        .map_err(|err| err.to_string())?;
    Ok(UnifiedEngine {
        tx,
        thread: Some(thread),
        cancel,
        cancellable,
    })
}

fn serve(mut session: Session, cancel: CancelToken, rx: Receiver<Ask>) {
    while let Ok(ask) = rx.recv() {
        match ask {
            Ask::Stop => return,
            Ask::Reset(reply) => {
                cancel.reset();
                let _ = reply.send(());
            }
            Ask::Finish(reply) => {
                let _ = reply.send(Ok(String::new()));
            }
            Ask::Feed(pcm, reply) => {
                if pcm.is_empty() {
                    let _ = reply.send(Ok(String::new()));
                    continue;
                }
                if !run_utterance(&mut session, &cancel, pcm, reply, &rx) {
                    return;
                }
            }
        }
    }
}

fn run_utterance(
    session: &mut Session,
    cancel: &CancelToken,
    first: Vec<f32>,
    first_reply: Sender<Result<String, String>>,
    rx: &Receiver<Ask>,
) -> bool {
    let mut stream = match session.stream(&RunOptions::default(), &buffered_options()) {
        Ok(stream) => stream,
        Err(err) => {
            let _ = first_reply.send(Err(show_run(err)));
            return true;
        }
    };
    let mut utterance = Utterance::new(Native::new(&mut stream));
    let first_result = utterance.feed(&first);
    let failed = first_result.is_err();
    let _ = first_reply.send(first_result);
    if failed {
        cancel.reset();
        return true;
    }
    loop {
        match rx.recv() {
            Ok(Ask::Feed(pcm, reply)) => {
                let result = utterance.feed(&pcm);
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    cancel.reset();
                    return true;
                }
            }
            Ok(Ask::Finish(reply)) => {
                let result = utterance.finish();
                if result.is_err() {
                    cancel.reset();
                }
                let _ = reply.send(result);
                return true;
            }
            Ok(Ask::Reset(reply)) => {
                cancel.reset();
                let _ = reply.send(());
                return true;
            }
            Ok(Ask::Stop) | Err(_) => return false,
        }
    }
}

fn buffered_options() -> StreamOptions {
    StreamOptions {
        family: Some(StreamExtension::ParakeetBuffered(
            ParakeetBufferedStreamOptions {
                left_ms: Some(ms(LEFT_MS)),
                chunk_ms: Some(ms(CHUNK_MS)),
                right_ms: Some(ms(RIGHT_MS)),
            },
        )),
        ..StreamOptions::default()
    }
}

fn ms(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
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

pub(super) fn weights_file(path: &Path) -> Result<PathBuf, String> {
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
