use super::test_support::{env_lock, EnvGuard};
use super::{speech_listen_stop, speech_transcribe, SpeechState};

#[test]
fn missing_stt_model() {
    let _lock = env_lock();
    let _model = EnvGuard::set("CAPRICE_STT_MODEL", None);
    let state = SpeechState::new();
    assert_eq!(
        speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
        "CAPRICE_STT_MODEL is not set"
    );
    assert_eq!(
        speech_listen_stop(&state).unwrap_err(),
        "CAPRICE_STT_MODEL is not set"
    );
}

#[test]
fn blank_stt_model_is_missing() {
    let _lock = env_lock();
    let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some("   "));
    let state = SpeechState::new();
    assert_eq!(
        speech_transcribe(&state, "/tmp/clip.wav".into()).unwrap_err(),
        "CAPRICE_STT_MODEL is not set"
    );
}

#[test]
fn listen_stop_when_idle() {
    let _lock = env_lock();
    let _model = EnvGuard::set("CAPRICE_STT_MODEL", Some("/tmp/caprice-parakeet"));
    let state = SpeechState::new();
    assert_eq!(speech_listen_stop(&state).unwrap_err(), "not listening");
}
