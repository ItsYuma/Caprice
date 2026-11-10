use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, TryLockError};
use std::time::{Duration, Instant};

use super::child::{hide_console, LineFail, LinePump, WorkerIo};
use super::engine::requirements;
use super::limit::{stt_deadline, WORKER_RESPONSE_BYTES};
use super::pcm::resample_linear;
use super::phase::{drive, Follow, Job, Phase};
use super::protocol::{encode_pcm, Request, Response};
use super::worker::FLAG;

const RATE: u32 = 16_000;

struct Running {
    pump: Option<LinePump>,
    io: Arc<WorkerIo>,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.io.take_stdin();
        self.io.process.kill_and_reap();
        self.pump.take();
    }
}

pub(super) struct Supervisor {
    phase: Phase<Running>,
    io: Arc<WorkerIo>,
}

impl Supervisor {
    pub(super) fn new(io: Arc<WorkerIo>) -> Self {
        Self {
            phase: Phase::Idle,
            io,
        }
    }

    pub(super) fn retire(&mut self) {
        self.phase = Phase::Idle;
    }

    pub(super) fn transcribe(
        &mut self,
        samples: &[f32],
        sample_rate: u32,
    ) -> Result<String, String> {
        let (model, engine) = requirements()?;
        let deadline = stt_deadline()?;
        let audio = resample_linear(samples, sample_rate, RATE);
        if audio.is_empty() {
            return Ok(String::new());
        }
        let job = Job {
            pcm: encode_pcm(&audio),
            rate: RATE,
            model,
            engine,
            follow: Follow::Clip,
        };
        let io = Arc::clone(&self.io);
        let phase = std::mem::replace(&mut self.phase, Phase::Idle);
        let (phase, result) = drive(
            phase,
            job,
            || spawn(&io),
            |worker, request| roundtrip(worker, request, deadline),
        );
        self.phase = phase;
        result
    }

    pub(super) fn ensure(&mut self) -> Result<(), String> {
        if matches!(self.phase, Phase::Live(_)) {
            return Ok(());
        }
        let (model, engine) = requirements()?;
        let deadline = stt_deadline()?;
        let job = Job {
            pcm: String::new(),
            rate: RATE,
            model,
            engine,
            follow: Follow::Load,
        };
        let io = Arc::clone(&self.io);
        let phase = std::mem::replace(&mut self.phase, Phase::Idle);
        let (phase, result) = drive(
            phase,
            job,
            || spawn(&io),
            |worker, request| roundtrip(worker, request, deadline),
        );
        self.phase = phase;
        result.map(|_| ())
    }

    pub(super) fn feed(&mut self, samples: &[f32]) -> Result<(), String> {
        if samples.is_empty() {
            return Ok(());
        }
        self.ensure()?;
        match self.round(Request::Feed {
            pcm: encode_pcm(samples),
        })? {
            Response::Partial { .. } => Ok(()),
            Response::Error { message } => Err(message),
            _ => {
                self.phase = Phase::Idle;
                Err("speech worker broke the protocol".to_string())
            }
        }
    }

    pub(super) fn finish(&mut self) -> Result<String, String> {
        self.ensure()?;
        match self.round(Request::Finish)? {
            Response::Text { text } => Ok(text),
            Response::Error { message } => Err(message),
            _ => {
                self.phase = Phase::Idle;
                Err("speech worker broke the protocol".to_string())
            }
        }
    }

    pub(super) fn abandon(&mut self) -> Result<(), String> {
        if !matches!(self.phase, Phase::Live(_)) {
            return Ok(());
        }
        match self.round(Request::Reset) {
            Ok(Response::Ready) => Ok(()),
            Ok(Response::Error { message }) => Err(message),
            Ok(_) => {
                self.phase = Phase::Idle;
                Err("speech worker broke the protocol".to_string())
            }
            Err(message) => Err(message),
        }
    }

    fn round(&mut self, request: Request) -> Result<Response, String> {
        let deadline = stt_deadline()?;
        let Phase::Live(worker) = std::mem::replace(&mut self.phase, Phase::Idle) else {
            return Err("speech model is not loaded".to_string());
        };
        match roundtrip(worker, request, deadline) {
            Ok((worker, response)) => {
                self.phase = Phase::Live(worker);
                Ok(response)
            }
            Err(message) => Err(message),
        }
    }
}

pub(super) fn try_retire(supervisor: &Mutex<Supervisor>) {
    match supervisor.try_lock() {
        Ok(mut guard) => guard.retire(),
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner().retire(),
        Err(TryLockError::WouldBlock) => {}
    }
}

fn spawn(io: &Arc<WorkerIo>) -> Result<Running, String> {
    let program = std::env::current_exe().map_err(|err| err.to_string())?;
    let mut command = Command::new(program);
    command
        .arg(FLAG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("speech worker has no stdin".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("speech worker has no stdout".to_string());
        }
    };
    io.attach_stdin(stdin);
    io.process.arm(child);
    Ok(Running {
        pump: Some(LinePump::spawn(stdout, WORKER_RESPONSE_BYTES)),
        io: Arc::clone(io),
    })
}

fn roundtrip(
    worker: Running,
    request: Request,
    deadline: Duration,
) -> Result<(Running, Response), String> {
    let started = Instant::now();
    let line = serde_json::to_string(&request).map_err(|err| err.to_string())?;
    if let Err(message) = worker.io.write_line_deadline(&line, deadline) {
        drop(worker);
        return Err(message);
    }
    let remaining = deadline.saturating_sub(started.elapsed());
    let read = {
        let Some(pump) = worker.pump.as_ref() else {
            drop(worker);
            return Err("speech worker closed".to_string());
        };
        pump.recv(remaining)
    };
    let read = match read {
        Ok(line) => line,
        Err(fail) => {
            worker.io.process.kill();
            drop(worker);
            return Err(fail_message(fail));
        }
    };
    match serde_json::from_str(read.trim()) {
        Ok(response) => Ok((worker, response)),
        Err(err) => {
            drop(worker);
            Err(err.to_string())
        }
    }
}

fn fail_message(fail: LineFail) -> String {
    match fail {
        LineFail::TimedOut => "speech worker timed out".to_string(),
        LineFail::TooLarge => "speech worker reply is too large".to_string(),
        LineFail::Closed => "speech worker closed".to_string(),
        LineFail::Message(message) => message,
    }
}
