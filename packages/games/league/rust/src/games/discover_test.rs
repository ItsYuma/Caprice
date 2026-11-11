use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use super::{
    args_from_command_line, basic_token, candidate_paths, capture_stdout, credentials_from_args,
    drain_bounded, install_dir_from_args, install_dir_from_settings, locate_from, parse_lockfile,
    Locate, Os,
};

#[test]
fn macos_and_linux_candidates_follow_the_install_layout() {
    let macos = Locate {
        override_path: String::new(),
        home: "/Users/me".to_string(),
        program_files: String::new(),
        platform: Os::Macos,
        settings: String::new(),
    };
    let paths = candidate_paths(&macos, &[]);
    assert!(paths
        .iter()
        .any(|path| path == "/Applications/League of Legends.app/Contents/LoL/lockfile"));
    assert!(paths.iter().any(|path| {
        path == "/Users/me/Applications/League of Legends.app/Contents/LoL/lockfile"
    }));

    let linux = Locate {
        override_path: String::new(),
        home: "/home/me".to_string(),
        program_files: String::new(),
        platform: Os::Linux,
        settings: "product_install_full_path: \"/opt/riot/League of Legends\"\n".to_string(),
    };
    let paths = candidate_paths(&linux, &[]);
    assert_eq!(
        paths,
        vec!["/opt/riot/League of Legends/lockfile".to_string()]
    );
}

fn windows(settings: &str) -> Locate {
    Locate {
        override_path: String::new(),
        home: "/Users/me".to_string(),
        program_files: "C:\\Program Files".to_string(),
        platform: Os::Windows,
        settings: settings.to_string(),
    }
}

#[test]
fn lockfile_and_process_credentials_are_found_without_returning_the_token_path() {
    let parsed = parse_lockfile("LeagueClient:42:5312:sec:ret:https").expect("lock");
    assert_eq!(parsed.port, 5312);
    assert_eq!(parsed.token, "sec:ret");
    assert_eq!(parsed.protocol, "https");
    assert_eq!(
        parse_lockfile("LeagueClient:1:1:t:HTTPS")
            .expect("case")
            .protocol,
        "https"
    );
    assert!(parse_lockfile("nope").is_none());
    assert!(parse_lockfile("LeagueClient:1:0:t:https").is_none());
    assert!(parse_lockfile("LeagueClient:1:1:t:ftp").is_none());
    assert_eq!(basic_token("abc"), "cmlvdDphYmM=");

    let args = vec![
        "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe".to_string(),
        "--app-port=5444".to_string(),
        "--remoting-auth-token=from-proc".to_string(),
    ];
    let from_proc = credentials_from_args(&args).expect("proc");
    assert_eq!(from_proc.port, 5444);
    assert_eq!(from_proc.token, "from-proc");
    assert!(credentials_from_args(&["--app-port=1".to_string()]).is_none());

    let line = "\"C:\\Riot Games\\League of Legends\\LeagueClientUx.exe\" --app-port=\"5444\" --remoting-auth-token=\"from-line\" --install-directory=\"E:\\Games\\My League\\League of Legends\"";
    let parsed_line = args_from_command_line(line);
    assert_eq!(
        parsed_line,
        vec![
            "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe".to_string(),
            "--app-port=5444".to_string(),
            "--remoting-auth-token=from-line".to_string(),
            "--install-directory=E:\\Games\\My League\\League of Legends".to_string(),
        ]
    );
    let from_line = credentials_from_args(&parsed_line).expect("line");
    assert_eq!(from_line.port, 5444);
    assert_eq!(from_line.token, "from-line");
    assert_eq!(from_line.protocol, "https");
    assert_eq!(
        install_dir_from_args(&parsed_line).as_deref(),
        Some("E:\\Games\\My League\\League of Legends")
    );

    let settings = "product_install_full_path: \"D:/Riot Games/League of Legends\"\n";
    assert_eq!(
        install_dir_from_settings(settings).as_deref(),
        Some("D:/Riot Games/League of Legends")
    );
    assert_eq!(
        install_dir_from_settings(
            "product_install_full_path: \"D:/Riot Games/League of Legends\" # note\n"
        )
        .as_deref(),
        Some("D:/Riot Games/League of Legends")
    );
    assert_eq!(
        install_dir_from_settings(
            "product_install_full_path: \"D:\\\\Riot Games\\\\League of Legends\"\n"
        )
        .as_deref(),
        Some("D:\\Riot Games\\League of Legends")
    );
    assert!(install_dir_from_settings("product_install_full_path: \"D:/Riot").is_none());

    let input = windows(settings);
    let paths = candidate_paths(&input, &[]);
    assert!(paths
        .iter()
        .any(|path| path == "D:\\Riot Games\\League of Legends\\lockfile"));
    assert!(paths
        .iter()
        .any(|path| path == "C:\\Program Files\\Riot Games\\League of Legends\\lockfile"));
    assert!(paths
        .iter()
        .any(|path| path == "H:\\Games\\Riot Games\\League of Legends\\lockfile"));
    assert!(paths
        .iter()
        .any(|path| path == "E:\\Program Files\\Riot Games\\League of Legends\\lockfile"));
    assert_eq!(
        paths
            .iter()
            .filter(|path| path.as_str()
                == "C:\\Program Files\\Riot Games\\League of Legends\\lockfile")
            .count(),
        1
    );

    let found = locate_from(
        &input,
        &|path| {
            if path == "D:\\Riot Games\\League of Legends\\lockfile" {
                Some("LeagueClient:1:2999:secret:https".to_string())
            } else {
                None
            }
        },
        &|| Vec::new(),
    )
    .expect("located");
    assert_eq!(found.port, 2999);
    assert_eq!(found.token, "secret");
}

