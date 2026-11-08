use super::EngineKind;

#[test]
fn engine_kind_names_the_loader() {
    assert_eq!(EngineKind::parse("").unwrap(), EngineKind::Onnx);
    assert_eq!(EngineKind::parse(" onnx ").unwrap().name(), "onnx");
    assert_eq!(EngineKind::parse(" bark ").unwrap().name(), "bark");
    assert_eq!(
        EngineKind::parse("whisper").unwrap_err(),
        "unknown speech engine: whisper"
    );
}
