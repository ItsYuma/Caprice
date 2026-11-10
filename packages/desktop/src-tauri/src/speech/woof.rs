use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::child::{hide_console, ProcessKill};
use super::limit::{tts_deadline, REPLY_BYTES};

const FRAME_LIMIT: u32 = REPLY_BYTES as u32;
const DRIVER: &str = include_str!("woof_driver.py");

static DRIVER_TICK: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub(crate) struct ReplyState {
    shared: Arc<ReplyShared>,
}

struct ReplyShared {
    slot: Mutex<Slot>,
    generation: AtomicU64,
}

impl ReplyState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(ReplyShared {
                slot: Mutex::new(Slot::Cold),
                generation: AtomicU64::new(0),
            }),
        }
    }

    pub(super) fn generation(&self) -> u64 {
        self.shared.generation.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WoofVoice {
    Juno,
    Mira,
}

impl WoofVoice {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "" | "juno" => Ok(Self::Juno),
            "mira" => Ok(Self::Mira),
            other => Err(format!("unknown woof voice: {other}")),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Juno => "juno",
            Self::Mira => "mira",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ChildReply {
    Wav(Vec<u8>),
    Fault(String),
    Dead(String),
}

enum Slot {
    Cold,
    Warm(Arc<Shared>),
}

struct Shared {
    io: Mutex<Io>,
    turn: Mutex<()>,
    process: ProcessKill,
    voice: WoofVoice,
    directory: String,
    driver: PathBuf,
}

struct Io {
    stdin: ChildStdin,
    stdout: Option<ChildStdout>,
}

impl Drop for Shared {
    fn drop(&mut self) {
        self.process.kill_and_reap();
        let _ = std::fs::remove_file(&self.driver);
    }
}

impl Shared {
    fn reusable(&self, voice: WoofVoice, directory: &str) -> bool {
        self.voice == voice && self.directory == directory && self.process.running()
    }

    fn exchange(&self, text: &str) -> ChildReply {
        let _turn = super::lock(&self.turn);
        let deadline = match tts_deadline() {
            Ok(deadline) => deadline,
            Err(message) => return ChildReply::Dead(message),
        };
        let started = std::time::Instant::now();
        if let Err(message) = write_within(self, text, deadline) {
            return ChildReply::Dead(message);
        }
        let stdout = {
            let mut io = super::lock(&self.io);
            let Some(stdout) = io.stdout.take() else {
                return ChildReply::Dead("woof closed".to_string());
            };
            stdout
        };
        let remaining = deadline.saturating_sub(started.elapsed());
        let (tx, rx) = mpsc::channel();
        let reader = thread::spawn(move || {
            let mut stdout = stdout;
            let reply = read_reply(&mut stdout);
            let _ = tx.send((reply, stdout));
        });
        match rx.recv_timeout(remaining) {
            Ok((reply, stdout)) => {
                let _ = reader.join();
                super::lock(&self.io).stdout = Some(stdout);
                reply
            }
            Err(RecvTimeoutError::Timeout) => {
                self.process.kill();
                self.process.kill_and_reap();
                finish_reader(reader, rx);
                ChildReply::Dead("woof timed out".to_string())
            }
            Err(RecvTimeoutError::Disconnected) => {
                let _ = reader.join();
                self.process.kill_and_reap();
                ChildReply::Dead("woof closed".to_string())
            }
        }
    }
}

fn finish_reader(reader: thread::JoinHandle<()>, rx: mpsc::Receiver<(ChildReply, ChildStdout)>) {
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok((_reply, stdout)) => {
            drop(stdout);
            let _ = reader.join();
        }
        Err(_) => {
            drop(reader);
        }
    }
}

pub(crate) fn speech_reply_cancel(state: &ReplyState) -> Result<(), String> {
    state.shared.generation.fetch_add(1, Ordering::AcqRel);
    let shared = {
        let slot = super::lock(&state.shared.slot);
        match &*slot {
            Slot::Warm(shared) => Some(Arc::clone(shared)),
            Slot::Cold => None,
        }
    };
    if let Some(shared) = shared {
        shared.process.kill();
    }
    Ok(())
}

pub(super) fn speak(state: &ReplyState, text: String) -> Result<Vec<u8>, String> {
    let ticket = state.generation();
    let voice = WoofVoice::parse(&std::env::var("CAPRICE_TTS_VOICE").unwrap_or_default())?;
    let directory = match std::env::var("CAPRICE_TTS_WOOF") {
        Ok(directory) if !directory.is_empty() => directory,
        _ => return Err("CAPRICE_TTS_WOOF is not set".to_string()),
    };
    let shared = {
        let mut slot = super::lock(&state.shared.slot);
        ensure_warm(&mut slot, voice, &directory)?;
        let Slot::Warm(shared) = &*slot else {
            return Err("woof child is not running".to_string());
        };
        Arc::clone(shared)
    };
    let outcome = shared.exchange(&text);
    let cancelled = state.generation() != ticket;
    if cancelled || matches!(outcome, ChildReply::Dead(_)) {
        let mut slot = super::lock(&state.shared.slot);
        if let Slot::Warm(current) = &*slot {
            if Arc::ptr_eq(current, &shared) {
                *slot = Slot::Cold;
            }
        }
    }
    if cancelled {
        return Err("speech reply cancelled".to_string());
    }
    match outcome {
        ChildReply::Wav(bytes) => Ok(bytes),
        ChildReply::Fault(message) => Err(message),
        ChildReply::Dead(message) => Err(message),
    }
}

fn ensure_warm(slot: &mut Slot, voice: WoofVoice, directory: &str) -> Result<(), String> {
    if let Slot::Warm(shared) = &*slot {
        if shared.reusable(voice, directory) {
            return Ok(());
        }
    }
    *slot = Slot::Cold;
    *slot = Slot::Warm(start(voice, directory.to_string())?);
    Ok(())
}

fn python_program() -> String {
    match std::env::var("CAPRICE_PYTHON") {
        Ok(program) => {
            let trimmed = program.trim();
            if trimmed.is_empty() {
                "python3".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => "python3".to_string(),
    }
}

fn start(voice: WoofVoice, directory: String) -> Result<Arc<Shared>, String> {
    let program = python_program();
    let driver = write_driver()?;
    let mut command = Command::new(&program);
    command
        .arg("-u")
        .arg(&driver)
        .arg(voice.name())
        .current_dir(&directory)
        .env("PYTHONPATH", &directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    hide_console(&mut command);
    let spawned = command.spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(err) => {
            let _ = std::fs::remove_file(&driver);
            return Err(format!("could not start {program}: {err}"));
        }
    };
    let (stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
        (Some(stdin), Some(stdout)) => (stdin, stdout),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&driver);
            return Err("woof child has no pipes".to_string());
        }
    };
    let process = ProcessKill::new();
    process.arm(child);
    Ok(Arc::new(Shared {
        io: Mutex::new(Io {
            stdin,
            stdout: Some(stdout),
        }),
        process,
        turn: Mutex::new(()),
        voice,
        directory,
        driver,
    }))
}

fn write_driver() -> Result<PathBuf, String> {
    let tick = DRIVER_TICK.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("caprice-woof-{}-{tick}.py", std::process::id()));
    std::fs::write(&path, DRIVER).map_err(|err| err.to_string())?;
    Ok(path)
}