#[test]
fn a_lockfile_override_is_read_before_process_discovery() {
    let calls = AtomicUsize::new(0);
    let mut input = windows("");
    input.override_path = "  C:\\custom\\lockfile  ".to_string();
    let found = locate_from(
        &input,
        &|path| {
            assert_eq!(path, "C:\\custom\\lockfile");
            Some("LeagueClient:1:4242:secret:https".to_string())
        },
        &|| {
            calls.fetch_add(1, Ordering::SeqCst);
            panic!("process discovery ran");
        },
    )
    .expect("override");
    assert_eq!(found.port, 4242);
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    let missing = locate_from(&input, &|_| None, &|| {
        calls.fetch_add(1, Ordering::SeqCst);
        Vec::new()
    });
    match missing {
        Err(message) => {
            assert_eq!(message, "CAPRICE_LEAGUE_LOCKFILE is not a league lockfile");
        }
        Ok(_) => panic!("override was accepted"),
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    input.override_path.clear();
    let from_process = locate_from(&input, &|_| panic!("lockfile read"), &|| {
        calls.fetch_add(1, Ordering::SeqCst);
        vec![
            "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe".to_string(),
            "--app-port=5444".to_string(),
            "--remoting-auth-token=from-proc".to_string(),
        ]
    })
    .expect("process");
    assert_eq!(from_process.token, "from-proc");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn a_quoted_install_path_is_the_lockfile_directory() {
    let line = "\"E:\\Games\\My League\\League of Legends\\LeagueClientUx.exe\" --install-directory=\"E:\\Games\\My League\\League of Legends\"";
    let args = args_from_command_line(line);
    let input = windows("");
    let found = locate_from(
        &input,
        &|path| {
            if path == "E:\\Games\\My League\\League of Legends\\lockfile" {
                Some("LeagueClient:1:4242:tok:https".to_string())
            } else {
                None
            }
        },
        &|| args.clone(),
    )
    .expect("quoted install");
    assert_eq!(found.port, 4242);
    assert_eq!(found.token, "tok");

    let exe_only =
        args_from_command_line("\"E:\\Games\\My League\\League of Legends\\LeagueClientUx.exe\"");
    let from_exe = locate_from(
        &input,
        &|path| {
            if path == "E:\\Games\\My League\\League of Legends\\lockfile" {
                Some("LeagueClient:1:7:from-exe:http".to_string())
            } else {
                None
            }
        },
        &|| exe_only.clone(),
    )
    .expect("exe directory");
    assert_eq!(from_exe.port, 7);
    assert_eq!(from_exe.protocol, "http");
}

#[test]
fn drain_keeps_the_cap_and_still_reads_the_rest() {
    struct Pieces {
        parts: Vec<Vec<u8>>,
        index: usize,
    }

    impl Read for Pieces {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.index >= self.parts.len() {
                return Ok(0);
            }

            let part = &self.parts[self.index];
            let n = part.len().min(buf.len());
            buf[..n].copy_from_slice(&part[..n]);
            self.index += 1;
            Ok(n)
        }
    }

    let reader = Pieces {
        parts: vec![b"0123456789".to_vec(); 10],
        index: 0,
    };
    let mut reader = reader;
    let kept = drain_bounded(&mut reader, 25);
    assert_eq!(kept, b"0123456789012345678901234");
    assert_eq!(reader.index, reader.parts.len());
}

#[test]
fn a_full_pipe_is_drained_while_the_process_is_still_running() {
    let child = spawn_piped(flood_command(200_000));
    let started = Instant::now();
    let output = capture_stdout(child, Duration::from_secs(15), 64 * 1024).expect("drained");
    assert!(
        started.elapsed() < Duration::from_secs(12),
        "stdout was left full until the wait expired"
    );
    assert_eq!(output.len(), 64 * 1024);
}

#[test]
fn a_stuck_process_is_killed_when_the_wait_expires() {
    let child = spawn_piped(sleeper_command());
    let started = Instant::now();
    let output = capture_stdout(child, Duration::from_millis(400), 1024);
    assert!(output.is_none());
    assert!(started.elapsed() < Duration::from_secs(3));
}

fn spawn_piped(mut command: Command) -> Child {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn")
}

fn flood_command(count: usize) -> Command {
    if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command"]);
        command.arg(format!("[Console]::Out.Write('x' * {count})"));
        command
    } else {
        let mut command = Command::new("sh");
        command.arg("-c");
        command.arg(format!("printf '%{count}s' '' | tr ' ' x"));
        command
    }
}

fn sleeper_command() -> Command {
    if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 20",
        ]);
        command
    } else {
        let mut command = Command::new("sleep");
        command.arg("20");
        command
    }
}
