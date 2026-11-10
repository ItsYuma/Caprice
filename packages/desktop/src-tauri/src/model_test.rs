use std::io::{Read, Write};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use super::{cancelled, model_endpoint, Flights, ModelState};

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvGuard {
    key: &'static str,
    previous: Option<String>,
}

impl EnvGuard {
    fn set(key: &'static str, value: Option<&str>) -> Self {
        let previous = std::env::var(key).ok();

        match value {
            Some(value) => unsafe { std::env::set_var(key, value) },
            None => unsafe { std::env::remove_var(key) },
        }

        Self { key, previous }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

fn env_lock() -> MutexGuard<'static, ()> {
    match ENV_LOCK.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn clear_model_env() -> Vec<EnvGuard> {
    [
        "CAPRICE_MODEL_URL",
        "CAPRICE_MODEL",
        "CAPRICE_MODEL_API_KEY",
        "CAPRICE_MODEL_PROTOCOL",
        "CAPRICE_MODEL_RUNTIME",
        "CAPRICE_MODEL_EXECUTABLE",
        "CAPRICE_MODEL_DEADLINE_MS",
        "CAPRICE_MODEL_READY_MS",
    ]
    .into_iter()
    .map(EnvGuard::set_none)
    .collect()
}

impl EnvGuard {
    fn set_none(key: &'static str) -> Self {
        Self::set(key, None)
    }
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 2048];

    while !buf.windows(4).any(|window| window == b"\r\n\r\n") && buf.len() < 65_536 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => buf.extend_from_slice(&chunk[..count]),
        }
    }

    String::from_utf8_lossy(&buf).into_owned()
}

#[test]
fn endpoint_returns_model_protocol_and_deadline_without_the_key() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let _url = EnvGuard::set("CAPRICE_MODEL_URL", Some("http://127.0.0.1:9/secret-path"));
    let _model = EnvGuard::set("CAPRICE_MODEL", Some(" shell-model "));
    let _key = EnvGuard::set("CAPRICE_MODEL_API_KEY", Some("caprice-test-key"));
    let _protocol = EnvGuard::set("CAPRICE_MODEL_PROTOCOL", Some(" native "));
    let _deadline = EnvGuard::set("CAPRICE_MODEL_DEADLINE_MS", Some("1500"));
    let payload = model_endpoint().expect("endpoint");
    let json = serde_json::to_string(&payload).expect("json");

    assert_eq!(
        json,
        "{\"model\":\"shell-model\",\"protocol\":\"native\",\"timeoutMs\":1500}"
    );
    assert!(!json.contains("caprice-test-key"));
    assert!(!json.contains("secret-path"));

    let _deadline = EnvGuard::set("CAPRICE_MODEL_DEADLINE_MS", None);
    let _protocol = EnvGuard::set("CAPRICE_MODEL_PROTOCOL", None);
    let defaults = model_endpoint().expect("defaults");

    assert_eq!(defaults.protocol, "text");
    assert_eq!(defaults.timeout_ms, 60_000);
}

#[test]
fn a_misconfigured_endpoint_is_rejected() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let state = ModelState::new();

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_URL is required"
    );

    let _url = EnvGuard::set("CAPRICE_MODEL_URL", Some("file:///tmp/model"));
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_URL is not an http url"
    );

    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some("http://user:secret@brain.example/v1/chat/completions"),
    );

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_URL is not an http url"
    );

    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some("http://brain.example/v1/chat/completions"),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some(" "));

    assert_eq!(model_endpoint().unwrap_err(), "CAPRICE_MODEL is required");

    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let _protocol = EnvGuard::set("CAPRICE_MODEL_PROTOCOL", Some("Native"));

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_PROTOCOL is text or native"
    );

    let _protocol = EnvGuard::set("CAPRICE_MODEL_PROTOCOL", Some("text"));
    let _runtime = EnvGuard::set("CAPRICE_MODEL_RUNTIME", Some("ollama"));

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_EXECUTABLE is required"
    );

    let _runtime = EnvGuard::set("CAPRICE_MODEL_RUNTIME", Some("local"));

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_RUNTIME is external or ollama"
    );

    let _runtime = EnvGuard::set("CAPRICE_MODEL_RUNTIME", None);
    let _deadline = EnvGuard::set("CAPRICE_MODEL_DEADLINE_MS", Some("0"));

    assert_eq!(
        model_endpoint().unwrap_err(),
        "CAPRICE_MODEL_DEADLINE_MS is not a whole number of milliseconds"
    );

    let error =
        tauri::async_runtime::block_on(state.complete("{}".to_string(), "id-1".to_string()))
            .unwrap_err();

    assert_eq!(
        error,
        "CAPRICE_MODEL_DEADLINE_MS is not a whole number of milliseconds"
    );
}

