use std::io::{Read, Write};

use super::super::reply::perform;
use super::super::test_support::{env_lock, woof_drivers, EnvGuard};
use super::super::ReplyState;
use super::{encode_audio, speech_credit};

fn spoken(text: &str) -> Result<String, String> {
    let state = ReplyState::new();
    let bytes = tauri::async_runtime::block_on(perform(&state, text.to_string()))?;
    Ok(encode_audio(&bytes))
}

#[test]
fn blank_text_does_not_speak() {
    let _lock = env_lock();
    let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
    let blank = spoken(" \n\t").unwrap();
    let empty = spoken("").unwrap();
    assert_eq!(blank, "");
    assert_eq!(empty, "");
}

#[test]
fn blank_text_with_a_bad_engine_does_not_spawn() {
    let _lock = env_lock();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("nope"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some("/caprice-woof-should-not-spawn"));
    let before = woof_drivers();
    let state = ReplyState::new();
    let bytes = tauri::async_runtime::block_on(perform(&state, " \n\t".into())).unwrap();
    assert!(bytes.is_empty());
    assert_eq!(woof_drivers(), before);
}

#[test]
fn speech_speak_returns_base64_audio() {
    let _lock = env_lock();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let payload = [0x00_u8, 0x01, 0xff, b'A'];
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for status in [200_u16, 200, 503] {
            let (mut stream, _) = listener.accept().expect("accept");
            let request = read_request(&mut stream);
            if status == 200 {
                let header = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    payload.len()
                );
                stream.write_all(header.as_bytes()).expect("write");
                stream.write_all(&payload).expect("body");
            } else {
                let header = "HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
                stream.write_all(header.as_bytes()).expect("write");
            }
            requests.push(request);
        }
        requests
    });

    let _url = EnvGuard::set(
        "CAPRICE_TTS_URL",
        Some(&format!("http://127.0.0.1:{port}/custom/speech")),
    );
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some("/caprice-woof-not-used"));
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", None);
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", None);
    let missing_model = spoken("say \"hi\"").unwrap_err();
    assert_eq!(missing_model, "CAPRICE_TTS_MODEL is not set");

    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", Some("shell-voice"));
    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", Some("capri"));
    let _key = EnvGuard::set("CAPRICE_TTS_API_KEY", Some("secret"));
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("http"));
    let audio = spoken("say \"hi\"").expect("speak");

    let _voice = EnvGuard::set("CAPRICE_TTS_VOICE", None);
    let _key = EnvGuard::set("CAPRICE_TTS_API_KEY", None);
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some(""));
    let plain = spoken("say \"hi\"").expect("plain");

    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some(" http "));
    let failed = spoken("say \"hi\"").unwrap_err();
    let requests = server.join().expect("server");

    assert_eq!(audio, "AAH/QQ==");
    assert_eq!(plain, "AAH/QQ==");
    assert_eq!(failed, "speech request failed: 503");
    assert_request(&requests[0], true, true);
    assert_request(&requests[1], false, false);
}

#[test]
fn http_names_a_missing_url() {
    let _lock = env_lock();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("http"));
    let _url = EnvGuard::set("CAPRICE_TTS_URL", None);
    let _model = EnvGuard::set("CAPRICE_TTS_MODEL", Some("shell-voice"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", None);
    assert_eq!(spoken("hi").unwrap_err(), "speech is not configured");
}

#[test]
fn a_rejected_reply_engine_does_not_spawn() {
    let _lock = env_lock();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("bark"));
    let _woof = EnvGuard::set("CAPRICE_TTS_WOOF", Some("/caprice-woof-should-not-spawn"));
    let before = woof_drivers();
    let err = tauri::async_runtime::block_on(perform(&ReplyState::new(), "hi".into())).unwrap_err();
    assert_eq!(err, "unknown reply engine: bark");
    assert_eq!(woof_drivers(), before);
}

#[test]
fn speech_credit_follows_the_reply_engine() {
    let _lock = env_lock();
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", None);
    assert_eq!(speech_credit().unwrap(), "");
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("http"));
    assert_eq!(speech_credit().unwrap(), "");
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some(" woof "));
    assert_eq!(speech_credit().unwrap(), "Voice by Underdog Woof");
    let _engine = EnvGuard::set("CAPRICE_TTS_ENGINE", Some("bark"));
    assert_eq!(speech_credit().unwrap_err(), "unknown reply engine: bark");
}

fn assert_request(request: &str, bearer: bool, voice: bool) {
    let lower = request.to_ascii_lowercase();
    assert!(lower.starts_with("post /custom/speech "));
    assert!(lower.contains("content-type: application/json"));
    if bearer {
        assert!(lower.contains("authorization: bearer secret"));
    } else {
        assert!(!lower.contains("authorization:"));
    }
    let body = request.split("\r\n\r\n").nth(1).expect("body");
    let json: serde_json::Value = serde_json::from_str(body).expect("json");
    assert_eq!(json["model"], "shell-voice");
    assert_eq!(json["input"], "say \"hi\"");
    if voice {
        assert_eq!(json["voice"], "capri");
    } else {
        assert!(json.get("voice").is_none());
    }
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .expect("timeout");
    let mut buf = Vec::new();
    let mut tmp = [0_u8; 2048];
    let mut header_end = None;
    let mut content_length = 0usize;
    loop {
        let read = stream.read(&mut tmp).expect("read");
        assert!(read > 0, "eof before request");
        buf.extend_from_slice(&tmp[..read]);
        if header_end.is_none() {
            if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&buf[..pos]).to_string();
                header_end = Some(pos + 4);
                content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.eq_ignore_ascii_case("content-length") {
                            value.trim().parse().ok()
                        } else {
                            None
                        }
                    })
                    .expect("content-length");
            }
        }
        if let Some(start) = header_end {
            if buf.len() >= start + content_length {
                buf.truncate(start + content_length);
                break;
            }
        }
    }
    String::from_utf8(buf).expect("utf8")
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
