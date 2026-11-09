use std::io::{self, BufRead, Write};
use std::path::Path;

use super::contract::Transcriber;
use super::engine::{Engine, EngineKind};
use super::protocol::{decode_pcm, Request, Response};

pub const FLAG: &str = "--speech-worker";

enum Slot {
    Empty,
    Loaded(Box<Engine>),
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
        Request::Load { model, engine } => {
            let kind = match EngineKind::parse(&engine) {
                Ok(kind) => kind,
                Err(message) => {
                    *slot = Slot::Empty;
                    return Response::Error { message };
                }
            };
            match Engine::load(kind, Path::new(&model)) {
                Ok(engine) => {
                    *slot = Slot::Loaded(Box::new(engine));
                    Response::Ready
                }
                Err(message) => {
                    *slot = Slot::Empty;
                    Response::Error { message }
                }
            }
        }
        Request::Transcribe { rate, pcm } => {
            let samples = match decode_pcm(&pcm) {
                Ok(samples) => samples,
                Err(message) => return Response::Error { message },
            };
            let Slot::Loaded(engine) = slot else {
                return Response::Error {
                    message: "speech model is not loaded".to_string(),
                };
            };
            match engine.transcribe(&samples, rate) {
                Ok(text) => Response::Text { text },
                Err(message) => Response::Error { message },
            }
        }
        Request::Feed { pcm } => {
            let samples = match decode_pcm(&pcm) {
                Ok(samples) => samples,
                Err(message) => return Response::Error { message },
            };
            let Slot::Loaded(engine) = slot else {
                return Response::Error {
                    message: "speech model is not loaded".to_string(),
                };
            };
            match engine.feed(&samples) {
                Ok(text) => Response::Partial { text },
                Err(message) => Response::Error { message },
            }
        }
        Request::Finish => {
            let Slot::Loaded(engine) = slot else {
                return Response::Error {
                    message: "speech model is not loaded".to_string(),
                };
            };
            match engine.finish() {
                Ok(text) => Response::Text { text },
                Err(message) => Response::Error { message },
            }
        }
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
