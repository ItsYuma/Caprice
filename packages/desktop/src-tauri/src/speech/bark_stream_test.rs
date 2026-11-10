use super::super::bark::TimedToken;
use super::{next_window, Utterance, Window};

fn take(received: usize, flush: bool) -> Vec<Window> {
    let mut center = 0;
    let mut windows = Vec::new();
    while let Some(window) = next_window(received, center, flush) {
        assert!(window.commit.end > center);
        center = window.commit.end;
        windows.push(window);
    }
    windows
}

fn token(start: usize, end: usize, id: u32) -> TimedToken {
    TimedToken { start, end, id }
}

fn ids(utterance: &Utterance) -> Vec<u32> {
    utterance.tokens.iter().map(|token| token.id).collect()
}

#[test]
fn the_window_cursor_names_the_ready_center_the_slice_and_the_commit() {
    assert!(take(63_999, false).is_empty());
    assert_eq!(
        take(64_000, false),
        vec![Window {
            slice: 0..64_000,
            commit: 0..32_000,
        }]
    );
    assert_eq!(
        take(96_000, false),
        vec![
            Window {
                slice: 0..64_000,
                commit: 0..32_000,
            },
            Window {
                slice: 0..96_000,
                commit: 32_000..64_000,
            },
        ]
    );
    assert_eq!(
        take(80_000, false),
        vec![Window {
            slice: 0..64_000,
            commit: 0..32_000,
        }]
    );

    let long = take(256_000, false);
    assert_eq!(long.len(), 7);
    assert_eq!(
        long[0],
        Window {
            slice: 0..64_000,
            commit: 0..32_000,
        }
    );
    assert_eq!(
        long[5],
        Window {
            slice: 0..224_000,
            commit: 160_000..192_000,
        }
    );
    assert_eq!(
        long[6],
        Window {
            slice: 32_000..256_000,
            commit: 192_000..224_000,
        }
    );

    let almost = take(255_999, false);
    assert_eq!(almost.len(), 6);
    assert_eq!(
        almost[5],
        Window {
            slice: 0..224_000,
            commit: 160_000..192_000,
        }
    );

    assert_eq!(
        take(80_000, true),
        vec![
            Window {
                slice: 0..64_000,
                commit: 0..32_000,
            },
            Window {
                slice: 0..80_000,
                commit: 32_000..64_000,
            },
            Window {
                slice: 0..80_000,
                commit: 64_000..80_000,
            },
        ]
    );
}

#[test]
fn finish_flushes_a_hello_shorter_than_the_right_context() {
    for hello in [8_000_usize, 31_999] {
        assert!(hello < 32_000);
        assert!(take(hello, false).is_empty());
        assert_eq!(
            take(hello, true),
            vec![Window {
                slice: 0..hello,
                commit: 0..hello,
            }]
        );
    }
}

#[test]
fn the_right_context_is_not_committed() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(0, 20_000, 1), token(32_000, 50_000, 7)], 0, 32_000);
    assert_eq!(ids(&utterance), vec![1]);
}

#[test]
fn a_later_window_replaces_a_committed_word() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(0, 20_000, 1)], 0, 32_000);
    utterance.absorb(
        &[
            token(0, 20_000, 9),
            token(32_000, 50_000, 2),
            token(64_000, 80_000, 3),
        ],
        0,
        64_000,
    );
    assert_eq!(ids(&utterance), vec![9, 2]);
}

#[test]
fn an_unchanged_left_context_word_is_not_repeated() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(0, 20_000, 1)], 0, 32_000);
    utterance.absorb(&[token(0, 20_000, 1), token(32_000, 50_000, 2)], 0, 64_000);
    assert_eq!(ids(&utterance), vec![1, 2]);
}

#[test]
fn a_word_that_starts_before_the_slice_stays() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(0, 10_000, 4), token(20_000, 30_000, 5)], 0, 32_000);
    utterance.absorb(&[token(0, 10_000, 6)], 32_000, 64_000);
    assert_eq!(ids(&utterance), vec![4, 5, 6]);
}

#[test]
fn a_token_that_crosses_the_commit_boundary_waits() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(20_000, 40_000, 1), token(0, 10_000, 2)], 0, 32_000);
    assert_eq!(ids(&utterance), vec![2]);
    utterance.absorb(&[token(0, 10_000, 2), token(20_000, 40_000, 1)], 0, 64_000);
    assert_eq!(ids(&utterance), vec![2, 1]);
}

#[test]
fn an_overlapping_revision_replaces_the_earlier_token() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(20_000, 50_000, 1)], 0, 64_000);
    utterance.absorb(&[token(0, 20_000, 2)], 32_000, 96_000);
    assert_eq!(ids(&utterance), vec![2]);
}

#[test]
fn overlapping_tokens_in_one_window_are_kept_once() {
    let mut utterance = Utterance::new();
    utterance.absorb(&[token(0, 20_000, 1), token(10_000, 18_000, 2)], 0, 32_000);
    assert_eq!(ids(&utterance), vec![1]);
}

#[test]
fn committed_audio_before_the_left_context_is_dropped() {
    let mut utterance = Utterance::new();
    utterance.audio = vec![0.0; 256_000];
    utterance.center = 192_000;
    utterance.trim();
    assert_eq!(utterance.origin, 32_000);
    assert_eq!(utterance.audio.len(), 224_000);
}

#[test]
fn a_failed_utterance_does_not_return_its_text() {
    let mut utterance = Utterance::new();
    utterance.tokens.push(token(0, 10, 4));
    let err = utterance
        .fail("bark window failed".to_string())
        .unwrap_err();
    assert_eq!(err, "bark window failed");
    assert!(utterance.tokens.is_empty());
    assert_eq!(utterance.failed.as_deref(), Some("bark window failed"));
}
