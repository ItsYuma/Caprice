use std::fs;

use super::{Engine, EngineKind};

#[test]
fn engine_kind_names_the_loader() {
    assert_eq!(EngineKind::parse("").unwrap(), EngineKind::Bark);
    assert_eq!(EngineKind::parse("").unwrap().name(), "bark");
    assert_eq!(EngineKind::parse(" onnx ").unwrap().name(), "onnx");
    assert_eq!(EngineKind::parse(" bark ").unwrap().name(), "bark");
    assert_eq!(
        EngineKind::parse(" bark-stream ").unwrap().name(),
        "bark-stream"
    );
    assert_eq!(EngineKind::parse(" parakeet ").unwrap().name(), "parakeet");
    assert!(!EngineKind::Onnx.streams());
    assert!(!EngineKind::Bark.streams());
    assert!(EngineKind::BarkStream.streams());
    assert!(EngineKind::Parakeet.streams());
    assert_eq!(
        EngineKind::parse("whisper").unwrap_err(),
        "unknown speech engine: whisper"
    );
    assert_eq!(
        EngineKind::parse("woof").unwrap_err(),
        "unknown speech engine: woof"
    );
    assert_eq!(
        EngineKind::parse("bark_stream").unwrap_err(),
        "unknown speech engine: bark_stream"
    );
}

#[test]
fn bark_stream_uses_the_bark_checkpoint() {
    let dir = std::env::temp_dir().join(format!("caprice-bark-stream-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir(&dir).unwrap();
    let missing = match Engine::load(EngineKind::BarkStream, &dir) {
        Err(message) => message,
        Ok(_) => panic!("loaded a directory with no checkpoint"),
    };
    assert_eq!(missing, "bark model is missing config.json");
    fs::remove_dir_all(&dir).unwrap();
}
