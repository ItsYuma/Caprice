use std::io::{BufRead, BufReader, Write};
use std::thread;

use super::{feed_response, finish_response, run_on};
use crate::speech::engine::EngineKind;
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
            model: std::env::temp_dir()
                .join(format!(
                    "caprice-missing-speech-model-{}",
                    std::process::id()
                ))
                .to_string_lossy()
                .into(),
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

    send(&mut input_write, &Request::Finish);
    assert_eq!(
        recv(&mut output),
        Response::Error {
            message: "speech model is not loaded".into(),
        }
    );

    send(
        &mut input_write,
        &Request::Feed {
            pcm: encode_pcm(&[0.0]),
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

#[test]
fn bark_and_onnx_ignore_feed_and_reject_finish() {
    for kind in [EngineKind::Bark, EngineKind::Onnx] {
        assert_eq!(
            feed_response(kind),
            Some(Response::Partial {
                text: String::new()
            })
        );
        assert_eq!(
            finish_response(kind),
            Some(Response::Error {
                message: "speech engine does not stream".into(),
            })
        );
    }
    assert!(feed_response(EngineKind::BarkStream).is_none());
    assert!(finish_response(EngineKind::BarkStream).is_none());
    assert!(feed_response(EngineKind::Parakeet).is_none());
    assert!(finish_response(EngineKind::Parakeet).is_none());
}

#[test]
fn feed_and_finish_need_a_loaded_model() {
    let (input_read, mut input_write) = std::io::pipe().expect("input");
    let (output_read, output_write) = std::io::pipe().expect("output");
    let handle = thread::spawn(move || run_on(BufReader::new(input_read), output_write));
    let mut output = BufReader::new(output_read);

    send(
        &mut input_write,
        &Request::Feed {
            pcm: encode_pcm(&[0.0]),
        },
    );
    assert_eq!(
        recv(&mut output),
        Response::Error {
            message: "speech model is not loaded".into(),
        }
    );

    send(&mut input_write, &Request::Finish);
    assert_eq!(
        recv(&mut output),
        Response::Error {
            message: "speech model is not loaded".into(),
        }
    );

    drop(input_write);
    assert_eq!(handle.join().expect("worker"), 0);
}

#[test]
fn cancel_does_not_answer_and_a_transcript_is_dropped_when_discarded() {
    let (input_read, mut input_write) = std::io::pipe().expect("input");
    let (output_read, output_write) = std::io::pipe().expect("output");
    let handle = thread::spawn(move || run_on(BufReader::new(input_read), output_write));
    let mut output = BufReader::new(output_read);

    send(&mut input_write, &Request::Cancel);
    send(
        &mut input_write,
        &Request::Feed {
            pcm: encode_pcm(&[0.0]),
        },
    );
    assert_eq!(
        recv(&mut output),
        Response::Error {
            message: "speech model is not loaded".into(),
        }
    );

    assert_eq!(
        super::gate(
            true,
            Response::Text {
                text: "partial hello".into(),
            }
        ),
        Response::Error {
            message: "listening cancelled".into(),
        }
    );
    assert_eq!(
        super::gate(false, Response::Partial { text: "hi".into() }),
        Response::Partial { text: "hi".into() }
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
