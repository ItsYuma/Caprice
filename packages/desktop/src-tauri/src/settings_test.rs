use std::path::PathBuf;

use serde_json::json;

use super::{accelerators_for, dir_for, merge_settings, read_stored, view, write_at};

#[test]
fn a_patch_keeps_installer_fields_and_defaults_the_new_ones() {
    let stored = json!({
        "version": 1,
        "container": "caprice",
        "repo": "/work/caprice",
        "modelDeadlineMs": "1500",
        "ttsWoof": "/old/tts",
        "extra": true
    });
    let saved = merge_settings(stored, &json!({"modelUrl": "http://brain.example/v1"})).unwrap();
    assert_eq!(saved["container"], "caprice");
    assert_eq!(saved["repo"], "/work/caprice");
    assert_eq!(saved["modelDeadlineMs"], "1500");
    assert_eq!(saved["ttsWoof"], "/old/tts");
    assert_eq!(saved["extra"], true);
    assert_eq!(saved["modelUrl"], "http://brain.example/v1");
    assert_eq!(saved["recordingMode"], "hold");
    assert_eq!(saved["vadSensitivity"], 40);
    assert_eq!(saved["talkChord"], "both");
    assert_eq!(saved["enabledGames"], json!([]));
    assert_eq!(saved["sttModelId"], "");
    assert_eq!(saved["ttsModelId"], "");
    assert_eq!(saved["version"], 1);
}

#[test]
fn retired_engines_are_rejected_and_ranges_are_checked() {
    let stored = json!({});
    assert_eq!(
        merge_settings(stored.clone(), &json!({"sttEngine": "bark"})).unwrap_err(),
        "bark is retired. Use parakeet or http."
    );
    assert_eq!(
        merge_settings(stored.clone(), &json!({"sttEngine": "bark-stream"})).unwrap_err(),
        "bark-stream is retired. Use parakeet or http."
    );
    assert_eq!(
        merge_settings(stored.clone(), &json!({"sttEngine": "onnx"})).unwrap_err(),
        "onnx is retired. Use parakeet or http."
    );
    assert_eq!(
        merge_settings(stored.clone(), &json!({"ttsEngine": "woof"})).unwrap_err(),
        "woof is retired. Use http."
    );
    assert!(merge_settings(stored.clone(), &json!({"ttsEngine": "piper"})).is_ok());
    assert!(merge_settings(stored.clone(), &json!({"ttsEngine": "kokoro"})).is_ok());
    let chosen = merge_settings(
        stored.clone(),
        &json!({
            "recordingMode": "vad",
            "vadSensitivity": 0,
            "talkChord": "alt-space",
            "enabledGames": ["league"]
        }),
    )
    .unwrap();
    assert_eq!(chosen["recordingMode"], "vad");
    assert_eq!(chosen["vadSensitivity"], 0);
    assert_eq!(chosen["talkChord"], "alt-space");
    assert_eq!(chosen["enabledGames"], json!(["league"]));
    assert_eq!(
        merge_settings(stored.clone(), &json!({"vadSensitivity": 101})).unwrap_err(),
        "vadSensitivity is 0 through 100"
    );
    assert_eq!(
        merge_settings(stored.clone(), &json!({"recordingMode": "push"})).unwrap_err(),
        "recordingMode is hold or vad"
    );
    assert_eq!(
        merge_settings(stored, &json!("nope")).unwrap_err(),
        "settings must be an object"
    );
}

#[test]
fn a_missing_file_view_uses_defaults() {
    let viewed = view(&json!({}));
    assert_eq!(viewed["recordingMode"], "hold");
    assert_eq!(viewed["vadSensitivity"], 40);
    assert_eq!(viewed["talkChord"], "both");
    assert_eq!(viewed["enabledGames"], json!([]));
    assert_eq!(viewed["modelUrl"], "");
}

#[test]
fn directories_follow_the_platform() {
    assert_eq!(
        dir_for("windows", "C:\\Users\\ada", "", "D:\\AppData\\Local"),
        PathBuf::from("D:\\AppData\\Local").join("caprice")
    );
    assert_eq!(
        dir_for("windows", "C:\\Users\\ada", "", ""),
        PathBuf::from("C:\\Users\\ada")
            .join("AppData")
            .join("Local")
            .join("caprice")
    );
    assert_eq!(
        dir_for("linux", "/home/ada", "", ""),
        PathBuf::from("/home/ada/.local/share/caprice")
    );
    assert_eq!(
        dir_for("linux", "/home/ada", "/var/data", ""),
        PathBuf::from("/var/data/caprice")
    );
    assert_eq!(
        dir_for("macos", "/Users/ada", "", ""),
        PathBuf::from("/Users/ada/Library/Application Support/caprice")
    );
}

#[test]
fn accelerators_follow_the_chord() {
    assert_eq!(accelerators_for("both"), vec!["Alt+Space", "Ctrl+Space"]);
    assert_eq!(accelerators_for("alt-space"), vec!["Alt+Space"]);
    assert_eq!(accelerators_for("ctrl-space"), vec!["Ctrl+Space"]);
    assert_eq!(accelerators_for("nope"), vec!["Alt+Space", "Ctrl+Space"]);
}

#[test]
fn write_keeps_container_and_rejects_a_bad_version() {
    let dir = std::env::temp_dir().join(format!("caprice-settings-{}-write", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("config.json");
    std::fs::write(
        &path,
        "{\"version\":1,\"container\":\"caprice\",\"repo\":\"/work\"}\n",
    )
    .unwrap();
    let saved = write_at(
        &path,
        &json!({
            "model": "local",
            "recordingMode": "vad",
            "vadSensitivity": 15,
            "talkChord": "ctrl-space",
            "enabledGames": ["league"]
        }),
    )
    .unwrap();
    assert_eq!(saved["container"], "caprice");
    assert_eq!(saved["repo"], "/work");
    assert_eq!(saved["recordingMode"], "vad");
    let again = read_stored(&path).unwrap();
    assert_eq!(again["container"], "caprice");
    assert_eq!(again["vadSensitivity"], 15);
    assert_eq!(again["talkChord"], "ctrl-space");

    let missing = dir.join("missing.json");
    assert!(read_stored(&missing)
        .unwrap()
        .as_object()
        .unwrap()
        .is_empty());
    std::fs::write(&path, "{\"version\":2}\n").unwrap();
    assert_eq!(
        read_stored(&path).unwrap_err(),
        "config.json could not be read"
    );
    std::fs::write(&path, "[]\n").unwrap();
    assert_eq!(
        read_stored(&path).unwrap_err(),
        "config.json could not be read"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
