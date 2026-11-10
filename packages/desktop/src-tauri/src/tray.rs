use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;

use crate::talk_keys::TALK_CANCEL;

pub const TRAY_ID: &str = "caprice";
pub const STOP_ID: &str = "stop";
pub const QUIT_ID: &str = "quit";
pub const TRAY_MENU: &[(&str, &str)] = &[(STOP_ID, "Stop"), (QUIT_ID, "Quit")];

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

#[cfg(test)]
#[path = "tray_test.rs"]
mod tests;
