use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};

use super::engine::requirements;
use super::pcm::resample_linear;
use super::phase::{drive, Job, Phase};
use super::protocol::{encode_pcm, Request, Response};
use super::worker::FLAG;

const RATE: u32 = 16_000;

struct Running {
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    child: Child,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub(super) struct Supervisor {
    phase: Phase<Running>,
}

impl Supervisor {
    pub(super) fn new() -> Self {
        Self { phase: Phase::Idle }
    }

    pub(super) fn transcribe(
        &mut self,
        samples: &[f32],
        sample_rate: u32,
    ) -> Result<String, String> {
        let (model, engine) = requirements()?;
        let audio = resample_linear(samples, sample_rate, RATE);
        if audio.is_empty() {
            return Ok(String::new());
        }
        let job = Job {
            pcm: encode_pcm(&audio),
            rate: RATE,
            model,
            engine,
        };
        let phase = std::mem::replace(&mut self.phase, Phase::Idle);
        let (phase, result) = drive(phase, job, spawn, roundtrip);
        self.phase = phase;
        result
    }
}

fn spawn() -> Result<Running, String> {
    let program = std::env::current_exe().map_err(|err| err.to_string())?;
    let mut child = Command::new(program)
        .arg(FLAG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| err.to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "speech worker has no stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "speech worker has no stdout".to_string())?;
    Ok(Running {
        stdin,
        stdout: BufReader::new(stdout),
        child,
    })
}

fn roundtrip(mut worker: Running, request: Request) -> Result<(Running, Response), String> {
    let line = serde_json::to_string(&request).map_err(|err| err.to_string())?;
    writeln!(worker.stdin, "{line}").map_err(|err| err.to_string())?;
    worker.stdin.flush().map_err(|err| err.to_string())?;
    let mut response = String::new();
    let read = worker
        .stdout
        .read_line(&mut response)
        .map_err(|err| err.to_string())?;
    if read == 0 {
        return Err("speech worker closed".to_string());
    }
    let parsed = serde_json::from_str(response.trim()).map_err(|err| err.to_string())?;
    Ok((worker, parsed))
}
