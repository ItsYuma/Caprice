use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::talk_keys;

const STRINGS: &[&str] = &[
    "modelUrl",
    "model",
    "modelApiKey",
    "modelProtocol",
    "modelRuntime",
    "modelExecutable",
    "modelDeadlineMs",
    "sttEngine",
    "sttModel",
    "sttUrl",
    "sttDeadlineMs",
    "ttsEngine",
    "ttsWoof",
    "ttsVoice",
    "ttsUrl",
    "ttsModel",
    "ttsApiKey",
    "ttsDeadlineMs",
    "python",
    "repo",
    "container",
    "modelDirectory",
    "sttModelId",
    "ttsModelId",
];

#[derive(Clone)]
struct LiveSpeech {
    stt_engine: String,
    stt_model: String,
    stt_url: String,
    tts_engine: String,
    tts_model: String,
    tts_url: String,
    tts_voice: String,
    tts_api_key: String,
    recording_mode: String,
    vad_sensitivity: u8,
    talk_chord: String,
}

static LIVE: Mutex<Option<LiveSpeech>> = Mutex::new(None);

#[tauri::command]
pub(crate) fn settings_get() -> Result<Value, String> {
    let stored = read_stored(&config_path())?;
    Ok(view(&stored))
}

#[tauri::command]
pub(crate) async fn settings_put(app: AppHandle, patch: Value) -> Result<Value, String> {
    let path = config_path();
    let saved = tauri::async_runtime::spawn_blocking(move || write_at(&path, &patch))
        .await
        .map_err(|err| err.to_string())??;
    publish_live(&saved);
    let _ = app.emit("caprice-settings", saved.clone());
    let accelerators = accelerators_for(chord_field(&saved))
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        talk_keys::apply_accelerators(&handle, &accelerators)
    })
    .await
    .map_err(|err| err.to_string())?;
    Ok(saved)
}

pub(crate) fn stt_engine() -> String {
    live_or_env(|live| live.stt_engine.clone(), "CAPRICE_STT_ENGINE")
}

pub(crate) fn stt_model() -> String {
    live_or_env(|live| live.stt_model.clone(), "CAPRICE_STT_MODEL")
}

pub(crate) fn stt_url() -> String {
    live_or_env(|live| live.stt_url.clone(), "CAPRICE_STT_URL")
}

pub(crate) fn tts_engine() -> String {
    live_or_env(|live| live.tts_engine.clone(), "CAPRICE_TTS_ENGINE")
}

pub(crate) fn tts_model() -> String {
    live_or_env(|live| live.tts_model.clone(), "CAPRICE_TTS_MODEL")
}

pub(crate) fn tts_url() -> String {
    live_or_env(|live| live.tts_url.clone(), "CAPRICE_TTS_URL")
}

pub(crate) fn tts_voice() -> String {
    live_or_env(|live| live.tts_voice.clone(), "CAPRICE_TTS_VOICE")
}

pub(crate) fn tts_api_key() -> String {
    live_or_env(|live| live.tts_api_key.clone(), "CAPRICE_TTS_API_KEY")
}

pub(crate) fn recording_mode() -> String {
    if let Some(live) = live_snapshot() {
        return live.recording_mode;
    }
    match read_stored(&config_path()) {
        Ok(value) => mode_field(&value).to_string(),
        Err(_) => "hold".to_string(),
    }
}

pub(crate) fn vad_sensitivity() -> u8 {
    if let Some(live) = live_snapshot() {
        return live.vad_sensitivity;
    }
    match read_stored(&config_path()) {
        Ok(value) => u8::try_from(sensitivity_field(&value)).unwrap_or(40),
        Err(_) => 40,
    }
}

pub(crate) fn allowed_talk_accelerators() -> Vec<&'static str> {
    let chord = if let Some(live) = live_snapshot() {
        live.talk_chord
    } else {
        match read_stored(&config_path()) {
            Ok(value) => chord_field(&value).to_string(),
            Err(_) => "both".to_string(),
        }
    };
    accelerators_for(&chord)
}

pub(crate) fn models_dir() -> PathBuf {
    data_dir().join("models")
}

fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

