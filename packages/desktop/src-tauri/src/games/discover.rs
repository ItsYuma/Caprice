use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

const COMMAND_LINE_WAIT: Duration = Duration::from_millis(3500);
const COMMAND_LINE_BYTES: usize = 256 * 1024;

pub(in crate::league) struct Lockfile {
    pub(in crate::league) port: u16,
    pub(in crate::league) token: String,
    pub(in crate::league) protocol: String,
}

struct Locate {
    override_path: String,
    home: String,
    program_files: String,
    platform: Os,
    settings: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Os {
    Windows,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Macos,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Linux,
}

enum Step {
    Override,
    Process,
    Lockfiles(Vec<String>),
    Found(Lockfile),
    Failed(&'static str),
}

enum Capture {
    Running {
        child: Child,
        output: JoinHandle<Vec<u8>>,
        started: Instant,
        limit: Duration,
    },
    Exited {
        output: JoinHandle<Vec<u8>>,
    },
    Expired {
        child: Child,
        output: JoinHandle<Vec<u8>>,
    },
    Done(Option<Vec<u8>>),
}

pub(in crate::league) fn current_credentials() -> Result<Lockfile, String> {
    let program_data = std::env::var("ProgramData").unwrap_or_default();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| {
        if cfg!(windows) {
            "C:\\Program Files".to_string()
        } else {
            String::new()
        }
    });
    let input = Locate {
        override_path: std::env::var("CAPRICE_LEAGUE_LOCKFILE").unwrap_or_default(),
        home,
        program_files,
        platform: current_os(),
        settings: settings_text(&program_data),
    };
    locate_from(&input, &read_text, &running_client_args)
}

fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Macos
    } else {
        Os::Linux
    }
}

fn locate_from(
    input: &Locate,
    read: &dyn Fn(&str) -> Option<String>,
    process_args: &dyn Fn() -> Vec<String>,
) -> Result<Lockfile, String> {
    let mut step = Step::Override;

    loop {
        step = match step {
            Step::Override => after_override(input, read),
            Step::Process => after_process(process_args()),
            Step::Lockfiles(args) => after_lockfiles(input, &args, read),
            Step::Found(lock) => return Ok(lock),
            Step::Failed(message) => return Err(message.to_string()),
        };
    }
}

fn after_override(input: &Locate, read: &dyn Fn(&str) -> Option<String>) -> Step {
    let path = input.override_path.trim();

    if path.is_empty() {
        return Step::Process;
    }

    let Some(text) = read(path) else {
        return Step::Failed("CAPRICE_LEAGUE_LOCKFILE is not a league lockfile");
    };

    match parse_lockfile(&text) {
        Some(lock) => Step::Found(lock),
        None => Step::Failed("CAPRICE_LEAGUE_LOCKFILE is not a league lockfile"),
    }
}

fn after_process(args: Vec<String>) -> Step {
    if let Some(lock) = credentials_from_args(&args) {
        Step::Found(lock)
    } else {
        Step::Lockfiles(args)
    }
}

fn after_lockfiles(input: &Locate, args: &[String], read: &dyn Fn(&str) -> Option<String>) -> Step {
    for path in candidate_paths(input, args) {
        let Some(text) = read(&path) else {
            continue;
        };

        if let Some(lock) = parse_lockfile(&text) {
            return Step::Found(lock);
        }
    }

    Step::Failed("league client is not running")
}

fn settings_text(program_data: &str) -> String {
    if program_data.is_empty() {
        return String::new();
    }

    let path = format!(
        "{program_data}\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml"
    );
    std::fs::read_to_string(path).unwrap_or_default()
}

fn read_text(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn running_client_args() -> Vec<String> {
    let from_proc = args_from_proc();

    if credentials_from_args(&from_proc).is_some() {
        return from_proc;
    }

    let Some(line) = league_client_ux_command_line() else {
        return Vec::new();
    };

    args_from_command_line(&line)
}

fn args_from_proc() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }

        let Ok(bytes) = std::fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let args = split_cmdline(&bytes);

        if credentials_from_args(&args).is_some() {
            return args;
        }
    }

    Vec::new()
}

fn league_client_ux_command_line() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let child = command.spawn().ok()?;
    let bytes = capture_stdout(child, COMMAND_LINE_WAIT, COMMAND_LINE_BYTES)?;
    let text = String::from_utf8_lossy(&bytes);
    text.lines()
        .find(|line| line.contains("LeagueClientUx"))
        .map(|line| line.to_string())
}

