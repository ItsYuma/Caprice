use std::sync::Mutex;

use super::{note_failure, push_sample, take_fresh, Captured};

#[test]
fn a_full_buffer_records_the_failure_and_stops_appending() {
    let captured = Mutex::new(Captured {
        samples: vec![0.25],
        failure: None,
    });
    assert!(push_sample(&captured, 0.5, 2));
    assert!(!push_sample(&captured, 0.75, 2));
    assert!(!push_sample(&captured, 1.0, 2));
    let (samples, failure) = take_fresh(&captured);
    assert_eq!(samples, vec![0.25, 0.5]);
    assert_eq!(failure.as_deref(), Some("recording is too long"));
    let (again, failure) = take_fresh(&captured);
    assert!(again.is_empty());
    assert_eq!(failure.as_deref(), Some("recording is too long"));
}

#[test]
fn a_microphone_error_is_kept() {
    let captured = Mutex::new(Captured {
        samples: Vec::new(),
        failure: None,
    });
    note_failure(&captured, "microphone closed: device lost".to_string());
    note_failure(&captured, "microphone closed: later".to_string());
    assert!(!push_sample(&captured, 0.2, 8));
    let (_samples, failure) = take_fresh(&captured);
    assert_eq!(failure.as_deref(), Some("microphone closed: device lost"));
}