fn data_dir() -> PathBuf {
    let home = if std::env::consts::OS == "windows" {
        env_or_empty("USERPROFILE")
    } else {
        env_or_empty("HOME")
    };
    dir_for(
        std::env::consts::OS,
        &home,
        &env_or_empty("XDG_DATA_HOME"),
        &env_or_empty("LOCALAPPDATA"),
    )
}

fn dir_for(os: &str, home: &str, xdg: &str, local: &str) -> PathBuf {
    if os == "windows" {
        let base = if local.is_empty() {
            PathBuf::from(home).join("AppData").join("Local")
        } else {
            PathBuf::from(local)
        };
        return base.join("caprice");
    }
    if os == "macos" {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("caprice");
    }
    let base = if xdg.is_empty() {
        PathBuf::from(home).join(".local").join("share")
    } else {
        PathBuf::from(xdg)
    };
    base.join("caprice")
}

fn env_or_empty(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

fn live_or_env(pick: impl FnOnce(&LiveSpeech) -> String, name: &str) -> String {
    if let Some(live) = live_snapshot() {
        return pick(&live);
    }
    std::env::var(name).unwrap_or_default()
}

fn live_snapshot() -> Option<LiveSpeech> {
    lock(&LIVE).clone()
}

fn publish_live(saved: &Value) {
    *lock(&LIVE) = Some(LiveSpeech {
        stt_engine: string_field(saved, "sttEngine"),
        stt_model: string_field(saved, "sttModel"),
        stt_url: string_field(saved, "sttUrl"),
        tts_engine: string_field(saved, "ttsEngine"),
        tts_model: string_field(saved, "ttsModel"),
        tts_url: string_field(saved, "ttsUrl"),
        tts_voice: string_field(saved, "ttsVoice"),
        tts_api_key: string_field(saved, "ttsApiKey"),
        recording_mode: mode_field(saved).to_string(),
        vad_sensitivity: u8::try_from(sensitivity_field(saved)).unwrap_or(40),
        talk_chord: chord_field(saved).to_string(),
    });
}

fn write_at(path: &std::path::Path, patch: &Value) -> Result<Value, String> {
    let stored = read_stored(path)?;
    let saved = merge_settings(stored, patch)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&saved).map_err(|err| err.to_string())?;
    std::fs::write(path, format!("{text}\n")).map_err(|err| err.to_string())?;
    Ok(saved)
}

fn read_stored(path: &std::path::Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let text = std::fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value: Value =
        serde_json::from_str(&text).map_err(|_| "config.json could not be read".to_string())?;
    if !value.is_object() || !version_ok(&value) {
        return Err("config.json could not be read".to_string());
    }
    Ok(value)
}