fn capture_stdout(mut child: Child, limit: Duration, byte_limit: usize) -> Option<Vec<u8>> {
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let output = std::thread::spawn(move || drain_bounded(stdout, byte_limit));
    let mut phase = Capture::Running {
        child,
        output,
        started: Instant::now(),
        limit,
    };

    loop {
        phase = match phase {
            Capture::Running {
                mut child,
                output,
                started,
                limit,
            } => match child.try_wait() {
                Ok(Some(_)) => Capture::Exited { output },
                Ok(None) if started.elapsed() < limit => {
                    std::thread::sleep(Duration::from_millis(20));
                    Capture::Running {
                        child,
                        output,
                        started,
                        limit,
                    }
                }
                _ => Capture::Expired { child, output },
            },
            Capture::Exited { output } => Capture::Done(output.join().ok()),
            Capture::Expired { mut child, output } => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = output.join();
                Capture::Done(None)
            }
            Capture::Done(bytes) => return bytes,
        };
    }
}

fn drain_bounded(mut reader: impl Read, limit: usize) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut buf = [0_u8; 8 * 1024];

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(read) => {
                let room = limit.saturating_sub(kept.len());
                let take = read.min(room);
                kept.extend_from_slice(&buf[..take]);
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }

    kept
}

fn args_from_command_line(text: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    let mut quoted = false;
    let mut started = false;

    while let Some(ch) = chars.next() {
        match ch {
            ' ' | '\t' if !quoted => {
                if started {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            '\\' => {
                let mut slashes = 1;

                while chars.peek() == Some(&'\\') {
                    chars.next();
                    slashes += 1;
                }

                if chars.peek() == Some(&'"') {
                    current.extend(std::iter::repeat_n('\\', slashes / 2));

                    if slashes % 2 == 1 {
                        chars.next();
                        current.push('"');
                    }
                } else {
                    current.extend(std::iter::repeat_n('\\', slashes));
                }

                started = true;
            }
            '"' => {
                quoted = !quoted;
                started = true;
            }
            other => {
                current.push(other);
                started = true;
            }
        }
    }

    if started {
        args.push(current);
    }

    args
}

fn split_cmdline(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect()
}

fn credentials_from_args(args: &[String]) -> Option<Lockfile> {
    let client = args.iter().any(|arg| arg.contains("LeagueClientUx"));

    if !client {
        return None;
    }

    let mut port = None;
    let mut token = None;

    for arg in args {
        if let Some(value) = arg.strip_prefix("--app-port=") {
            port = parse_port(value);
        }

        if let Some(value) = arg.strip_prefix("--remoting-auth-token=") {
            if !value.is_empty() {
                token = Some(value.to_string());
            }
        }
    }

    Some(Lockfile {
        port: port?,
        token: token?,
        protocol: "https".to_string(),
    })
}

fn install_dir_from_args(args: &[String]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        if let Some(value) = arg.strip_prefix("--install-directory=") {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }

        if arg == "--install-directory" {
            let next = args.get(index + 1)?;

            if !next.is_empty() && !next.starts_with('-') {
                return Some(next.clone());
            }
        }
    }

    None
}

fn install_dir_from_exe(args: &[String]) -> Option<String> {
    let exe = args.iter().find(|arg| {
        matches!(
            arg.rsplit(['\\', '/']).next(),
            Some("LeagueClientUx.exe" | "LeagueClientUx")
        )
    })?;
    parent_dir(exe)
}

fn parent_dir(path: &str) -> Option<String> {
    let trimmed = path.trim_end_matches(['\\', '/']);
    let split = trimmed.rfind(['\\', '/'])?;

    if split == 0 {
        None
    } else {
        Some(trimmed[..split].to_string())
    }
}

fn install_dir_from_settings(text: &str) -> Option<String> {
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("product_install_full_path:") else {
            continue;
        };

        if let Some(value) = yaml_scalar(rest) {
            return Some(value);
        }
    }

    None
}

fn yaml_scalar(rest: &str) -> Option<String> {
    let rest = rest.trim();

    if rest.is_empty() {
        return None;
    }

    if rest.starts_with('"') || rest.starts_with('\'') {
        return quoted_scalar(rest);
    }

    Some(rest.to_string())
}

