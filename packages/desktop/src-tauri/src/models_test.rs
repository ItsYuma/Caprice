use super::{list_models, ModelEntry};

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("caprice-models-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn discovery_names_loadable_parakeet_and_leaves_the_rest() {
    let root = scratch("list");
    std::fs::write(root.join("parakeet-unified-en.gguf"), b"parakeet").unwrap();
    std::fs::write(root.join("other-model.gguf"), b"gguf").unwrap();
    std::fs::write(root.join("readme.txt"), b"skip").unwrap();
    let bark = root.join("underdog-bark");
    std::fs::create_dir(&bark).unwrap();
    std::fs::write(bark.join("config.json"), b"{}").unwrap();
    std::fs::write(bark.join("tokenizer.json"), b"{}").unwrap();
    std::fs::write(bark.join("model.safetensors"), b"weights").unwrap();
    let onnx = root.join("onnx-speech");
    std::fs::create_dir(&onnx).unwrap();
    std::fs::write(onnx.join("encoder.int8.onnx"), b"enc").unwrap();
    std::fs::write(onnx.join("decoder.onnx"), b"dec").unwrap();
    std::fs::write(onnx.join("vocab.txt"), b"vocab").unwrap();
    let piper = root.join("piper");
    std::fs::create_dir(&piper).unwrap();
    std::fs::write(piper.join("en_US-lessac.onnx"), b"piper-voice").unwrap();
    std::fs::write(root.join("kokoro-fast.onnx"), b"koko").unwrap();
    std::fs::write(root.join("stray.onnx"), b"stray").unwrap();

    let listed = list_models(&root).unwrap();
    let parakeet = find(&listed, "parakeet-unified-en.gguf");
    assert_eq!(parakeet.family, "parakeet");
    assert!(parakeet.loadable);
    assert_eq!(parakeet.role, "stt");
    assert_eq!(parakeet.languages, vec!["en".to_string()]);
    assert_eq!(parakeet.bytes, b"parakeet".len() as u64);
    assert_eq!(parakeet.note, "Parakeet GGUF that this window can load.");

    let other = find(&listed, "other-model.gguf");
    assert_eq!(other.family, "gguf");
    assert!(!other.loadable);
    assert_eq!(other.role, "stt");

    let bark_entry = find(&listed, "underdog-bark");
    assert_eq!(bark_entry.family, "bark");
    assert!(!bark_entry.loadable);
    assert_eq!(bark_entry.role, "stt");
    assert!(bark_entry.bytes >= b"weights".len() as u64);

    let onnx_entry = find(&listed, "onnx-speech");
    assert_eq!(onnx_entry.family, "onnx");
    assert!(!onnx_entry.loadable);

    let piper_entry = find(&listed, "piper/en_US-lessac.onnx");
    assert_eq!(piper_entry.family, "piper");
    assert_eq!(piper_entry.role, "tts");
    assert!(!piper_entry.loadable);
    assert_eq!(piper_entry.languages, vec!["en".to_string()]);
    assert_eq!(piper_entry.note, "Piper voice is not loaded yet.");

    let kokoro = find(&listed, "kokoro-fast.onnx");
    assert_eq!(kokoro.family, "kokoro");
    assert_eq!(kokoro.role, "tts");
    assert_eq!(kokoro.note, "Kokoro voice is not loaded yet, marked fast.");

    let stray = find(&listed, "stray.onnx");
    assert_eq!(stray.family, "other");
    assert_eq!(stray.role, "stt");
    assert!(listed.iter().all(|entry| entry.id != "readme.txt"));
    assert!(listed.iter().all(|entry| !entry.id.ends_with("vocab.txt")));

    let missing = root.join("nope");
    assert_eq!(
        list_models(&missing).unwrap_err(),
        "model directory is missing"
    );
    assert_eq!(
        list_models(&root.join("stray.onnx")).unwrap_err(),
        "model directory is not a directory"
    );
    let _ = std::fs::remove_dir_all(&root);
}

fn find<'a>(entries: &'a [ModelEntry], id: &str) -> &'a ModelEntry {
    entries.iter().find(|entry| entry.id == id).expect(id)
}
