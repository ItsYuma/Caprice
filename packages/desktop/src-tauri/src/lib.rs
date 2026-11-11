mod league;
mod model;
mod models;
mod settings;
mod speech;
mod talk_keys;
mod tray;

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
async fn speech_listen_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, speech::SpeechState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    blocking(move || speech::speech_listen_start(&app, &state)).await?
}

#[tauri::command]
async fn speech_listen_stop(
    state: tauri::State<'_, speech::SpeechState>,
) -> Result<String, String> {
    let state = state.inner().clone();
    match blocking(move || speech::speech_listen_stop(&state)).await?? {
        speech::ListenStop::Text(text) => Ok(text),
        speech::ListenStop::Http(clip) => speech::post_clip(clip).await,
    }
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
            park_page(app.handle());
            tray::install_tray(app).map_err(box_error)?;
            talk_keys::install(app.handle());
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
            settings::settings_get,
            settings::settings_put,
            models::models_list,
            league::league_live,
            league::league_lcu,
            talk_keys::talk_arm,
            talk_keys::talk_disarm,
        ])
        .build(tauri::generate_context!())
        .expect("error while running caprice");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            talk_keys::shutdown(app);
            model::shutdown(app);
        }
    });
}

const PARKED_X: i32 = -32_000;
const PARKED_Y: i32 = -32_000;

fn parked_origin() -> (i32, i32) {
    (PARKED_X, PARKED_Y)
}

fn park_page(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (x, y) = parked_origin();
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    #[cfg(windows)]
    hide_from_switcher(&window);
}

fn box_error(err: tauri::Error) -> Box<dyn std::error::Error> {
    Box::new(err)
}

#[cfg(windows)]
fn hide_from_switcher(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    // WS_EX_TOOLWINDOW keeps this window out of Alt+Tab. skip_taskbar only drops the taskbar button.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let next = (style & !WS_EX_APPWINDOW.0) | WS_EX_TOOLWINDOW.0;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}