fn write_within(shared: &Shared, text: &str, deadline: Duration) -> Result<(), String> {
    thread::scope(|scope| {
        let (tx, rx) = mpsc::channel();
        let writer = scope.spawn(move || {
            let mut io = super::lock(&shared.io);
            let _ = tx.send(write_text(&mut io.stdin, text));
        });
        let result = match rx.recv_timeout(deadline) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                shared.process.kill();
                Err("woof timed out".to_string())
            }
            Err(RecvTimeoutError::Disconnected) => Err("woof closed".to_string()),
        };
        let _ = writer.join();
        result
    })
}

fn write_text(sink: &mut impl Write, text: &str) -> Result<(), String> {
    let bytes = text.as_bytes();
    let len = u32::try_from(bytes.len()).map_err(|_| "woof text is too large".to_string())?;
    sink.write_all(&len.to_le_bytes()).map_err(pipe_error)?;
    sink.write_all(bytes).map_err(pipe_error)?;
    sink.flush().map_err(pipe_error)
}

fn read_reply(source: &mut impl Read) -> ChildReply {
    let status = match read_u32(source) {
        Ok(status) => status,
        Err(message) => return ChildReply::Dead(message),
    };
    let len = match read_u32(source) {
        Ok(len) => len,
        Err(message) => return ChildReply::Dead(message),
    };
    if len > FRAME_LIMIT {
        return ChildReply::Dead("woof reply is too large".to_string());
    }
    let body = match read_body(source, len) {
        Ok(body) => body,
        Err(message) => return ChildReply::Dead(message),
    };
    match status {
        0 => ChildReply::Wav(body),
        1 => ChildReply::Fault(String::from_utf8_lossy(&body).into_owned()),
        other => ChildReply::Dead(format!("woof status {other}")),
    }
}

fn read_u32(source: &mut impl Read) -> Result<u32, String> {
    let mut buf = [0; 4];
    source.read_exact(&mut buf).map_err(pipe_error)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_body(source: &mut impl Read, len: u32) -> Result<Vec<u8>, String> {
    let mut body = vec![0; len as usize];
    source.read_exact(&mut body).map_err(pipe_error)?;
    Ok(body)
}

fn pipe_error(err: std::io::Error) -> String {
    if matches!(
        err.kind(),
        std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::BrokenPipe
    ) {
        "woof closed".to_string()
    } else {
        err.to_string()
    }
}

#[cfg(test)]
#[path = "woof_test.rs"]
mod tests;
