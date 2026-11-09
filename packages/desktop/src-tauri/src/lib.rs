mod league;
mod speech;

pub use speech::worker::FLAG as SPEECH_WORKER_FLAG;

pub fn speech_worker() -> i32 {
    speech::worker::run()
}

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelEndpoint {
    url: String,
    model: String,
    api_key: String,
}

#[tauri::command]
fn model_endpoint() -> ModelEndpoint {
    ModelEndpoint {
        url: std::env::var("CAPRICE_MODEL_URL").unwrap_or_default(),
        model: std::env::var("CAPRICE_MODEL").unwrap_or_default(),
        api_key: std::env::var("CAPRICE_MODEL_API_KEY").unwrap_or_default(),
    }
}

#[tauri::command]
async fn model_complete(url: String, body: String, api_key: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| err.to_string())?;

    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .body(body);

    if !api_key.is_empty() {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }

    let response = request.send().await.map_err(|err| err.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;

    if !status.is_success() {
        return Err(format!("model request failed: {}", status.as_u16()));
    }

    Ok(text)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    use super::model_complete;

    #[test]
    fn posts_to_the_given_url() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buf = [0_u8; 4096];
            let read = stream.read(&mut buf).expect("read");
            let request = String::from_utf8_lossy(&buf[..read]).to_string();
            let payload = "{\"ok\":true}";
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
                payload.len()
            );
            stream.write_all(response.as_bytes()).expect("write");
            request
        });

        let text = tauri::async_runtime::block_on(model_complete(
            format!("http://127.0.0.1:{port}/custom/chat"),
            "{\"model\":\"shell-model\"}".to_string(),
            "secret".to_string(),
        ))
        .expect("post");
        let request = handle.join().expect("server").to_ascii_lowercase();

        assert!(request.starts_with("post /custom/chat "));
        assert!(request.contains("authorization: bearer secret"));
        assert!(request.contains("{\"model\":\"shell-model\"}"));
        assert_eq!(text, "{\"ok\":true}");
    }
}

async fn blocking<T>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn speech_transcribe(
    state: tauri::State<'_, speech::SpeechState>,
    path: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || speech::speech_transcribe(&state, path)).await?
}

#[tauri::command]
async fn speech_listen_start(state: tauri::State<'_, speech::SpeechState>) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || speech::speech_listen_start(&state)).await?
}

#[tauri::command]
async fn speech_listen_stop(
    state: tauri::State<'_, speech::SpeechState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    blocking(move || speech::speech_listen_stop(&state)).await?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(speech::SpeechState::new())
        .manage(speech::ReplyState::new())
        .setup(|app| {
            place_companion(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            model_endpoint,
            model_complete,
            speech_transcribe,
            speech_listen_start,
            speech_listen_stop,
            speech::speak::speech_speak,
            speech::speak::speech_credit,
            league::league_live,
            league::league_lcu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running caprice");
}

fn place_companion(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let area = monitor.work_area();
    let margin = 24;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - margin;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}