fn merge_settings(stored: Value, patch: &Value) -> Result<Value, String> {
    if !version_ok(&stored) {
        return Err("config.json could not be read".to_string());
    }
    let patch_object = patch
        .as_object()
        .ok_or_else(|| "settings must be an object".to_string())?;
    for (key, value) in patch_object {
        if known(key) {
            validate_key(key, value)?;
        }
    }
    let mut root = match stored {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    for (key, value) in patch_object {
        if known(key) {
            root.insert(key.clone(), value.clone());
        }
    }
    Ok(view(&Value::Object(root)))
}

fn view(stored: &Value) -> Value {
    let mut out = Map::new();
    out.insert("version".to_string(), json!(1));
    for key in STRINGS {
        out.insert((*key).to_string(), json!(string_field(stored, key)));
    }
    out.insert("recordingMode".to_string(), json!(mode_field(stored)));
    out.insert("talkChord".to_string(), json!(chord_field(stored)));
    out.insert(
        "vadSensitivity".to_string(),
        json!(sensitivity_field(stored)),
    );
    out.insert("enabledGames".to_string(), json!(games_field(stored)));
    if let Some(map) = stored.as_object() {
        for (key, value) in map {
            if !out.contains_key(key) {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

fn known(key: &str) -> bool {
    if STRINGS.contains(&key) {
        return true;
    }
    matches!(
        key,
        "version" | "vadSensitivity" | "recordingMode" | "talkChord" | "enabledGames"
    )
}

fn validate_key(key: &str, value: &Value) -> Result<(), String> {
    match key {
        "version" => validate_version(value),
        "vadSensitivity" => validate_sensitivity(value),
        "enabledGames" => validate_games(value),
        "recordingMode" => validate_choice(value, &["hold", "vad"], "recordingMode is hold or vad"),
        "talkChord" => validate_choice(
            value,
            &["both", "alt-space", "ctrl-space"],
            "talkChord is both, alt-space, or ctrl-space",
        ),
        "sttEngine" => validate_stt(require_string(key, value)?),
        "ttsEngine" => validate_tts(require_string(key, value)?),
        _ => {
            if value.is_string() {
                Ok(())
            } else {
                Err(format!("{key} must be a string"))
            }
        }
    }
}

fn validate_version(value: &Value) -> Result<(), String> {
    if value.as_u64() == Some(1) {
        Ok(())
    } else {
        Err("version must be 1".to_string())
    }
}

fn validate_sensitivity(value: &Value) -> Result<(), String> {
    let Some(number) = value.as_f64() else {
        return Err("vadSensitivity is 0 through 100".to_string());
    };
    if !number.is_finite() || number < 0.0 || number > 100.0 || number.fract() != 0.0 {
        return Err("vadSensitivity is 0 through 100".to_string());
    }
    Ok(())
}

fn validate_games(value: &Value) -> Result<(), String> {
    let Some(items) = value.as_array() else {
        return Err("enabledGames must be a list of strings".to_string());
    };
    for item in items {
        if !item.is_string() {
            return Err("enabledGames must be a list of strings".to_string());
        }
    }
    Ok(())
}

fn validate_choice(value: &Value, allowed: &[&str], message: &str) -> Result<(), String> {
    let Some(text) = value.as_str() else {
        return Err(message.to_string());
    };
    if allowed.contains(&text) {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn validate_stt(text: &str) -> Result<(), String> {
    match text {
        "" | "parakeet" | "http" => Ok(()),
        "bark" | "bark-stream" | "onnx" => Err(format!("{text} is retired. Use parakeet or http.")),
        other => Err(format!("unknown speech engine: {other}")),
    }
}

fn validate_tts(text: &str) -> Result<(), String> {
    match text {
        "" | "http" | "piper" | "kokoro" => Ok(()),
        "woof" => Err("woof is retired. Use http.".to_string()),
        other => Err(format!("unknown reply engine: {other}")),
    }
}

fn require_string<'a>(key: &str, value: &'a Value) -> Result<&'a str, String> {
    value
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))
}

fn version_ok(value: &Value) -> bool {
    match value.get("version") {
        None => true,
        Some(Value::Number(number)) => number.as_u64() == Some(1),
        _ => false,
    }
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string()
}

fn mode_field(value: &Value) -> &'static str {
    match value.get("recordingMode").and_then(|item| item.as_str()) {
        Some("vad") => "vad",
        _ => "hold",
    }
}

fn chord_field(value: &Value) -> &'static str {
    match value.get("talkChord").and_then(|item| item.as_str()) {
        Some("alt-space") => "alt-space",
        Some("ctrl-space") => "ctrl-space",
        _ => "both",
    }
}

fn sensitivity_field(value: &Value) -> u64 {
    let Some(number) = value.get("vadSensitivity").and_then(|item| item.as_u64()) else {
        return 40;
    };
    if number > 100 {
        40
    } else {
        number
    }
}

fn games_field(value: &Value) -> Vec<String> {
    let Some(items) = value.get("enabledGames").and_then(|item| item.as_array()) else {
        return Vec::new();
    };
    let mut games = Vec::new();
    for item in items {
        let Some(text) = item.as_str() else {
            return Vec::new();
        };
        games.push(text.to_string());
    }
    games
}

fn accelerators_for(chord: &str) -> Vec<&'static str> {
    match chord {
        "alt-space" => vec!["Alt+Space"],
        "ctrl-space" => vec!["Ctrl+Space"],
        _ => vec!["Alt+Space", "Ctrl+Space"],
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
#[path = "settings_test.rs"]
mod tests;
