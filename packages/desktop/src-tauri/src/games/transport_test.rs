use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{
    clip, exchange, exchange_limited, extend_bounded, insecure_local, local_client, loopback_url,
};

fn basic(token: &str) -> String {
    super::super::discover::basic_token(token)
}

#[test]
fn an_encoded_riot_id_stays_on_loopback_without_a_fragment() {
    let url = loopback_url(
        "https",
        2999,
        "/liveclientdata/playerscores?riotId=Hide%20on%20bush%23KR1",
    )
    .expect("url");
    assert_eq!(
        url.as_str(),
        "https://127.0.0.1:2999/liveclientdata/playerscores?riotId=Hide%20on%20bush%23KR1"
    );
    assert!(url.fragment().is_none());
    assert!(url.username().is_empty());
    assert_eq!(url.port(), Some(2999));
    assert_eq!(
        loopback_url("https", 2999, "/liveclientdata/gamestats")
            .expect("stats")
            .as_str(),
        "https://127.0.0.1:2999/liveclientdata/gamestats"
    );
    assert!(loopback_url("https", 2999, "/liveclientdata/x?riotId=A#B").is_err());
    assert!(loopback_url("https", 2999, "/liveclientdata/%2e%2e/secret").is_err());
    assert!(loopback_url("ftp", 2999, "/liveclientdata/gamestats").is_err());
    assert!(loopback_url("https", 0, "/liveclientdata/gamestats").is_err());
}

#[test]
fn exchange_posts_to_loopback_and_keeps_the_body() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 4096];
        let read = stream.read(&mut buf).expect("read");
        let request = String::from_utf8_lossy(&buf[..read]).to_string();
        let payload = "{\"phase\":\"ChampSelect\"}";
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        request
    });

    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/lol-gameflow/v1/gameflow-phase").expect("url");
    let text = tauri::async_runtime::block_on(exchange(
        &client,
        &url,
        "GET",
        &basic("abc"),
        None,
        "league client",
    ))
    .expect("get");
    let request = handle.join().expect("server").to_ascii_lowercase();

    assert_eq!(text, "{\"phase\":\"ChampSelect\"}");
    assert!(request.starts_with("get /lol-gameflow/v1/gameflow-phase "));
    assert!(request.contains("authorization: basic cmlvddphymm="));
    assert!(request.contains("accept: application/json"));
}

#[test]
fn exchange_sends_a_json_body_and_reports_status() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 4096];
        let read = stream.read(&mut buf).expect("read");
        let request = String::from_utf8_lossy(&buf[..read]).to_string();
        let payload = "no lobby";
        let response = format!(
            "HTTP/1.1 404 Not Found\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        request
    });

    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/lol-lobby/v2/lobby/matchmaking/search").expect("url");
    let err = tauri::async_runtime::block_on(exchange(
        &client,
        &url,
        "POST",
        "",
        Some("{}"),
        "league client",
    ))
    .expect_err("status");
    let request = handle.join().expect("server");

    assert_eq!(err, "league client returned 404: no lobby");
    assert!(request
        .to_ascii_lowercase()
        .starts_with("post /lol-lobby/v2/lobby/matchmaking/search "));
    assert!(request.contains("\r\n\r\n{}"));
}

#[test]
fn an_empty_success_body_becomes_an_empty_object() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        stream
            .write_all(b"HTTP/1.1 204 No Content\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .expect("write");
    });

    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/lol-matchmaking/v1/ready-check/accept").expect("url");
    let text = tauri::async_runtime::block_on(exchange(
        &client,
        &url,
        "POST",
        "",
        Some("{}"),
        "league client",
    ))
    .expect("empty");
    handle.join().expect("server");
    assert_eq!(text, "{}");
}

#[test]
fn exchange_refuses_a_url_that_leaves_the_machine() {
    let client = insecure_local().expect("client");

    for raw in [
        "https://example.com/liveclientdata/allgamedata",
        "https://localhost/liveclientdata/allgamedata",
        "http://127.0.0.2/liveclientdata/allgamedata",
        "https://riot:secret@127.0.0.1:2999/liveclientdata/allgamedata",
    ] {
        let url = reqwest::Url::parse(raw).expect("parse");
        let err =
            tauri::async_runtime::block_on(exchange(&client, &url, "GET", "", None, "live client"))
                .expect_err("remote");
        assert_eq!(err, "league url is not local", "{raw}");
    }
}

