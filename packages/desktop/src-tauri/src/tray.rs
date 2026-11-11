use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::talk_keys::TALK_CANCEL;

pub const TRAY_ID: &str = "caprice";
pub const SETTINGS_ID: &str = "settings";
pub const STOP_ID: &str = "stop";
pub const QUIT_ID: &str = "quit";
pub const SETTINGS_WIDTH: f64 = 720.0;
pub const SETTINGS_HEIGHT: f64 = 640.0;
pub const TRAY_MENU: &[(&str, &str)] = &[
    (SETTINGS_ID, "Settings"),
    (STOP_ID, "Stop"),
    (QUIT_ID, "Quit"),
];

pub fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    let mut items = Vec::new();

    for (id, label) in TRAY_MENU {
        items.push(MenuItem::with_id(app, *id, *label, true, None::<&str>)?);
    }

    let entries: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let menu = Menu::with_items(app, &entries)?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Caprice")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if event.id == SETTINGS_ID {
                open_settings(app);
            }

            if event.id == STOP_ID {
                let _ = app.emit(TALK_CANCEL, ());
            }

            if event.id == QUIT_ID {
                app.exit(0);
            }
        })
        .build(app)?;

    Ok(())
}

fn open_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_ID) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, SETTINGS_ID, WebviewUrl::App("index.html".into()))
        .title("Settings")
        .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
        .center()
        .decorations(true)
        .skip_taskbar(false)
        .resizable(true)
        .focused(true)
        .visible(true)
        .build();
}

#[cfg(test)]
#[path = "tray_test.rs"]
mod tests;
