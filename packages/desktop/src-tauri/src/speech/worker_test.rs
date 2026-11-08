use std::io::{BufRead, BufReader, Write};
use std::thread;

use super::run_on;
use crate::speech::protocol::{encode_pcm, Request, Response};

#[test]
fn the_worker_reports_a_missing_model_and_stays_up() {
    let (input_read, mut input_write) = std::io::pipe().expect("input");
    let (output_read, output_write) = std::io::pipe().expect("output");
    let handle = thread::spawn(move || run_on(BufReader::new(input_read), output_write));
    let mut output = BufReader::new(output_read);

    send(
        &mut input_write,
        &Request::Load {
            model: "/tmp/caprice-missing-speech-model".into(),
            engine: "onnx".into(),
        },
    );
    assert!(matches!(recv(&mut output), Response::Error { .. }));

    send(
        &mut input_write,
        &Request::Transcribe {
            rate: 16_000,
            pcm: encode_pcm(&[0.0, 0.25]),
        },
    );
    assert_eq!(
        recv(&mut output),
        Response::Error {
            message: "speech model is not loaded".into(),
        }
    );

    drop(input_write);
    assert_eq!(handle.join().expect("worker"), 0);
}

fn send(input: &mut impl Write, request: &Request) {
    let line = serde_json::to_string(request).expect("request");
    writeln!(input, "{line}").expect("write");
    input.flush().expect("flush");
}

fn recv(output: &mut impl BufRead) -> Response {
    let mut line = String::new();
    let read = output.read_line(&mut line).expect("read");
    assert!(read > 0, "worker closed");
    serde_json::from_str(line.trim()).expect("response")
}
