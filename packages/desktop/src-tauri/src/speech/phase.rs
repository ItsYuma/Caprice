use super::engine::EngineKind;
use super::protocol::{Request, Response};

pub(super) struct Job {
    pub pcm: String,
    pub rate: u32,
    pub model: String,
    pub engine: EngineKind,
}

pub(super) enum Phase<W> {
    Idle,
    Live(W),
}

enum Wait {
    Load { pcm: String, rate: u32 },
    Audio,
}

enum Drive<W> {
    Spawn {
        job: Job,
    },
    Send {
        worker: W,
        request: Request,
        wait: Wait,
    },
    Done {
        phase: Phase<W>,
        result: Result<String, String>,
    },
}

pub(super) enum Mic<R> {
    Idle,
    Hot(R),
}

pub(super) enum Press<R> {
    Open,
    Busy(R),
}

pub(super) enum Released<R> {
    Captured(R),
    Idle,
}

pub(super) fn press<R>(mic: Mic<R>) -> Press<R> {
    match mic {
        Mic::Idle => Press::Open,
        Mic::Hot(recording) => Press::Busy(recording),
    }
}

pub(super) fn release<R>(mic: Mic<R>) -> Released<R> {
    match mic {
        Mic::Hot(recording) => Released::Captured(recording),
        Mic::Idle => Released::Idle,
    }
}

fn begin<W>(phase: Phase<W>, job: Job) -> Drive<W> {
    match phase {
        Phase::Idle => Drive::Spawn { job },
        Phase::Live(worker) => Drive::Send {
            request: Request::Transcribe {
                rate: job.rate,
                pcm: job.pcm,
            },
            worker,
            wait: Wait::Audio,
        },
    }
}

fn spawned<W>(worker: W, job: Job) -> Drive<W> {
    let Job {
        pcm,
        rate,
        model,
        engine,
    } = job;
    Drive::Send {
        request: Request::Load {
            model,
            engine: engine.name().to_string(),
        },
        worker,
        wait: Wait::Load { pcm, rate },
    }
}

fn replied<W>(worker: W, wait: Wait, response: Response) -> Drive<W> {
    match (wait, response) {
        (Wait::Load { pcm, rate }, Response::Ready) => Drive::Send {
            request: Request::Transcribe { rate, pcm },
            worker,
            wait: Wait::Audio,
        },
        (Wait::Load { .. }, Response::Error { message }) => Drive::Done {
            phase: Phase::Idle,
            result: Err(message),
        },
        (Wait::Load { .. }, Response::Text { .. }) => Drive::Done {
            phase: Phase::Idle,
            result: Err("speech worker broke the protocol".to_string()),
        },
        (Wait::Audio, Response::Text { text }) => Drive::Done {
            phase: Phase::Live(worker),
            result: Ok(text),
        },
        (Wait::Audio, Response::Error { message }) => Drive::Done {
            phase: Phase::Live(worker),
            result: Err(message),
        },
        (Wait::Audio, Response::Ready) => Drive::Done {
            phase: Phase::Idle,
            result: Err("speech worker broke the protocol".to_string()),
        },
        (Wait::Load { .. }, Response::Partial { .. }) | (Wait::Audio, Response::Partial { .. }) => {
            Drive::Done {
                phase: Phase::Idle,
                result: Err("speech worker broke the protocol".to_string()),
            }
        }
    }
}

pub(super) enum StreamAnswer {
    Text(String),
    Failed(String),
    Broke,
}

pub(super) fn partial_reply(response: Response) -> StreamAnswer {
    match response {
        Response::Partial { text } => StreamAnswer::Text(text),
        Response::Error { message } => StreamAnswer::Failed(message),
        Response::Ready | Response::Text { .. } => StreamAnswer::Broke,
    }
}

pub(super) fn final_reply(response: Response) -> StreamAnswer {
    match response {
        Response::Text { text } => StreamAnswer::Text(text),
        Response::Error { message } => StreamAnswer::Failed(message),
        Response::Ready | Response::Partial { .. } => StreamAnswer::Broke,
    }
}

pub(super) fn warm<W>(
    phase: Phase<W>,
    model: String,
    engine: EngineKind,
    mut spawn: impl FnMut() -> Result<W, String>,
    mut roundtrip: impl FnMut(W, Request) -> Result<(W, Response), String>,
) -> (Phase<W>, Result<(), String>) {
    let Phase::Idle = phase else {
        return (phase, Ok(()));
    };
    let worker = match spawn() {
        Ok(worker) => worker,
        Err(message) => return (Phase::Idle, Err(message)),
    };
    match roundtrip(
        worker,
        Request::Load {
            model,
            engine: engine.name().to_string(),
        },
    ) {
        Ok((worker, Response::Ready)) => (Phase::Live(worker), Ok(())),
        Ok((_, Response::Error { message })) => (Phase::Idle, Err(message)),
        Ok(_) => (
            Phase::Idle,
            Err("speech worker broke the protocol".to_string()),
        ),
        Err(message) => (Phase::Idle, Err(message)),
    }
}

fn lost<W>(message: String) -> Drive<W> {
    Drive::Done {
        phase: Phase::Idle,
        result: Err(message),
    }
}

pub(super) fn drive<W>(
    phase: Phase<W>,
    job: Job,
    mut spawn: impl FnMut() -> Result<W, String>,
    mut roundtrip: impl FnMut(W, Request) -> Result<(W, Response), String>,
) -> (Phase<W>, Result<String, String>) {
    let mut step = begin(phase, job);
    loop {
        step = match step {
            Drive::Spawn { job } => match spawn() {
                Ok(worker) => spawned(worker, job),
                Err(message) => lost(message),
            },
            Drive::Send {
                worker,
                request,
                wait,
            } => match roundtrip(worker, request) {
                Ok((worker, response)) => replied(worker, wait, response),
                Err(message) => lost(message),
            },
            Drive::Done { phase, result } => return (phase, result),
        };
    }
}

#[cfg(test)]
#[path = "phase_test.rs"]
mod tests;
