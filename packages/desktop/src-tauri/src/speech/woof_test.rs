use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::super::reply::perform;
use super::super::test_support::{env_lock, woof_drivers, EnvGuard};
use super::super::ReplyState;
use super::{python_program, read_reply, write_text, ChildReply, WoofVoice};

const FAKE: &str = r#"import os
import sys


class Woof:
    def __init__(self, voice="juno"):
        os.write(1, b"stdout-leak\n")
        sys.stdout.write("stdout-text\n")
        sys.stdout.flush()
        with open(os.environ["WOOF_LOG"], "a", encoding="utf-8") as handle:
            handle.write(
                f"load\t{voice}\t{os.getcwd()}\t{os.environ.get('PYTHONPATH', '')}\t{os.getpid()}\n"
            )

    def __call__(self, text, seed=None):
        with open(os.environ["WOOF_LOG"], "a", encoding="utf-8") as handle:
            handle.write(f"say\t{text}\t{os.getpid()}\n")
        if text == "fault":
            raise RuntimeError("nope")
        if text == "die":
            os._exit(3)
        return text

    @staticmethod
    def save(path, wav):
        path.write(("WAV:" + wav).encode())
"#;

struct Home {
    dir: PathBuf,
}

impl Home {
    fn new() -> Self {
        static TICK: AtomicU64 = AtomicU64::new(0);
        let tick = TICK.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("caprice-woof-home-{}-{tick}", std::process::id()));
        let pkg = dir.join("underdog_woof");
        std::fs::create_dir_all(&pkg).expect("package");
        std::fs::write(pkg.join("__init__.py"), FAKE).expect("fake");
        Self { dir }
    }

    fn path(&self) -> String {
        self.dir.to_str().expect("utf8").to_string()
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

struct LogFile {
    path: PathBuf,
}

impl LogFile {
    fn new() -> Self {
        static TICK: AtomicU64 = AtomicU64::new(0);
        let tick = TICK.fetch_add(1, Ordering::Relaxed);
        Self {
            path: std::env::temp_dir()
                .join(format!("caprice-woof-log-{}-{tick}", std::process::id())),
        }
    }

    fn path(&self) -> String {
        self.path.to_str().expect("utf8").to_string()
    }
}

impl Drop for LogFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn speak(state: &ReplyState, text: &str) -> Result<Vec<u8>, String> {
    tauri::async_runtime::block_on(perform(state, text.to_string()))
}

fn read_log(path: &str) -> Vec<Vec<String>> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.split('\t').map(str::to_owned).collect())
        .collect()
}

fn loads(rows: &[Vec<String>]) -> Vec<&Vec<String>> {
    rows.iter()
        .filter(|row| row.first().is_some_and(|kind| kind == "load"))
        .collect()
}

fn pid_of(row: &[String]) -> u32 {
    row[4].parse().expect("pid")
}

