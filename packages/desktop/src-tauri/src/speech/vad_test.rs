use super::{frame_samples, threshold, voiced, Endpoint};

fn near(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.000_1,
        "{actual} != {expected}"
    );
}

#[test]
fn sensitivity_lowers_the_threshold() {
    near(threshold(0.0), 0.08);
    near(threshold(40.0), 0.08 - 0.4 * 0.07);
    near(threshold(100.0), 0.01);
    near(threshold(-10.0), 0.08);
    near(threshold(150.0), 0.01);
    near(threshold(f32::NAN), 0.08);
}

#[test]
fn a_frame_at_the_threshold_is_voiced() {
    let level = threshold(40.0);
    assert!(voiced(&[level + 0.02, level + 0.02, level + 0.02], 40.0));
    assert!(!voiced(&[level * 0.25, level * 0.25], 40.0));
    assert!(!voiced(&[], 40.0));
    let quiet = [0.02, -0.02, 0.02, -0.02];
    assert!(!voiced(&quiet, 0.0));
    assert!(voiced(&quiet, 100.0));
}

#[test]
fn silence_ends_the_utterance_after_speech() {
    let rate = 16_000;
    let frame = frame_samples(rate);
    assert_eq!(frame, 320);
    let loud = vec![0.2; frame];
    let quiet = vec![0.0; frame];
    let mut endpoint = Endpoint::new(rate);
    assert!(!endpoint.push(&quiet, 40.0));
    assert!(!endpoint.push(&loud, 40.0));
    for _ in 0..39 {
        assert!(!endpoint.push(&quiet, 40.0));
    }
    assert!(endpoint.push(&quiet, 40.0));
}
