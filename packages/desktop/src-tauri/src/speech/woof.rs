use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

const FRAME_LIMIT: u32 = 8 * 1024 * 1024;
const DRIVER: &str = include_str!("woof_driver.py");

static DRIVER_TICK: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub(crate) struct ReplyState {
    shared: Arc<Mutex<Slot>>,
}

impl ReplyState {
    pub(crate) fn new() -> Self {
        Self {
            shared: Arc::new(Mutex::new(Slot::Cold)),
        }
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
    Warm(Box<Resident>),
}

struct Resident {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    voice: WoofVoice,
    directory: String,
    driver: PathBuf,
}

impl Drop for Resident {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(&self.driver);
    }
}

pub(super) fn speak(state: &ReplyState, text: String) -> Result<Vec<u8>, String> {
    let voice = WoofVoice::parse(&std::env::var("CAPRICE_TTS_VOICE").unwrap_or_default())?;
    let directory = match std::env::var("CAPRICE_TTS_WOOF") {
        Ok(directory) if !directory.is_empty() => directory,
        _ => return Err("CAPRICE_TTS_WOOF is not set".to_string()),
    };
    let mut slot = super::lock(&state.shared);
    ensure_warm(&mut slot, voice, &directory)?;
    let reply = {
        let Slot::Warm(resident) = &mut *slot else {
            return Err("woof child is not running".to_string());
        };
        exchange(resident.as_mut(), &text)
    };
    match reply {
        ChildReply::Wav(bytes) => Ok(bytes),
        ChildReply::Fault(message) => Err(message),
        ChildReply::Dead(message) => {
            *slot = Slot::Cold;
            Err(message)
        }
    }
}

fn ensure_warm(slot: &mut Slot, voice: WoofVoice, directory: &str) -> Result<(), String> {
    if warm_matches(slot, voice, directory) {
        return Ok(());
    }
    *slot = Slot::Cold;
    *slot = Slot::Warm(Box::new(start(voice, directory.to_string())?));
    Ok(())
}

fn warm_matches(slot: &mut Slot, voice: WoofVoice, directory: &str) -> bool {
    let Slot::Warm(resident) = slot else {
        return false;
    };
    reusable(resident, voice, directory)
}

fn reusable(resident: &mut Box<Resident>, voice: WoofVoice, directory: &str) -> bool {
    if resident.voice != voice || resident.directory != directory {
        return false;
    }
    matches!(resident.child.try_wait(), Ok(None))
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

fn start(voice: WoofVoice, directory: String) -> Result<Resident, String> {
    let program = python_program();
    let driver = write_driver()?;
    let spawned = Command::new(&program)
        .arg("-u")
        .arg(&driver)
        .arg(voice.name())
        .current_dir(&directory)
        .env("PYTHONPATH", &directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn();
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
    Ok(Resident {
        child,
        stdin,
        stdout,
        voice,
        directory,
        driver,
    })
}

fn write_driver() -> Result<PathBuf, String> {
    let tick = DRIVER_TICK.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("caprice-woof-{}-{tick}.py", std::process::id()));
    std::fs::write(&path, DRIVER).map_err(|err| err.to_string())?;
    Ok(path)
}

fn exchange(resident: &mut Resident, text: &str) -> ChildReply {
    if let Err(message) = write_text(&mut resident.stdin, text) {
        return ChildReply::Dead(message);
    }
    read_reply(&mut resident.stdout)
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