fn command_line(pid: u32) -> Vec<String> {
    let bytes = std::fs::read(format!("/proc/{pid}/cmdline")).expect("cmdline");
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect()
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn same_dir(left: &str, right: &str) -> bool {
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

#[test]
fn woof_voice_names_juno_and_mira() {
    assert_eq!(WoofVoice::parse("").unwrap(), WoofVoice::Juno);
    assert_eq!(WoofVoice::parse("juno").unwrap(), WoofVoice::Juno);
    assert_eq!(WoofVoice::parse("  juno ").unwrap(), WoofVoice::Juno);
    assert_eq!(WoofVoice::parse("mira").unwrap(), WoofVoice::Mira);
    assert_eq!(WoofVoice::parse("  mira").unwrap(), WoofVoice::Mira);
    assert_eq!(
        WoofVoice::parse("Mira").unwrap_err(),
        "unknown woof voice: Mira"
    );
    assert_eq!(
        WoofVoice::parse(" capri ").unwrap_err(),
        "unknown woof voice: capri"
    );
}

#[test]
fn frames_are_little_endian() {
    let mut request = Vec::new();
    write_text(&mut request, "café").unwrap();
    assert_eq!(
        u32::from_le_bytes(request[..4].try_into().unwrap()),
        "café".len() as u32
    );
    assert_eq!(&request[4..], "café".as_bytes());

    assert_eq!(
        read_reply(&mut Cursor::new(frame(0, b"RIFF"))),
        ChildReply::Wav(b"RIFF".to_vec())
    );
    assert_eq!(
        read_reply(&mut Cursor::new(frame(1, b"nope"))),
        ChildReply::Fault("nope".to_string())
    );
    assert_eq!(
        read_reply(&mut Cursor::new(frame(9, b"z"))),
        ChildReply::Dead("woof status 9".to_string())
    );
    assert_eq!(
        read_reply(&mut Cursor::new([0_u8, 1].as_slice())),
        ChildReply::Dead("woof closed".to_string())
    );
    let mut short_body = frame(0, b"RIFF");
    short_body.pop();
    assert_eq!(
        read_reply(&mut Cursor::new(short_body)),
        ChildReply::Dead("woof closed".to_string())
    );

    let mut too_big = Vec::new();
    too_big.extend(0_u32.to_le_bytes());
    too_big.extend((super::FRAME_LIMIT + 1).to_le_bytes());
    assert_eq!(
        read_reply(&mut Cursor::new(too_big)),
        ChildReply::Dead("woof reply is too large".to_string())
    );

    let mut boundary = Vec::new();
    boundary.extend(0_u32.to_le_bytes());
    boundary.extend(super::FRAME_LIMIT.to_le_bytes());
    assert_eq!(
        read_reply(&mut Cursor::new(boundary)),
        ChildReply::Dead("woof closed".to_string())
    );
}

fn frame(status: u32, body: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(status.to_le_bytes());
    bytes.extend(u32::try_from(body.len()).unwrap().to_le_bytes());
    bytes.extend(body);
    bytes
}

#[test]
fn resident_child_stays_warm() {
    let _lock = env_lock();
    let _python = EnvGuard::set("CAPRICE_PYTHON", None);
    let home = Home::new();
    let log = LogFile::new();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("woof"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&home.path()));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", None);
    let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
    let _key = EnvGuard::set("CAPRICE_TTS_API_KEY", None);
    let _logged = EnvGuard::set("WOOF_LOG", Some(&log.path()));
    let state = ReplyState::new();

    let first = speak(&state, "hello").expect("hello");
    let second = speak(&state, "café").expect("again");
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("juno"));
    let third = speak(&state, "again").expect("juno");

    assert_eq!(first, b"WAV:hello");
    assert_eq!(second, b"WAV:caf\xc3\xa9");
    assert_eq!(third, b"WAV:again");
    let rows = read_log(&log.path());
    let loads = loads(&rows);
    assert_eq!(loads.len(), 1);
    assert_eq!(loads[0][1], "juno");
    assert_eq!(loads[0][3], home.path());
    assert!(same_dir(&loads[0][2], &home.path()));
    let pid = pid_of(loads[0]);
    assert!(rows
        .iter()
        .filter(|row| row[0] == "say")
        .all(|row| row[2] == pid.to_string()));
    let args = command_line(pid);
    assert!(args.iter().any(|arg| arg.ends_with("python3")), "{args:?}");
    assert!(args.iter().any(|arg| arg == "-u"), "{args:?}");
    let script = args
        .iter()
        .find(|arg| arg.ends_with(".py"))
        .expect("driver");
    assert_eq!(
        std::fs::read_to_string(script).expect("script"),
        include_str!("woof_driver.py")
    );
    assert_eq!(args.last().map(String::as_str), Some("juno"));
}

#[test]
fn fault_keeps_the_child_and_a_dead_child_is_replaced() {
    let _lock = env_lock();
    let _python = EnvGuard::set("CAPRICE_PYTHON", None);
    let home = Home::new();
    let log = LogFile::new();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("woof"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&home.path()));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("mira"));
    let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
    let _logged = EnvGuard::set("WOOF_LOG", Some(&log.path()));
    let state = ReplyState::new();

    let fault = speak(&state, "fault").unwrap_err();
    let kept = speak(&state, "still").expect("kept");
    assert_eq!(fault, "nope");
    assert_eq!(kept, b"WAV:still");
    let rows = read_log(&log.path());
    assert_eq!(loads(&rows).len(), 1);
    assert_eq!(loads(&rows)[0][1], "mira");
    let first_pid = pid_of(loads(&rows)[0]);
    assert_eq!(
        command_line(first_pid).last().map(String::as_str),
        Some("mira")
    );

    let dead = speak(&state, "die").unwrap_err();
    let replaced = speak(&state, "back").expect("back");
    assert_eq!(dead, "woof closed");
    assert_eq!(replaced, b"WAV:back");
    let rows = read_log(&log.path());
    let loads = loads(&rows);
    assert_eq!(loads.len(), 2);
    assert_ne!(pid_of(loads[0]), pid_of(loads[1]));
    assert!(!alive(pid_of(loads[0])));
}

