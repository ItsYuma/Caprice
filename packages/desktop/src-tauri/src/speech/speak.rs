use base64::engine::general_purpose::STANDARD;
use base64::Engine;

#[tauri::command]
pub(crate) async fn speech_speak(text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }
    let url = match std::env::var("CAPRICE_TTS_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return Err("speech is not configured".to_string()),
    };
    let model = match std::env::var("CAPRICE_TTS_MODEL") {
        Ok(model) if !model.is_empty() => model,
        _ => return Err("CAPRICE_TTS_MODEL is not set".to_string()),
    };
    let voice = std::env::var("CAPRICE_TTS_VOICE").unwrap_or_default();
    let api_key = std::env::var("CAPRICE_TTS_API_KEY").unwrap_or_default();
    let mut payload = serde_json::json!({
        "model": model,
        "input": text,
    });
    if !voice.is_empty() {
        payload["voice"] = serde_json::Value::String(voice);
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .body(payload.to_string());
    if !api_key.is_empty() {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("speech request failed: {}", status.as_u16()));
    }
    Ok(STANDARD.encode(bytes))
}

#[cfg(test)]
#[path = "speak_test.rs"]
mod tests;
