use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;

use super::child::{read_capped_line, ReadFail};
use super::contract::Transcriber;
use super::engine::{Engine, EngineKind};
use super::limit::WORKER_REQUEST_BYTES;
use super::lock;
use super::protocol::{decode_pcm, Request, Response};

pub const FLAG: &str = "--speech-worker";

const CANCELLED: &str = "listening cancelled";

struct Resident {
    kind: EngineKind,
    engine: Box<Engine>,
}

enum Slot {
    Empty,
    Loaded(Resident),
}

struct CancelControl {
    token: Mutex<transcribe_cpp::CancelToken>,
    issued: AtomicU64,
    abort_through: AtomicU64,
    enabled: AtomicBool,
}

impl CancelControl {
    fn new() -> Self {
        Self {
            token: Mutex::new(transcribe_cpp::CancelToken::new()),
            issued: AtomicU64::new(0),
            abort_through: AtomicU64::new(0),
            enabled: AtomicBool::new(false),
        }
    }

    fn issue(&self) -> u64 {
        self.issued.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn cancel(&self) {
        let issued = self.issued.load(Ordering::SeqCst);
        self.abort_through.fetch_max(issued, Ordering::SeqCst);
        if self.enabled.load(Ordering::SeqCst) {
            lock(&self.token).cancel();
        }
    }

    fn discarded(&self, id: u64) -> bool {
        id <= self.abort_through.load(Ordering::SeqCst)
    }

    fn reset_token(&self) {
        if self.enabled.load(Ordering::SeqCst) {
            lock(&self.token).reset();
        }
    }

    fn install(&self, token: transcribe_cpp::CancelToken) {
        *lock(&self.token) = token;
        self.enabled.store(true, Ordering::SeqCst);
    }

    fn clear_install(&self) {
        self.enabled.store(false, Ordering::SeqCst);
    }
}

enum Incoming {
    Request(u64, Request),
    Invalid(String),
    Failed(String),
}

pub(crate) fn run() -> i32 {
    let control = Arc::new(CancelControl::new());
    let (tx, rx) = mpsc::channel();
    let reader_control = Arc::clone(&control);
    let reader = thread::spawn(move || {
        let stdin = std::io::stdin();
        forward(stdin.lock(), tx, reader_control);
    });
    let code = compute(rx, std::io::stdout(), control);
    let _ = reader.join();
    code
}

#[cfg(test)]
pub(super) fn run_on(input: impl BufRead + Send + 'static, output: impl Write) -> i32 {
    let control = Arc::new(CancelControl::new());
    let (tx, rx) = mpsc::channel();
    let reader_control = Arc::clone(&control);
    let reader = thread::spawn(move || forward(input, tx, reader_control));
    let code = compute(rx, output, control);
    let _ = reader.join();
    code
}

fn forward(mut input: impl BufRead, tx: mpsc::Sender<Incoming>, control: Arc<CancelControl>) {
    loop {
        match read_capped_line(&mut input, WORKER_REQUEST_BYTES) {
            Ok(None) => return,
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Request>(&line) {
                    Ok(Request::Cancel) => control.cancel(),
                    Ok(request) => {
                        let id = control.issue();
                        if tx.send(Incoming::Request(id, request)).is_err() {
                            return;
                        }
                    }
                    Err(err) => {
                        if tx.send(Incoming::Invalid(err.to_string())).is_err() {
                            return;
                        }
                    }
                }
            }
            Err(ReadFail::Closed) => return,
            Err(ReadFail::TooLarge) => {
                let _ = tx.send(Incoming::Failed(
                    "speech worker request is too large".to_string(),
                ));
                return;
            }
            Err(ReadFail::Message(message)) => {
                let _ = tx.send(Incoming::Failed(message));
                return;
            }
        }
    }
}

fn compute(rx: Receiver<Incoming>, mut output: impl Write, control: Arc<CancelControl>) -> i32 {
    let mut slot = Slot::Empty;
    while let Ok(incoming) = rx.recv() {
        match incoming {
            Incoming::Failed(message) => {
                let _ = write_line(&mut output, &Response::Error { message });
                return 1;
            }
            Incoming::Invalid(message) => {
                if write_line(&mut output, &Response::Error { message }).is_err() {
                    return 1;
                }
            }
            Incoming::Request(id, request) => {
                let response = dispatch(&mut slot, request, &control);
                let response = apply_discard(&mut slot, &control, id, response);
                let response = apply_discard(&mut slot, &control, id, response);
                if write_line(&mut output, &response).is_err() {
                    return 1;
                }
            }
        }
    }
    0
}

fn apply_discard(
    slot: &mut Slot,
    control: &CancelControl,
    id: u64,
    response: Response,
) -> Response {
    if !control.discarded(id) {
        return response;
    }
    discard_work(slot, control);
    gate(true, response)
}

fn discard_work(slot: &mut Slot, control: &CancelControl) {
    if let Slot::Loaded(resident) = slot {
        resident.engine.cancel();
        resident.engine.reset();
    }
    control.reset_token();
}

fn cancelled() -> Response {
    Response::Error {
        message: CANCELLED.to_string(),
    }
}

fn gate(discarded: bool, response: Response) -> Response {
    if discarded {
        cancelled()
    } else {
        response
    }
}

fn dispatch(slot: &mut Slot, request: Request, control: &CancelControl) -> Response {
    match request {
        Request::Load { model, engine } => load(slot, model, engine, control),
        Request::Transcribe { rate, pcm } => transcribe(slot, rate, pcm),
        Request::Feed { pcm } => feed(slot, pcm),
        Request::Finish => finish(slot),
        Request::Reset => reset(slot),
        Request::Cancel => cancelled(),
    }
}

fn load(slot: &mut Slot, model: String, engine: String, control: &CancelControl) -> Response {
    let kind = match EngineKind::parse(&engine) {
        Ok(kind) => kind,
        Err(message) => {
            *slot = Slot::Empty;
            control.clear_install();
            return Response::Error { message };
        }
    };
    match Engine::load(kind, Path::new(&model)) {
        Ok(engine) => {
            if let Some(token) = engine.cancellation() {
                control.install(token);
            } else {
                control.clear_install();
            }
            *slot = Slot::Loaded(Resident {
                kind,
                engine: Box::new(engine),
            });
            Response::Ready
        }
        Err(message) => {
            *slot = Slot::Empty;
            control.clear_install();
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
    match resident.engine.feed(&samples) {
        Ok(text) => Response::Partial { text },
        Err(message) => Response::Error { message },
    }
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
    match resident.engine.finish() {
        Ok(text) => Response::Text { text },
        Err(message) => Response::Error { message },
    }
}

fn reset(slot: &mut Slot) -> Response {
    let Slot::Loaded(resident) = slot else {
        return not_loaded();
    };
    resident.engine.reset();
    Response::Ready
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