#[test]
fn complete_posts_the_body_to_the_env_endpoint() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();

        for status in [200_u16, 200, 503] {
            let (mut stream, _) = listener.accept().expect("accept");
            let request = read_request(&mut stream);

            if status == 200 {
                let payload = "{\"ok\":true}";
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
                    payload.len()
                );
                stream.write_all(response.as_bytes()).expect("write");
            } else {
                let response = "HTTP/1.1 503 Service Unavailable\r\ncontent-length: 11\r\nconnection: close\r\n\r\nsecret-body";
                stream.write_all(response.as_bytes()).expect("write");
            }

            requests.push(request);
        }

        requests
    });
    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/chat")),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let _key = EnvGuard::set("CAPRICE_MODEL_API_KEY", Some("caprice-test-key"));
    let _runtime = EnvGuard::set("CAPRICE_MODEL_RUNTIME", Some("external"));
    let _executable = EnvGuard::set(
        "CAPRICE_MODEL_EXECUTABLE",
        Some("caprice-ollama-should-not-spawn"),
    );
    let state = ModelState::new();
    let body = "{\"model\":\"shell-model\"}".to_string();
    let text = tauri::async_runtime::block_on(state.complete(body.clone(), "post-1".to_string()))
        .expect("post");
    let _key = EnvGuard::set("CAPRICE_MODEL_API_KEY", None);
    let again = tauri::async_runtime::block_on(state.complete(body.clone(), "post-2".to_string()))
        .expect("post again");
    let rejected =
        tauri::async_runtime::block_on(state.complete(body, "post-3".to_string())).unwrap_err();
    let requests = server.join().expect("server");
    let first = requests[0].to_ascii_lowercase();
    let second = requests[1].to_ascii_lowercase();

    assert_eq!(text, "{\"ok\":true}");
    assert_eq!(again, "{\"ok\":true}");
    assert!(first.starts_with("post /custom/chat "));
    assert!(first.contains("authorization: bearer caprice-test-key"));
    assert!(requests[0].contains("{\"model\":\"shell-model\"}"));
    assert!(!second.contains("authorization"));
    assert_eq!(rejected, "model request failed: 503");
    assert!(!rejected.contains("secret-body"));
}

#[test]
fn an_oversized_reply_is_rejected() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let _ = read_request(&mut stream);
        let header = "HTTP/1.1 200 OK\r\ncontent-length: 9000000\r\nconnection: close\r\n\r\n";
        stream.write_all(header.as_bytes()).expect("write");
    });
    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/chat")),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let state = ModelState::new();
    let error = tauri::async_runtime::block_on(state.complete("{}".to_string(), "big".to_string()))
        .unwrap_err();

    assert_eq!(error, "model reply is too large");
    server.join().expect("server");
}

#[test]
fn the_model_request_stops_at_the_deadline() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let _ = read_request(&mut stream);
        std::thread::sleep(Duration::from_secs(3));
    });
    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/chat")),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let _deadline = EnvGuard::set("CAPRICE_MODEL_DEADLINE_MS", Some("400"));
    let state = ModelState::new();
    let started = std::time::Instant::now();
    let error =
        tauri::async_runtime::block_on(state.complete("{}".to_string(), "slow".to_string()))
            .unwrap_err();

    assert_eq!(error, "the model timed out");
    assert!(started.elapsed() < Duration::from_millis(1_500), "{error}");
    let _ = server.join();
}

#[test]
fn cancel_before_register_does_not_post() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.set_nonblocking(true).expect("nonblocking");
    let port = listener.local_addr().expect("addr").port();
    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/chat")),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let state = ModelState::new();

    state.cancel("  ").unwrap_err();
    state.cancel("early").expect("cancel");

    let error = tauri::async_runtime::block_on(state.complete(
        "{\"model\":\"shell-model\"}".to_string(),
        "early".to_string(),
    ))
    .unwrap_err();
    let empty = tauri::async_runtime::block_on(state.complete("{}".to_string(), " ".to_string()))
        .unwrap_err();

    assert_eq!(error, "cancelled");
    assert_eq!(empty, "request id is required");
    assert!(listener.accept().is_err());
}

