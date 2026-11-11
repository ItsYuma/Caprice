use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ModelEntry {
    pub id: String,
    pub family: String,
    pub path: String,
    pub bytes: u64,
    pub languages: Vec<String>,
    pub note: String,
    pub loadable: bool,
    pub streaming: bool,
    pub role: String,
}

#[tauri::command]
pub(crate) fn models_list(directory: String) -> Result<Vec<ModelEntry>, String> {
    let path = if directory.trim().is_empty() {
        let dir = crate::settings::models_dir();
        std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
        dir
    } else {
        PathBuf::from(directory.trim())
    };
    list_models(&path)
}

pub(crate) fn list_models(directory: &Path) -> Result<Vec<ModelEntry>, String> {
    if !directory.exists() {
        return Err("model directory is missing".to_string());
    }
    if !directory.is_dir() {
        return Err("model directory is not a directory".to_string());
    }
    let mut entries = Vec::new();
    walk(directory, directory, &mut entries)?;
    entries.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(entries)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<ModelEntry>) -> Result<(), String> {
    if is_bark(dir) {
        out.push(directory_entry(
            root,
            dir,
            "bark",
            "Bark checkpoint that this window does not load",
        ));
        return Ok(());
    }
    if is_onnx_layout(dir) {
        out.push(directory_entry(
            root,
            dir,
            "onnx",
            "ONNX encoder and decoder that this window does not load",
        ));
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|err| err.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let kind = entry.file_type().map_err(|err| err.to_string())?;
        let path = entry.path();
        if kind.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        if kind.is_file() {
            if let Some(found) = file_entry(root, &path) {
                out.push(found);
            }
        }
    }
    Ok(())
}

fn directory_entry(root: &Path, dir: &Path, family: &str, base: &str) -> ModelEntry {
    let id = relative_id(root, dir);
    ModelEntry {
        languages: languages(&id),
        note: describe(base, &id),
        bytes: tree_bytes(dir),
        id,
        family: family.to_string(),
        path: dir.to_string_lossy().to_string(),
        loadable: false,
        streaming: false,
        role: "stt".to_string(),
    }
}

fn file_entry(root: &Path, path: &Path) -> Option<ModelEntry> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with('.') {
        return None;
    }
    let id = relative_id(root, path);
    let lower = name.to_ascii_lowercase();
    let id_lower = id.to_ascii_lowercase();
    let bytes = file_bytes(path);
    let path_text = path.to_string_lossy().to_string();
    if lower.ends_with(".gguf") {
        let parakeet = lower.contains("parakeet");
        let (family, base, streaming) = if parakeet {
            (
                "parakeet",
                "Parakeet GGUF that this window streams while the key is held",
                true,
            )
        } else {
            ("gguf", "GGUF file that this window does not load", false)
        };
        return Some(ModelEntry {
            languages: languages(&id),
            note: describe(base, &id),
            bytes,
            id,
            family: family.to_string(),
            path: path_text,
            loadable: parakeet,
            streaming,
            role: "stt".to_string(),
        });
    }
    if id_lower.contains("piper") {
        return Some(voice_file(
            id,
            path_text,
            bytes,
            "piper",
            "Piper voice is not loaded yet",
        ));
    }
    if id_lower.contains("kokoro") {
        return Some(voice_file(
            id,
            path_text,
            bytes,
            "kokoro",
            "Kokoro voice is not loaded yet",
        ));
    }
    if lower.ends_with(".onnx") {
        return Some(ModelEntry {
            languages: languages(&id),
            note: describe("Unrecognized ONNX file", &id),
            bytes,
            id,
            family: "other".to_string(),
            path: path_text,
            loadable: false,
            streaming: false,
            role: "stt".to_string(),
        });
    }
    None
}

fn voice_file(id: String, path: String, bytes: u64, family: &str, base: &str) -> ModelEntry {
    ModelEntry {
        languages: languages(&id),
        note: describe(base, &id),
        bytes,
        id,
        family: family.to_string(),
        path,
        loadable: false,
        streaming: false,
        role: "tts".to_string(),
    }
}

fn describe(base: &str, name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    if has_token(&lower, "fast") {
        format!("{base}, marked fast.")
    } else if lower.contains("low-latency") || lower.contains("low_latency") {
        format!("{base}, marked low-latency.")
    } else {
        format!("{base}.")
    }
}

fn languages(name: &str) -> Vec<String> {
    const CODES: &[&str] = &[
        "en", "de", "es", "fr", "it", "pt", "nl", "pl", "ru", "ja", "zh", "ko",
    ];
    let mut found = Vec::new();
    for token in tokens(name) {
        let code = if token == "english" {
            "en"
        } else if CODES.contains(&token.as_str()) {
            token.as_str()
        } else {
            ""
        };
        if !code.is_empty() && !found.iter().any(|item| item == code) {
            found.push(code.to_string());
        }
    }
    found
}

fn has_token(name: &str, word: &str) -> bool {
    tokens(name).iter().any(|token| token == word)
}

fn tokens(name: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut token = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            token.push(ch.to_ascii_lowercase());
        } else if !token.is_empty() {
            found.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        found.push(token);
    }
    found
}

fn relative_id(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let text = rel.to_string_lossy().replace('\\', "/");
    if text.is_empty() {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("model")
            .to_string()
    } else {
        text
    }
}

fn file_bytes(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn tree_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(child);
            } else if kind.is_file() {
                total = total.saturating_add(file_bytes(&child));
            }
        }
    }
    total
}

fn is_bark(dir: &Path) -> bool {
    let mut config = false;
    let mut tokenizer = false;
    let mut weights = false;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let owned = entry.file_name();
        let Some(name) = owned.to_str() else {
            continue;
        };
        match name.to_ascii_lowercase().as_str() {
            "config.json" => config = true,
            "tokenizer.json" => tokenizer = true,
            "model.safetensors" => weights = true,
            _ => {}
        }
    }
    config && tokenizer && weights
}

fn is_onnx_layout(dir: &Path) -> bool {
    let mut encoder = false;
    let mut decoder = false;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let owned = entry.file_name();
        let Some(name) = owned.to_str() else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".onnx") {
            continue;
        }
        if lower.contains("encoder") {
            encoder = true;
        }
        if lower.contains("decoder") {
            decoder = true;
        }
    }
    encoder && decoder
}

#[cfg(test)]
#[path = "models_test.rs"]
mod tests;
