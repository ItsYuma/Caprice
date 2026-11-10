use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    advance, probe_ready, spawn_ollama, Action, ChildProc, Gate, Kind, Owned, Plan, SpawnSpec,
};

fn ollama(executable: &str) -> Plan {
    Plan {
        kind: Kind::Ollama,
        endpoint: "http://127.0.0.1:11434".to_string(),
        executable: executable.to_string(),
        host: "127.0.0.1:11434".to_string(),
        readiness: "http://127.0.0.1:11434/api/tags".to_string(),
    }
}

fn external() -> Plan {
    Plan {
        kind: Kind::External,
        endpoint: "http://brain.example".to_string(),
        executable: "unused".to_string(),
        host: String::new(),
        readiness: String::new(),
    }
}

#[derive(Clone)]
struct Fake {
    alive: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}

impl Fake {
    fn alive() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(true)),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    fn dead() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
}

impl ChildProc for Fake {
    fn running(&mut self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    fn stop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.alive.store(false, Ordering::Release);
    }
}

fn failed(action: Action) -> String {
    match action {
        Action::Failed(message) => message,
        Action::Ready => panic!("ready"),
        Action::Wait => panic!("wait"),
    }
}

#[test]
fn external_stops_an_owned_child_and_does_not_spawn() {
    let child = Fake::alive();
    let mut gate = Gate {
        owned: Some(Owned {
            endpoint: "http://127.0.0.1:11434".to_string(),
            executable: "ollama".to_string(),
            child: child.clone(),
        }),
    };
    let mut spawned = false;
    let spawns = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&spawns);
    let action = advance(
        &mut gate,
        &external(),
        Instant::now(),
        false,
        &mut spawned,
        |_| {
            counted.fetch_add(1, Ordering::AcqRel);
            Ok(Fake::alive())
        },
    );

    assert!(matches!(action, Action::Ready));
    assert!(child.stopped());
    assert!(gate.owned.is_none());
    assert_eq!(spawns.load(Ordering::Acquire), 0);
}

#[test]
fn a_ready_endpoint_is_used_without_taking_ownership() {
    let sentinel = Fake::alive();
    let mut gate: Gate<Fake> = Gate { owned: None };
    let mut spawned = false;
    let action = advance(
        &mut gate,
        &ollama("ollama"),
        Instant::now() + Duration::from_secs(5),
        true,
        &mut spawned,
        |_| Ok(sentinel.clone()),
    );

    assert!(matches!(action, Action::Ready));
    assert!(gate.owned.is_none());
    assert!(!sentinel.stopped());
}

#[test]
fn switching_endpoints_stops_only_the_owned_child() {
    let previous = Fake::alive();
    let mut gate = Gate {
        owned: Some(Owned {
            endpoint: "http://10.0.0.8:11434".to_string(),
            executable: "old".to_string(),
            child: previous.clone(),
        }),
    };
    let mut spawned = false;
    let action = advance(
        &mut gate,
        &ollama("ollama"),
        Instant::now() + Duration::from_secs(5),
        true,
        &mut spawned,
        |_| Ok(Fake::alive()),
    );

    assert!(matches!(action, Action::Ready));
    assert!(previous.stopped());
    assert!(gate.owned.is_none());
}

#[test]
fn a_live_child_is_reused_for_the_same_endpoint() {
    let child = Fake::alive();
    let mut gate = Gate { owned: None };
    let mut spawned = false;
    let mut spawns = 0;
    let later = Instant::now() + Duration::from_secs(30);
    let plan = ollama("C:\\Program Files\\Ollama\\ollama.exe");
    let action = advance(&mut gate, &plan, later, false, &mut spawned, |_| {
        spawns += 1;
        Ok(child.clone())
    });

    assert!(matches!(action, Action::Wait));
    assert_eq!(spawns, 1);

    let action = advance(&mut gate, &plan, later, true, &mut spawned, |_| {
        spawns += 1;
        Ok(child.clone())
    });

    assert!(matches!(action, Action::Ready));
    assert_eq!(spawns, 1);
    assert!(gate.owned.is_some());
    assert!(!child.stopped());
}

#[test]
fn a_failed_start_owns_nothing() {
    let mut gate: Gate<Fake> = Gate { owned: None };
    let mut spawned = false;
    let message = failed(advance(
        &mut gate,
        &ollama("ollama"),
        Instant::now() + Duration::from_secs(5),
        false,
        &mut spawned,
        |_| Err("not found".to_string()),
    ));

    assert_eq!(message, "the model runtime failed to start: not found");
    assert!(gate.owned.is_none());
}

#[test]
fn a_child_that_exits_is_not_kept() {
    let child = Fake::dead();
    let mut gate = Gate { owned: None };
    let mut spawned = false;
    let message = failed(advance(
        &mut gate,
        &ollama("ollama"),
        Instant::now() + Duration::from_secs(5),
        false,
        &mut spawned,
        |_| Ok(child.clone()),
    ));

    assert_eq!(message, "the model runtime exited before it was ready");
    assert!(child.stopped());
    assert!(gate.owned.is_none());
}

#[test]
fn readiness_timeout_stops_the_owned_child() {
    let child = Fake::alive();
    let mut gate = Gate { owned: None };
    let mut spawned = false;
    let message = failed(advance(
        &mut gate,
        &ollama("ollama"),
        Instant::now() - Duration::from_secs(1),
        false,
        &mut spawned,
        |_| Ok(child.clone()),
    ));

    assert_eq!(message, "the model runtime timed out");
    assert!(child.stopped());
    assert!(gate.owned.is_none());
}

#[test]
fn serve_is_the_only_argument_and_it_is_not_a_shell() {
    let mut gate: Gate<Fake> = Gate { owned: None };
    let mut spawned = false;
    let mut seen = None;
    let plan = ollama("C:\\Program Files\\Ollama\\ollama.exe");
    let message = failed(advance(
        &mut gate,
        &plan,
        Instant::now() + Duration::from_secs(5),
        false,
        &mut spawned,
        |spec| {
            seen = Some(spec.clone());
            Err("stop".to_string())
        },
    ));

    assert_eq!(message, "the model runtime failed to start: stop");
    let spec = seen.expect("spec");
    assert_eq!(
        spec,
        SpawnSpec {
            executable: plan.executable,
            args: vec!["serve".to_string()],
            host: plan.host,
        }
    );
}

#[test]
fn a_missing_executable_is_spawned_directly() {
    let missing = std::env::temp_dir().join("caprice-ollama-missing");
    let error = spawn_ollama(&SpawnSpec {
        executable: missing.display().to_string(),
        args: vec!["serve".to_string()],
        host: "127.0.0.1:9".to_string(),
    })
    .unwrap_err();
    let lower = error.to_ascii_lowercase();

    assert!(!lower.contains("sh -c"), "{error}");
    assert!(!lower.contains("cmd /c"), "{error}");
    assert!(!lower.contains("pull"), "{error}");
}

#[test]
fn readiness_is_a_successful_tags_response() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        let body = "[]";
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
    });
    let client = reqwest::Client::builder().build().expect("client");
    let ready = format!("http://127.0.0.1:{port}/api/tags");
    let ok = tauri::async_runtime::block_on(probe_ready(&client, &ready));
    let closed =
        tauri::async_runtime::block_on(probe_ready(&client, "http://127.0.0.1:9/api/tags"));

    assert!(ok);
    assert!(!closed);
    server.join().expect("server");
}
