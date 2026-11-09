use std::io::{self, BufRead, Write};
use std::path::Path;

use super::bark_stream::Utterance;
use super::contract::Transcriber;
use super::engine::{Engine, EngineKind};
use super::protocol::{decode_pcm, Request, Response};

pub const FLAG: &str = "--speech-worker";

struct Resident {
    kind: EngineKind,
    engine: Box<Engine>,
    utterance: Utterance,
}

enum Slot {
    Empty,
    Loaded(Resident),
}

pub(crate) fn run() -> i32 {
    let stdin = io::stdin();
    let stdout = io::stdout();
    run_on(stdin.lock(), stdout)
}

pub(super) fn run_on(input: impl BufRead, mut output: impl Write) -> i32 {
    let mut slot = Slot::Empty;
    for line in input.lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                let _ = write_line(
                    &mut output,
                    &Response::Error {
                        message: err.to_string(),
                    },
                );
                return 1;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => dispatch(&mut slot, request),
            Err(err) => Response::Error {
                message: err.to_string(),
            },
        };
        if write_line(&mut output, &response).is_err() {
            return 1;
        }
    }
    0
}

fn dispatch(slot: &mut Slot, request: Request) -> Response {
    match request {
        Request::Load { model, engine } => load(slot, model, engine),
        Request::Transcribe { rate, pcm } => transcribe(slot, rate, pcm),
        Request::Feed { pcm } => feed(slot, pcm),
        Request::Finish => finish(slot),
    }
}

fn load(slot: &mut Slot, model: String, engine: String) -> Response {
    let kind = match EngineKind::parse(&engine) {
        Ok(kind) => kind,
        Err(message) => {
            *slot = Slot::Empty;
            return Response::Error { message };
        }
    };
    match Engine::load(kind, Path::new(&model)) {
        Ok(engine) => {
            *slot = Slot::Loaded(Resident {
                kind,
                engine: Box::new(engine),
                utterance: Utterance::new(),
            });
            Response::Ready
        }
        Err(message) => {
            *slot = Slot::Empty;
            Response::Error { message }
        }
    }
}

fn transcribe(slot: &mut Slot, rate: u32, pcm: String) -> Response {
    let samples = match decode_pcm(&pcm) {
        Ok(samples) => samples,
        Err(message) => return Response::Error { message },
    };
    let Slot::Loaded(resident) = slot else {
        return not_loaded();
    };
    match resident.engine.transcribe(&samples, rate) {
        Ok(text) => Response::Text { text },
        Err(message) => Response::Error { message },
    }
}

fn feed(slot: &mut Slot, pcm: String) -> Response {
    let Some(kind) = loaded_kind(slot) else {
        return not_loaded();
    };
    if let Some(response) = feed_response(kind) {
        return response;
    }
    let samples = match decode_pcm(&pcm) {
        Ok(samples) => samples,
        Err(message) => return Response::Error { message },
    };
    let Slot::Loaded(resident) = slot else {
        return not_loaded();
    };
    stream_feed(&mut resident.engine, &mut resident.utterance, &samples)
}

fn finish(slot: &mut Slot) -> Response {
    let Some(kind) = loaded_kind(slot) else {
        return not_loaded();
    };
    if let Some(response) = finish_response(kind) {
        return response;
    }
    let Slot::Loaded(resident) = slot else {
        return not_loaded();
    };
    stream_finish(&mut resident.engine, &mut resident.utterance)
}

fn loaded_kind(slot: &Slot) -> Option<EngineKind> {
    match slot {
        Slot::Empty => None,
        Slot::Loaded(resident) => Some(resident.kind),
    }
}

fn feed_response(kind: EngineKind) -> Option<Response> {
    match kind {
        EngineKind::BarkStream | EngineKind::Parakeet => None,
        EngineKind::Onnx | EngineKind::Bark => Some(Response::Partial {
            text: String::new(),
        }),
    }
}

fn finish_response(kind: EngineKind) -> Option<Response> {
    match kind {
        EngineKind::BarkStream | EngineKind::Parakeet => None,
        EngineKind::Onnx | EngineKind::Bark => Some(Response::Error {
            message: "speech engine does not stream".to_string(),
        }),
    }
}

fn stream_feed(engine: &mut Engine, utterance: &mut Utterance, samples: &[f32]) -> Response {
    match engine {
        Engine::BarkStream(engine) => match utterance.push(engine, samples) {
            Ok(text) => Response::Partial { text },
            Err(message) => Response::Error { message },
        },
        Engine::Parakeet(engine) => match engine.feed(samples) {
            Ok(text) => Response::Partial { text },
            Err(message) => Response::Error { message },
        },
        Engine::Onnx(_) | Engine::Bark(_) => Response::Partial {
            text: String::new(),
        },
    }
}

fn stream_finish(engine: &mut Engine, utterance: &mut Utterance) -> Response {
    match engine {
        Engine::BarkStream(engine) => match utterance.finish(engine) {
            Ok(text) => Response::Text { text },
            Err(message) => Response::Error { message },
        },
        Engine::Parakeet(engine) => match engine.finish() {
            Ok(text) => Response::Text { text },
            Err(message) => Response::Error { message },
        },
        Engine::Onnx(_) | Engine::Bark(_) => Response::Error {
            message: "speech engine does not stream".to_string(),
        },
    }
}

fn not_loaded() -> Response {
    Response::Error {
        message: "speech model is not loaded".to_string(),
    }
}

fn write_line(output: &mut impl Write, response: &Response) -> Result<(), String> {
    let line = serde_json::to_string(response).map_err(|err| err.to_string())?;
    writeln!(output, "{line}").map_err(|err| err.to_string())?;
    output.flush().map_err(|err| err.to_string())
}

#[cfg(test)]
#[path = "worker_test.rs"]
mod tests;
