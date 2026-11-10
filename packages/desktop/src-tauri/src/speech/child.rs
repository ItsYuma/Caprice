use std::io::{BufRead, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::lock;

pub(super) struct ProcessKill {
    child: Mutex<Option<Child>>,
}

impl ProcessKill {
    pub(super) fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub(super) fn arm(&self, child: Child) {
        let previous = lock(&self.child).replace(child);
        dispose(previous);
    }

    pub(super) fn kill(&self) {
        if let Some(child) = lock(&self.child).as_mut() {
            let _ = child.kill();
        }
    }

    pub(super) fn running(&self) -> bool {
        match lock(&self.child).as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    pub(super) fn kill_and_reap(&self) {
        dispose(lock(&self.child).take());
    }
}

pub(super) struct WorkerIo {
    pub(super) process: ProcessKill,
    stdin: Mutex<Option<ChildStdin>>,
}

impl WorkerIo {
    pub(super) fn new() -> Self {
        Self {
            process: ProcessKill::new(),
            stdin: Mutex::new(None),
        }
    }

    pub(super) fn attach_stdin(&self, stdin: ChildStdin) {
        *lock(&self.stdin) = Some(stdin);
    }

    pub(super) fn take_stdin(&self) -> Option<ChildStdin> {
        lock(&self.stdin).take()
    }

    pub(super) fn write_line(&self, line: &str) -> Result<(), String> {
        let mut slot = lock(&self.stdin);
        let Some(stdin) = slot.as_mut() else {
            return Err("speech worker has no stdin".to_string());
        };
        writeln!(stdin, "{line}").map_err(|err| err.to_string())?;
        stdin.flush().map_err(|err| err.to_string())
    }

    pub(super) fn write_line_deadline(&self, line: &str, deadline: Duration) -> Result<(), String> {
        thread::scope(|scope| {
            let (tx, rx) = mpsc::channel();
            let writer = scope.spawn(move || {
                let _ = tx.send(self.write_line(line));
            });
            let result = match rx.recv_timeout(deadline) {
                Ok(result) => result,
                Err(RecvTimeoutError::Timeout) => {
                    self.process.kill();
                    Err("speech worker timed out".to_string())
                }
                Err(RecvTimeoutError::Disconnected) => Err("speech worker closed".to_string()),
            };
            let _ = writer.join();
            result
        })
    }

    pub(super) fn send_cancel(&self) {
        let Ok(line) = serde_json::to_string(&super::protocol::Request::Cancel) else {
            return;
        };
        let _ = self.write_line(&line);
    }
}

pub(super) enum LineFail {
    Closed,
    TimedOut,
    TooLarge,
    Message(String),
}

pub(super) struct LinePump {
    rx: Receiver<Result<String, LineFail>>,
    join: Option<JoinHandle<()>>,
}

impl LinePump {
    pub(super) fn spawn(stdout: ChildStdout, max: usize) -> Self {
        let (tx, rx) = mpsc::channel();
        let join = thread::spawn(move || pump(stdout, max, tx));
        Self {
            rx,
            join: Some(join),
        }
    }

    pub(super) fn recv(&self, deadline: Duration) -> Result<String, LineFail> {
        match self.rx.recv_timeout(deadline) {
            Ok(Ok(line)) => Ok(line),
            Ok(Err(fail)) => Err(fail),
            Err(RecvTimeoutError::Timeout) => Err(LineFail::TimedOut),
            Err(RecvTimeoutError::Disconnected) => Err(LineFail::Closed),
        }
    }
}

impl Drop for LinePump {
    fn drop(&mut self) {
        self.join.take();
    }
}

#[derive(Debug)]
pub(super) enum ReadFail {
    Closed,
    TooLarge,
    Message(String),
}

pub(super) fn read_capped_line(
    source: &mut impl BufRead,
    max: usize,
) -> Result<Option<String>, ReadFail> {
    let mut buf = Vec::new();
    loop {
        let available = source
            .fill_buf()
            .map_err(|err| ReadFail::Message(err.to_string()))?;
        if available.is_empty() {
            if buf.is_empty() {
                return Ok(None);
            }
            return Err(ReadFail::Closed);
        }
        if let Some(pos) = available.iter().position(|byte| *byte == b'\n') {
            if buf.len().saturating_add(pos) > max {
                source.consume(pos + 1);
                return Err(ReadFail::TooLarge);
            }
            buf.extend_from_slice(&available[..pos]);
            source.consume(pos + 1);
            break;
        }
        if buf.len().saturating_add(available.len()) > max {
            let n = available.len();
            source.consume(n);
            let _ = discard_until_newline(source);
            return Err(ReadFail::TooLarge);
        }
        let n = available.len();
        buf.extend_from_slice(&available[..n]);
        source.consume(n);
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    let text = String::from_utf8(buf)
        .map_err(|_| ReadFail::Message("speech worker reply is not utf-8".to_string()))?;
    Ok(Some(text))
}

pub(super) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn pump(stdout: ChildStdout, max: usize, tx: mpsc::Sender<Result<String, LineFail>>) {
    let mut source = std::io::BufReader::new(stdout);
    loop {
        let next = match read_capped_line(&mut source, max) {
            Ok(Some(line)) => Ok(line),
            Ok(None) => Err(LineFail::Closed),
            Err(ReadFail::Closed) => Err(LineFail::Closed),
            Err(ReadFail::TooLarge) => Err(LineFail::TooLarge),
            Err(ReadFail::Message(message)) => Err(LineFail::Message(message)),
        };
        let stop = next.is_err();
        if tx.send(next).is_err() || stop {
            return;
        }
    }
}

fn discard_until_newline(source: &mut impl BufRead) -> Result<(), ReadFail> {
    loop {
        let available = source
            .fill_buf()
            .map_err(|err| ReadFail::Message(err.to_string()))?;
        if available.is_empty() {
            return Err(ReadFail::Closed);
        }
        if let Some(pos) = available.iter().position(|byte| *byte == b'\n') {
            source.consume(pos + 1);
            return Ok(());
        }
        let n = available.len();
        source.consume(n);
    }
}

fn dispose(child: Option<Child>) {
    let Some(mut child) = child else {
        return;
    };
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
#[path = "child_test.rs"]
mod tests;
