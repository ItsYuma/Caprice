mod league;
mod model;
mod speech;

pub use speech::worker::FLAG as SPEECH_WORKER_FLAG;

pub fn speech_worker() -> i32 {
    speech::worker::run()
}

use tauri::Manager;

#[cfg(test)]
#[path = "lib_test.rs"]
mod tests;

async fn blocking<T>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())
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

#[tauri::command]
async fn speech_cancel(state: tauri::State<'_, speech::SpeechState>) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || speech::speech_cancel(&state)).await?
}

#[tauri::command]
fn speech_reply_cancel(state: tauri::State<'_, speech::ReplyState>) -> Result<(), String> {
    speech::speech_reply_cancel(state.inner())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(model::ModelState::new())
        .manage(speech::SpeechState::new())
        .manage(speech::ReplyState::new())
        .setup(|app| {
            place_companion(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            model::model_endpoint,
            model::model_complete,
            model::model_cancel,
            speech_listen_start,
            speech_listen_stop,
            speech_cancel,
            speech_reply_cancel,
            speech::speak::speech_speak,
            speech::speak::speech_credit,
            league::league_live,
            league::league_lcu,
        ])
        .build(tauri::generate_context!())
        .expect("error while running caprice");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            model::shutdown(app);
        }
    });
}

const COMPANION_MARGIN: i32 = 24;

fn companion_origin(area_x: i32, area_y: i32) -> (i32, i32) {
    (area_x + COMPANION_MARGIN, area_y + COMPANION_MARGIN)
}

fn place_companion(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let area = monitor.work_area();
    let (x, y) = companion_origin(area.position.x, area.position.y);
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}