fn quoted_scalar(rest: &str) -> Option<String> {
    let mut chars = rest.chars();
    let quote = chars.next()?;

    if quote != '"' && quote != '\'' {
        return None;
    }

    let mut value = String::new();

    while let Some(ch) = chars.next() {
        if ch == quote {
            let path = value.trim();

            if path.is_empty() {
                return None;
            }

            return Some(path.to_string());
        }

        if quote == '"' && ch == '\\' {
            match chars.next() {
                Some('\\') => value.push('\\'),
                Some('"') => value.push('"'),
                Some(other) => {
                    value.push('\\');
                    value.push(other);
                }
                None => value.push('\\'),
            }
            continue;
        }

        value.push(ch);
    }

    None
}

fn candidate_paths(input: &Locate, args: &[String]) -> Vec<String> {
    let mut paths = Vec::new();

    for dir in install_dirs(args, &input.settings) {
        push_path(
            &mut paths,
            lockfile_in(&native_dir(&dir, input.platform), input.platform),
        );
    }

    match input.platform {
        Os::Windows => {
            for letter in ['C', 'D', 'E', 'F', 'G', 'H'] {
                push_path(
                    &mut paths,
                    lockfile_in(
                        &format!("{letter}:\\Riot Games\\League of Legends"),
                        Os::Windows,
                    ),
                );
                push_path(
                    &mut paths,
                    lockfile_in(
                        &format!("{letter}:\\Games\\Riot Games\\League of Legends"),
                        Os::Windows,
                    ),
                );
                push_path(
                    &mut paths,
                    lockfile_in(
                        &format!("{letter}:\\Program Files\\Riot Games\\League of Legends"),
                        Os::Windows,
                    ),
                );
            }

            if !input.program_files.is_empty() {
                push_path(
                    &mut paths,
                    lockfile_in(
                        &format!("{}\\Riot Games\\League of Legends", input.program_files),
                        Os::Windows,
                    ),
                );
            }
        }
        Os::Macos => {
            push_path(
                &mut paths,
                lockfile_in(
                    "/Applications/League of Legends.app/Contents/LoL",
                    Os::Macos,
                ),
            );

            if !input.home.is_empty() {
                push_path(
                    &mut paths,
                    lockfile_in(
                        &format!(
                            "{}/Applications/League of Legends.app/Contents/LoL",
                            input.home
                        ),
                        Os::Macos,
                    ),
                );
            }
        }
        Os::Linux => {}
    }

    paths
}

fn install_dirs(args: &[String], settings: &str) -> Vec<String> {
    let mut dirs = Vec::new();

    if let Some(dir) = install_dir_from_args(args) {
        push_unique(&mut dirs, dir);
    }

    if let Some(dir) = install_dir_from_exe(args) {
        push_unique(&mut dirs, dir);
    }

    if let Some(dir) = install_dir_from_settings(settings) {
        push_unique(&mut dirs, dir);
    }

    dirs
}

fn push_unique(dirs: &mut Vec<String>, dir: String) {
    if !dir.is_empty() && !dirs.contains(&dir) {
        dirs.push(dir);
    }
}

fn push_path(paths: &mut Vec<String>, path: String) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}

fn lockfile_in(dir: &str, platform: Os) -> String {
    let sep = if platform == Os::Windows { '\\' } else { '/' };
    format!("{dir}{sep}lockfile")
}

fn native_dir(dir: &str, platform: Os) -> String {
    if platform == Os::Windows {
        dir.replace('/', "\\")
    } else {
        dir.replace('\\', "/")
    }
}

fn parse_lockfile(text: &str) -> Option<Lockfile> {
    let parts: Vec<&str> = text.trim().split(':').collect();

    if parts.len() < 5 {
        return None;
    }

    let port = parse_port(parts[2])?;
    let protocol = parts[parts.len() - 1].trim().to_ascii_lowercase();

    if protocol != "https" && protocol != "http" {
        return None;
    }

    let token = parts[3..parts.len() - 1].join(":");

    if token.is_empty() {
        return None;
    }

    Some(Lockfile {
        port,
        token,
        protocol,
    })
}

fn parse_port(text: &str) -> Option<u16> {
    let port = text.parse::<u16>().ok()?;

    if port == 0 {
        None
    } else {
        Some(port)
    }
}

pub(in crate::league) fn basic_token(token: &str) -> String {
    STANDARD.encode(format!("riot:{token}"))
}

#[cfg(test)]
#[path = "discover_test.rs"]
mod tests;
