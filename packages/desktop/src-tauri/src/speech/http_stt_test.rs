use std::io::{Read, Write};

use super::super::test_support::{env_lock, EnvGuard};
use super::{post_clip, transcript_of, SttClip};

#[test]
fn a_json_text_field_is_the_transcript() {
    assert_eq!(
        transcript_of(br#"{"text":"  hi there  "}"#).unwrap(),
        "hi there"
    );
    assert_eq!(transcript_of(b"  plain line  ").unwrap(), "plain line");
    assert_eq!(
        transcript_of(br#"{"model":"x"}"#).unwrap(),
        r#"{"model":"x"}"#
    );
    assert!(transcript_of(&[0xff, 0xfe]).is_err());
}

#[test]
fn http_posts_the_clip_and_model() {
    let _lock = env_lock();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let request = read_request(&mut stream);
        let body = r#"{"text":" heard "}"#;
        let header = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).expect("write");
        stream.write_all(body.as_bytes()).expect("body");
        request
    });
    let _deadline = EnvGuard::set("CAPRICE_STT_DEADLINE_MS", None);
    let heard = tauri::async_runtime::block_on(post_clip(SttClip {
        samples: vec![0.0, 0.25, -0.25, 0.5],
        rate: 16_000,
        url: format!("http://127.0.0.1:{port}/stt"),
        model: "remote-stt".to_string(),
    }))
    .expect("post");
    let request = server.join().expect("server");
    assert_eq!(heard, "heard");
    let lower = request.to_ascii_lowercase();
    assert!(lower.starts_with("post /stt "));
    assert!(lower.contains("content-type: application/json"));
    let body = request.split("\r\n\r\n").nth(1).expect("body");
    let json: serde_json::Value = serde_json::from_str(body).expect("json");
    assert_eq!(json["model"], "remote-stt");
    let encoded = json["input"].as_str().expect("input");
    let wav =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).expect("wav");
    assert_eq!(&wav[0..4], b"RIFF");
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .expect("timeout");
    let mut buf = Vec::new();
    let mut tmp = [0_u8; 4096];
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