#[test]
fn cancel_aborts_only_the_matching_request() {
    let _lock = env_lock();
    let _clear = clear_model_env();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().expect("accept");
            let request = read_request(&mut stream);

            if request.contains("\"slow\"") {
                let _ = accepted_tx.send(());
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    drop(stream);
                });
            } else {
                std::thread::spawn(move || {
                    let payload = "{\"ok\":true}";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
                        payload.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                });
            }
        }
    });
    let _url = EnvGuard::set(
        "CAPRICE_MODEL_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/chat")),
    );
    let _model = EnvGuard::set("CAPRICE_MODEL", Some("shell-model"));
    let state = ModelState::new();
    let slow_state = state.clone();
    let slow = tauri::async_runtime::spawn(async move {
        slow_state
            .complete("{\"slow\":true}".to_string(), "old".to_string())
            .await
    });

    accepted_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("accepted");

    let duplicate = tauri::async_runtime::block_on(
        state.complete("{\"slow\":true}".to_string(), "old".to_string()),
    )
    .unwrap_err();
    let fast = tauri::async_runtime::block_on(
        state.complete("{\"fast\":true}".to_string(), "new".to_string()),
    )
    .expect("fast");

    state.cancel("old").expect("cancel old");
    state.cancel("old").expect("stale cancel");

    let slow = tauri::async_runtime::block_on(slow)
        .expect("join")
        .unwrap_err();

    assert_eq!(duplicate, "request id is already in use");
    assert_eq!(fast, "{\"ok\":true}");
    assert_eq!(slow, "cancelled");
    let _ = server.join();
}

#[test]
fn a_cancel_before_register_rejects_only_that_id() {
    let mut flights = Flights::new();

    flights.cancel("old").expect("cancel");

    assert_eq!(flights.begin("old").unwrap_err(), "cancelled");

    let newer = flights.begin("new").expect("begin");

    flights.cancel("old").expect("stale");

    assert!(!cancelled(&newer.cancel));
}

#[test]
fn a_stale_cancel_after_finish_does_not_arm_a_later_id() {
    let mut flights = Flights::new();
    let first = flights.begin("one").expect("begin");

    flights.finish(&first);
    flights.cancel("one").expect("stale");

    let second = flights.begin("two").expect("second");

    flights.cancel("one").expect("stale again");

    assert!(!cancelled(&second.cancel));
    assert_eq!(
        flights.begin("one").unwrap_err(),
        "request id is already finished"
    );
}

#[test]
fn cancel_during_a_request_marks_only_that_flight() {
    let mut flights = Flights::new();
    let older = flights.begin("old").expect("old");
    let newer = flights.begin("new").expect("new");

    flights.cancel("old").expect("cancel");

    assert!(cancelled(&older.cancel));
    assert!(!cancelled(&newer.cancel));
}

#[test]
fn cancel_and_begin_cannot_leave_a_request_running() {
    for _ in 0..40 {
        let flights = std::sync::Arc::new(Mutex::new(Flights::new()));
        let started = std::sync::Arc::new(std::sync::Barrier::new(2));
        let cancel_flights = std::sync::Arc::clone(&flights);
        let cancel_started = std::sync::Arc::clone(&started);
        let canceller = std::thread::spawn(move || {
            cancel_started.wait();
            lock_flights(&cancel_flights)
                .cancel("race")
                .expect("cancel");
        });
        let begin_flights = std::sync::Arc::clone(&flights);
        let begin_started = std::sync::Arc::clone(&started);
        let beginner = std::thread::spawn(move || {
            begin_started.wait();
            lock_flights(&begin_flights).begin("race")
        });

        canceller.join().expect("cancel thread");

        match beginner.join().expect("begin thread") {
            Err(message) => assert_eq!(message, "cancelled"),
            Ok(ticket) => assert!(cancelled(&ticket.cancel)),
        }
    }
}

fn lock_flights(flights: &Mutex<Flights>) -> MutexGuard<'_, Flights> {
    match flights.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}