#[test]
fn a_redirect_is_not_followed() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let hits = Arc::new(AtomicUsize::new(0));
    let hits_server = Arc::clone(&hits);
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        hits_server.fetch_add(1, Ordering::SeqCst);
        let mut buf = [0_u8; 1024];
        let _ = stream.read(&mut buf);
        let payload = "moved";
        let response = format!(
            "HTTP/1.1 302 Found\r\nlocation: http://example.com/steal\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
    });

    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/liveclientdata/allgamedata").expect("url");
    let err =
        tauri::async_runtime::block_on(exchange(&client, &url, "GET", "", None, "live client"))
            .expect_err("redirect");
    handle.join().expect("server");
    assert_eq!(err, "live client returned 302: moved");
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_chunk_past_the_cap_is_not_kept() {
    let mut body = vec![b'a'; 3];
    let chunk = vec![b'b'; 10];
    assert!(extend_bounded(&mut body, &chunk, 5));
    assert_eq!(body, b"aaabb");
    let text = clip(&[0xea], true);
    assert_eq!(text, "\ntruncated");
    assert_eq!(clip(b"abc", false), "abc");
}

#[test]
fn exchange_stops_before_the_rest_of_a_long_body() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let release = Arc::new(AtomicBool::new(false));
    let release_server = Arc::clone(&release);
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        stream.set_nodelay(true).expect("nodelay");
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buf = Vec::new();
        let mut chunk = [0_u8; 1024];

        while !buf.windows(4).any(|window| window == b"\r\n\r\n") && buf.len() < 8192 {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
            }
        }

        let prefix = "x".repeat(180);
        let header =
            format!("HTTP/1.1 200 OK\r\ncontent-length: 400\r\nconnection: close\r\n\r\n{prefix}");
        stream.write_all(header.as_bytes()).expect("write");
        stream.flush().expect("flush");
        ready_tx.send(()).expect("ready");
        let started = Instant::now();

        while !release_server.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(20));
        }

        let _ = stream.write_all(b"TAIL-SHOULD-NOT-APPEAR");
        let _ = stream.write_all(&[b'y'; 199]);
    });
    let (result_tx, result_rx) = std::sync::mpsc::channel();
    let client_thread = std::thread::spawn(move || {
        let client = local_client(Duration::from_secs(2)).expect("client");
        let url = loopback_url("http", port, "/liveclientdata/allgamedata").expect("url");
        let result = tauri::async_runtime::block_on(exchange_limited(
            &client,
            &url,
            "GET",
            "",
            None,
            "live client",
            64,
        ));
        let _ = result_tx.send(result);
    });

    ready_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("prefix");
    let result = result_rx.recv_timeout(Duration::from_millis(500));
    release.store(true, Ordering::SeqCst);
    let text = result
        .expect("client waited for the unread tail")
        .expect("body");
    client_thread.join().expect("client thread");
    server.join().expect("server");
    assert!(text.ends_with("\ntruncated"));
    assert!(!text.contains("TAIL-SHOULD-NOT-APPEAR"));
    assert_eq!(text.trim_end_matches("\ntruncated").len(), 64);
    assert!(text.starts_with(&"x".repeat(64)));
}

#[test]
fn a_silent_server_times_out_as_not_running() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        std::thread::sleep(Duration::from_secs(2));
        drop(stream);
    });
    let client = local_client(Duration::from_millis(200)).expect("client");
    let url = loopback_url("http", port, "/liveclientdata/allgamedata").expect("url");
    let started = Instant::now();
    let err =
        tauri::async_runtime::block_on(exchange(&client, &url, "GET", "", None, "live client"))
            .expect_err("timeout");
    assert_eq!(err, "live client is not running");
    assert!(started.elapsed() < Duration::from_secs(1));
    server.join().expect("server");
}

#[test]
fn a_closed_port_is_not_running() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);
    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/liveclientdata/allgamedata").expect("url");
    let err =
        tauri::async_runtime::block_on(exchange(&client, &url, "GET", "", None, "live client"))
            .expect_err("closed");
    assert_eq!(err, "live client is not running");
}

#[test]
fn a_dropped_post_is_not_sent_again() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    listener.set_nonblocking(true).expect("nonblocking");
    let hits = Arc::new(AtomicUsize::new(0));
    let hits_server = Arc::clone(&hits);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_server = Arc::clone(&stop);
    let server = std::thread::spawn(move || {
        let started = Instant::now();

        while !stop_server.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(3) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    hits_server.fetch_add(1, Ordering::SeqCst);
                    let mut buf = [0_u8; 1024];
                    let _ = stream.read(&mut buf);
                    drop(stream);
                }
                Err(err)
                    if err.kind() == std::io::ErrorKind::WouldBlock
                        || err.kind() == std::io::ErrorKind::Interrupted =>
                {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });
    let client = insecure_local().expect("client");
    let url = loopback_url("http", port, "/lol-matchmaking/v1/ready-check/accept").expect("url");
    let err = tauri::async_runtime::block_on(exchange(
        &client,
        &url,
        "POST",
        "",
        Some("{}"),
        "league client",
    ))
    .expect_err("reset");
    std::thread::sleep(Duration::from_millis(150));
    stop.store(true, Ordering::SeqCst);
    server.join().expect("server");
    assert_eq!(hits.load(Ordering::SeqCst), 1, "{err}");
}
