use super::engine::EngineKind;
use super::protocol::{Request, Response};

pub(super) enum Follow {
    Clip,
    Load,
}

pub(super) struct Job {
    pub pcm: String,
    pub rate: u32,
    pub model: String,
    pub engine: EngineKind,
    pub follow: Follow,
}

pub(super) enum Phase<W> {
    Idle,
    Live(W),
}

enum Wait {
    Load {
        pcm: String,
        rate: u32,
        follow: Follow,
    },
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
    Recording(R),
    Finishing,
}

pub(super) enum Press<R> {
    Open,
    Busy(Mic<R>),
}

pub(super) enum Stop<R> {
    Begin(R),
    Idle,
}

pub(super) enum Cancelled<R> {
    Stopped(R),
    Pending,
    Idle,
}

pub(super) fn press<R>(mic: Mic<R>) -> Press<R> {
    match mic {
        Mic::Idle => Press::Open,
        other => Press::Busy(other),
    }
}

pub(super) fn cease<R>(mic: Mic<R>) -> (Mic<R>, Stop<R>) {
    match mic {
        Mic::Recording(recording) => (Mic::Finishing, Stop::Begin(recording)),
        Mic::Idle => (Mic::Idle, Stop::Idle),
        Mic::Finishing => (Mic::Finishing, Stop::Idle),
    }
}

pub(super) fn settle<R>(mic: Mic<R>) -> Mic<R> {
    match mic {
        Mic::Finishing => Mic::Idle,
        other => other,
    }
}

pub(super) struct ListenOutcome {
    pub transcript: Result<String, String>,
    pub feed: Result<(), String>,
    pub microphone: Option<String>,
    pub cancelled: bool,
}

pub(super) fn publish(outcome: ListenOutcome) -> Result<String, String> {
    if outcome.cancelled {
        return Err("listening cancelled".to_string());
    }
    if let Some(message) = outcome.microphone {
        return Err(message);
    }
    outcome.feed?;
    outcome.transcript
}

pub(super) fn cancel_mic<R>(mic: Mic<R>) -> (Mic<R>, Cancelled<R>) {
    match mic {
        Mic::Recording(recording) => (Mic::Idle, Cancelled::Stopped(recording)),
        Mic::Finishing => (Mic::Finishing, Cancelled::Pending),
        Mic::Idle => (Mic::Idle, Cancelled::Idle),
    }
}

fn begin<W>(phase: Phase<W>, job: Job) -> Drive<W> {
    match phase {
        Phase::Idle => Drive::Spawn { job },
        Phase::Live(worker) => match job.follow {
            Follow::Load => Drive::Done {
                phase: Phase::Live(worker),
                result: Ok(String::new()),
            },
            Follow::Clip => Drive::Send {
                request: Request::Transcribe {
                    rate: job.rate,
                    pcm: job.pcm,
                },
                worker,
                wait: Wait::Audio,
            },
        },
    }
}

fn spawned<W>(worker: W, job: Job) -> Drive<W> {
    let Job {
        pcm,
        rate,
        model,
        engine,
        follow,
    } = job;
    Drive::Send {
        request: Request::Load {
            model,
            engine: engine.name().to_string(),
        },
        worker,
        wait: Wait::Load { pcm, rate, follow },
    }
}

fn replied<W>(worker: W, wait: Wait, response: Response) -> Drive<W> {
    match (wait, response) {
        (
            Wait::Load {
                follow: Follow::Load,
                ..
            },
            Response::Ready,
        ) => Drive::Done {
            phase: Phase::Live(worker),
            result: Ok(String::new()),
        },
        (
            Wait::Load {
                pcm,
                rate,
                follow: Follow::Clip,
            },
            Response::Ready,
        ) => Drive::Send {
            request: Request::Transcribe { rate, pcm },
            worker,
            wait: Wait::Audio,
        },
        (Wait::Load { .. }, Response::Error { message }) => Drive::Done {
            phase: Phase::Idle,
            result: Err(message),
        },
        (Wait::Audio, Response::Text { text }) => Drive::Done {
            phase: Phase::Live(worker),
            result: Ok(text),
        },
        (Wait::Audio, Response::Error { message }) => Drive::Done {
            phase: Phase::Live(worker),
            result: Err(message),
        },
        (Wait::Load { .. }, Response::Text { .. } | Response::Partial { .. })
        | (Wait::Audio, Response::Ready | Response::Partial { .. }) => Drive::Done {
            phase: Phase::Idle,
            result: Err("speech worker broke the protocol".to_string()),
        },
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
