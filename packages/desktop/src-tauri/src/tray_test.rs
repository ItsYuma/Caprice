use super::TRAY_MENU;

#[test]
fn the_tray_stops_or_quits() {
    assert_eq!(TRAY_MENU, [("stop", "Stop"), ("quit", "Quit")]);
}
