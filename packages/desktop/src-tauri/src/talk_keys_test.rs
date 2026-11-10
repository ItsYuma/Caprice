use std::time::{Duration, Instant};

use handy_keys::{Hotkey, HotkeyState, Key, Modifiers};

use super::{
    mature, note_press, note_release, poll_wait, talk_edge, talk_hotkey, DownChord, TALK_HOLD,
    TALK_POLL, TALK_PRESS, TALK_RELEASE,
};

#[test]
fn the_talk_chords_parse() {
    let alt = talk_hotkey("Alt+Space").expect("alt");
    let ctrl = talk_hotkey("Ctrl+Space").expect("ctrl");

    assert_eq!(alt, Hotkey::new(Modifiers::OPT, Key::Space).expect("alt"));
    assert_eq!(
        ctrl,
        Hotkey::new(Modifiers::CTRL, Key::Space).expect("ctrl")
    );
    assert!(talk_hotkey("").is_err());
}

#[test]
fn a_talk_hold_is_press_then_release() {
    assert_eq!(talk_edge(HotkeyState::Pressed), TALK_PRESS);
    assert_eq!(talk_edge(HotkeyState::Released), TALK_RELEASE);
    assert_eq!(TALK_HOLD, Duration::from_millis(200));
}

#[test]
fn a_tap_does_not_start_and_a_hold_does() {
    let start = Instant::now();
    let mut down = None;

    note_press(&mut down, 1, start);
    note_press(&mut down, 2, start);
    assert_eq!(down.as_ref().map(|chord| chord.id), Some(1));
    assert!(!note_release(&mut down, 2));
    assert!(!note_release(&mut down, 1));
    assert!(down.is_none());

    note_press(&mut down, 1, start);
    assert!(!mature(
        &mut down,
        start + Duration::from_millis(199),
        TALK_HOLD
    ));
    assert!(mature(&mut down, start + TALK_HOLD, TALK_HOLD));
    assert!(!mature(&mut down, start + TALK_HOLD, TALK_HOLD));
    assert!(note_release(&mut down, 1));
    assert!(down.is_none());
}

#[test]
fn the_hold_wait_shrinks_as_the_chord_matures() {
    let start = Instant::now();
    let waiting = DownChord {
        id: 1,
        at: start,
        live: false,
    };
    let live = DownChord {
        id: 1,
        at: start,
        live: true,
    };

    assert_eq!(poll_wait::<u32>(None, start), TALK_POLL);
    assert_eq!(poll_wait(Some(&live), start), TALK_POLL);
    assert_eq!(
        poll_wait(Some(&waiting), start + Duration::from_millis(195)),
        Duration::from_millis(5)
    );
    assert_eq!(poll_wait(Some(&waiting), start), TALK_POLL);
}