#[test]
fn voice_and_directory_changes_start_a_new_child() {
    let _lock = env_lock();
    let _python = EnvGuard::set("CAPRICE_PYTHON", None);
    let first_home = Home::new();
    let second_home = Home::new();
    let log = LogFile::new();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("woof"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&first_home.path()));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some(" juno "));
    let _url = EnvGuard::set("CAPRICE_TTS_URL", Some("http://127.0.0.1:9/unused"));
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
    let _logged = EnvGuard::set("WOOF_LOG", Some(&log.path()));
    let state = ReplyState::new();

    assert_eq!(speak(&state, "one").expect("one"), b"WAV:one");
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("mira"));
    assert_eq!(speak(&state, "two").expect("two"), b"WAV:two");
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&second_home.path()));
    assert_eq!(speak(&state, "three").expect("three"), b"WAV:three");

    let logged = read_log(&log.path());
    let loads = loads(&logged);
    assert_eq!(loads.len(), 3);
    assert_eq!(loads[0][1], "juno");
    assert_eq!(loads[1][1], "mira");
    assert_eq!(loads[2][1], "mira");
    assert_eq!(loads[0][3], first_home.path());
    assert_eq!(loads[2][3], second_home.path());
    assert!(same_dir(&loads[0][2], &first_home.path()));
    assert!(same_dir(&loads[2][2], &second_home.path()));
    assert_ne!(pid_of(loads[0]), pid_of(loads[1]));
    assert_ne!(pid_of(loads[1]), pid_of(loads[2]));
    assert!(!alive(pid_of(loads[0])));
    assert!(!alive(pid_of(loads[1])));
}

#[test]
fn dropping_the_reply_state_kills_the_child() {
    let _lock = env_lock();
    let _python = EnvGuard::set("CAPRICE_PYTHON", None);
    let home = Home::new();
    let log = LogFile::new();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("woof"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&home.path()));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", None);
    let _logged = EnvGuard::set("WOOF_LOG", Some(&log.path()));
    let state = ReplyState::new();
    speak(&state, "bye").expect("bye");
    let logged = read_log(&log.path());
    let row = loads(&logged);
    let pid = pid_of(row[0]);
    let script = command_line(pid)
        .into_iter()
        .find(|arg| arg.ends_with(".py"))
        .expect("driver");
    assert!(alive(pid));
    assert!(std::path::Path::new(&script).is_file());
    drop(state);
    assert!(!alive(pid));
    assert!(!std::path::Path::new(&script).exists());
}

#[test]
fn missing_directory_and_unknown_voice_do_not_spawn() {
    let _lock = env_lock();
    let _python = EnvGuard::set("CAPRICE_PYTHON", None);
    let home = Home::new();
    let log = LogFile::new();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("woof"));
    let _logged = EnvGuard::set("WOOF_LOG", Some(&log.path()));
    let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
    let state = ReplyState::new();
    let before = woof_drivers();

    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", None);
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("mira"));
    assert_eq!(
        speak(&state, "hi").unwrap_err(),
        "CAPRICE_TTS_WOOF is not set"
    );
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(""));
    assert_eq!(
        speak(&state, "hi").unwrap_err(),
        "CAPRICE_TTS_WOOF is not set"
    );

    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some(&home.path()));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("Mira"));
    assert_eq!(speak(&state, "hi").unwrap_err(), "unknown woof voice: Mira");
    assert!(speak(&state, " \n").unwrap().is_empty());
    assert_eq!(woof_drivers(), before);
    assert!(!std::path::Path::new(&log.path()).exists());
}

#[test]
fn python_program_defaults_and_honors_an_override() {
    let _lock = env_lock();
    let _cleared = EnvGuard::set("CAPRICE_PYTHON", None);
    assert_eq!(python_program(), "python3");
    let _set = EnvGuard::set("CAPRICE_PYTHON", Some(" /caprice/python "));
    assert_eq!(python_program(), "/caprice/python");
    let _empty = EnvGuard::set("CAPRICE_PYTHON", Some("   "));
    assert_eq!(python_program(), "python3");
}
