use super::super::engine::EngineKind;
use super::super::protocol::{Request, Response};
use super::{
    begin, cancel_mic, cease, drive, press, publish, settle, Cancelled, Follow, Job, ListenOutcome,
    Mic, Phase, Press, Stop,
};

struct Token(u8);

fn job(pcm: &str) -> Job {
    Job {
        pcm: pcm.to_string(),
        rate: 16_000,
        model: "/models/speech".into(),
        engine: EngineKind::Onnx,
        follow: Follow::Clip,
    }
}

#[test]
fn an_idle_worker_loads_once_and_then_stays_live() {
    let mut spawns = 0;
    let (phase, result) = drive(
        Phase::Idle,
        job("pcm-a"),
        || {
            spawns += 1;
            Ok(Token(1))
        },
        |worker, request| match request {
            Request::Load { engine, .. } => {
                assert_eq!(engine, "onnx");
                Ok((worker, Response::Ready))
            }
            Request::Transcribe { pcm, rate } => {
                assert_eq!(pcm, "pcm-a");
                assert_eq!(rate, 16_000);
                Ok((
                    worker,
                    Response::Text {
                        text: "heard".into(),
                    },
                ))
            }
            Request::Feed { .. } | Request::Finish | Request::Reset | Request::Cancel => {
                panic!("streamed")
            }
        },
    );

    assert_eq!(spawns, 1);
    assert_eq!(result.unwrap(), "heard");
    let Phase::Live(worker) = phase else {
        panic!("worker dropped");
    };

    let mut spawns = 0;
    let (phase, result) = drive(
        Phase::Live(worker),
        job("pcm-b"),
        || {
            spawns += 1;
            Ok(Token(2))
        },
        |worker, request| match request {
            Request::Transcribe { pcm, .. } => {
                assert_eq!(pcm, "pcm-b");
                Ok((
                    worker,
                    Response::Text {
                        text: "again".into(),
                    },
                ))
            }
            Request::Load { .. }
            | Request::Feed { .. }
            | Request::Finish
            | Request::Reset
            | Request::Cancel => {
                panic!("reloaded")
            }
        },
    );

    assert_eq!(spawns, 0);
    assert_eq!(result.unwrap(), "again");
    assert!(matches!(phase, Phase::Live(_)));
}

#[test]
fn a_failed_load_drops_the_worker_and_a_failed_clip_keeps_it() {
    let (phase, result) = drive(
        Phase::<Token>::Idle,
        job("pcm"),
        || Ok(Token(1)),
        |worker, request| match request {
            Request::Load { .. } => Ok((
                worker,
                Response::Error {
                    message: "missing weights".into(),
                },
            )),
            Request::Transcribe { .. }
            | Request::Feed { .. }
            | Request::Finish
            | Request::Reset
            | Request::Cancel => {
                panic!("transcribed after a failed load")
            }
        },
    );
    assert!(matches!(phase, Phase::Idle));
    assert_eq!(result.unwrap_err(), "missing weights");

    let (phase, result) = drive(
        Phase::Live(Token(7)),
        job("pcm"),
        || panic!("spawned"),
        |worker, _request| {
            Ok((
                worker,
                Response::Error {
                    message: "empty clip".into(),
                },
            ))
        },
    );
    assert!(matches!(phase, Phase::Live(Token(7))));
    assert_eq!(result.unwrap_err(), "empty clip");
}

#[test]
fn a_broken_pipe_returns_to_idle() {
    let (phase, result) = drive(
        Phase::Live(Token(3)),
        job("pcm"),
        || panic!("spawned"),
        |_worker, _request| Err("speech worker closed".into()),
    );
    assert!(matches!(phase, Phase::Idle));
    assert_eq!(result.unwrap_err(), "speech worker closed");
}

