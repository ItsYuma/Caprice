use std::io::Cursor;
use std::process::{Command, Stdio};
use std::time::Duration;

use super::{hide_console, read_capped_line, LineFail, LinePump, ProcessKill, ReadFail, WorkerIo};

#[test]
fn a_capped_line_stops_at_the_newline_and_rejects_a_long_one() {
    let mut short = Cursor::new(b"hi\r\nnext\n".to_vec());
    assert_eq!(read_capped_line(&mut short, 8).unwrap().unwrap(), "hi");
    assert_eq!(read_capped_line(&mut short, 8).unwrap().unwrap(), "next");
    assert!(read_capped_line(&mut short, 8).unwrap().is_none());

    let mut huge = Cursor::new(b"abcdef\n".to_vec());
    assert!(matches!(
        read_capped_line(&mut huge, 3),
        Err(ReadFail::TooLarge)
    ));

    let mut open = Cursor::new(b"abc".to_vec());
    assert!(matches!(
        read_capped_line(&mut open, 8),
        Err(ReadFail::Closed)
    ));
}

#[test]
fn a_silent_child_is_reaped_when_the_read_passes_its_deadline() {
    let mut command = silent_sleeper();
    hide_console(&mut command);
    let mut child = command.spawn().expect("sleeper");
    let stdout = child.stdout.take().expect("stdout");
    let pid = child.id();
    let kill = ProcessKill::new();
    kill.arm(child);
    let pump = LinePump::spawn(stdout, 64);
    assert!(matches!(
        pump.recv(Duration::from_millis(400)),
        Err(LineFail::TimedOut)
    ));
    kill.kill_and_reap();
    drop(pump);
    assert!(!process_alive(pid), "pid {pid} still alive");
}

#[test]
fn a_child_that_stops_reading_cannot_hold_the_write_past_the_deadline() {
    let mut command = silent_sleeper();
    command.stdin(Stdio::piped());
    hide_console(&mut command);
    let mut child = command.spawn().expect("sleeper");
    let stdin = child.stdin.take().expect("stdin");
    let pid = child.id();
    let io = WorkerIo::new();
    io.attach_stdin(stdin);
    io.process.arm(child);
    let started = std::time::Instant::now();
    let err = io
        .write_line_deadline(&"x".repeat(256 * 1024), Duration::from_millis(300))
        .expect_err("blocked write");
    assert_eq!(err, "speech worker timed out");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "write stayed blocked"
    );
    io.process.kill_and_reap();
    assert!(!process_alive(pid), "pid {pid} still alive");
}

fn silent_sleeper() -> Command {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("powershell");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ]);
        command
    } else {
        let mut command = Command::new("sleep");
        command.arg("30");
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

fn process_alive(pid: u32) -> bool {
    if cfg!(windows) {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .expect("tasklist");
        String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
    } else {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
}
