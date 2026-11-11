use super::{SETTINGS_HEIGHT, SETTINGS_WIDTH, TRAY_MENU};

#[test]
fn the_tray_opens_settings_stops_or_quits() {
    assert_eq!(
        TRAY_MENU,
        [("settings", "Settings"), ("stop", "Stop"), ("quit", "Quit")]
    );
    assert_eq!(SETTINGS_WIDTH, 720.0);
    assert_eq!(SETTINGS_HEIGHT, 640.0);
}