#[test]
fn the_microphone_is_idle_recording_or_finishing() {
    assert!(matches!(press(Mic::<Token>::Idle), Press::Open));
    assert!(matches!(
        press(Mic::Recording(Token(1))),
        Press::Busy(Mic::Recording(Token(1)))
    ));
    assert!(matches!(
        press(Mic::<Token>::Finishing),
        Press::Busy(Mic::Finishing)
    ));

    let (mic, stopped) = cease(Mic::Recording(Token(4)));
    assert!(matches!(mic, Mic::Finishing));
    assert!(matches!(stopped, Stop::Begin(Token(4))));
    let (mic, stopped) = cease::<Token>(mic);
    assert!(matches!(mic, Mic::Finishing));
    assert!(matches!(stopped, Stop::Idle));
    assert!(matches!(cease::<Token>(Mic::Idle).1, Stop::Idle));
    assert!(matches!(settle::<Token>(Mic::Finishing), Mic::Idle));
    assert!(matches!(
        settle(Mic::Recording(Token(3))),
        Mic::Recording(Token(3))
    ));

    let (mic, cancelled) = cancel_mic(Mic::Recording(Token(8)));
    assert!(matches!(mic, Mic::Idle));
    assert!(matches!(cancelled, Cancelled::Stopped(Token(8))));
    assert!(matches!(
        cancel_mic::<Token>(Mic::Finishing).1,
        Cancelled::Pending
    ));
    assert!(matches!(cancel_mic::<Token>(Mic::Idle).1, Cancelled::Idle));
}

#[test]
fn begin_on_a_live_worker_does_not_spawn() {
    let step = begin(Phase::Live(Token(9)), job("pcm"));
    assert!(matches!(step, super::Drive::Send { .. }));
}

#[test]
fn loading_stops_when_the_worker_is_ready() {
    let mut loading = job("");
    loading.follow = Follow::Load;
    let (phase, result) = drive(
        Phase::Idle,
        loading,
        || Ok(Token(1)),
        |worker, request| match request {
            Request::Load { engine, .. } => {
                assert_eq!(engine, "onnx");
                Ok((worker, Response::Ready))
            }
            Request::Transcribe { .. }
            | Request::Feed { .. }
            | Request::Finish
            | Request::Reset
            | Request::Cancel => {
                panic!("followed the load")
            }
        },
    );
    assert_eq!(result.unwrap(), "");
    assert!(matches!(phase, Phase::Live(Token(1))));

    let mut again = job("");
    again.follow = Follow::Load;
    let (phase, result) = drive(
        phase,
        again,
        || panic!("spawned"),
        |_worker, _request| panic!("sent"),
    );
    assert_eq!(result.unwrap(), "");
    assert!(matches!(phase, Phase::Live(Token(1))));
}

#[test]
fn an_error_discards_a_transcript() {
    let heard = publish(ListenOutcome {
        transcript: Ok("hello".to_string()),
        feed: Ok(()),
        microphone: None,
        cancelled: false,
    });
    assert_eq!(heard.unwrap(), "hello");

    let cancelled = publish(ListenOutcome {
        transcript: Ok("hello".to_string()),
        feed: Ok(()),
        microphone: None,
        cancelled: true,
    });
    assert_eq!(cancelled.unwrap_err(), "listening cancelled");

    let failed = publish(ListenOutcome {
        transcript: Ok("hello".to_string()),
        feed: Err("feed failed".to_string()),
        microphone: Some("microphone closed".to_string()),
        cancelled: false,
    });
    assert_eq!(failed.unwrap_err(), "microphone closed");

    let fed = publish(ListenOutcome {
        transcript: Ok("hello".to_string()),
        feed: Err("feed failed".to_string()),
        microphone: None,
        cancelled: false,
    });
    assert_eq!(fed.unwrap_err(), "feed failed");
}

#[test]
fn a_partial_during_a_clip_drops_the_worker() {
    let (phase, result) = drive(
        Phase::Live(Token(1)),
        job("pcm"),
        || panic!("spawned"),
        |worker, _request| Ok((worker, Response::Partial { text: "no".into() })),
    );
    assert!(matches!(phase, Phase::Idle));
    assert_eq!(result.unwrap_err(), "speech worker broke the protocol");
}
