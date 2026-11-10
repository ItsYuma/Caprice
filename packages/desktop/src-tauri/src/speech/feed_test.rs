use super::super::pcm::{resample_linear, stable_resample_len};
use super::next_feed;

#[test]
fn a_feed_sends_the_stable_prefix_and_finish_sends_the_tail() {
    let rate = 8_000;
    let raw: Vec<f32> = (0..8).map(|index| index as f32).collect();
    let (first, sent) = next_feed(&raw[..4], rate, 0, false);
    let full_short = resample_linear(&raw[..4], rate, 16_000);
    let stable = stable_resample_len(4, rate, 16_000);
    assert_eq!(first, full_short[..stable]);
    assert_eq!(sent, stable);
    assert!(stable < full_short.len());

    let (second, sent) = next_feed(&raw, rate, sent, false);
    let full = resample_linear(&raw, rate, 16_000);
    let stable = stable_resample_len(raw.len(), rate, 16_000);
    assert_eq!(sent, stable);
    assert_eq!(second, full[first.len()..stable]);

    let (tail, sent) = next_feed(&raw, rate, sent, true);
    assert_eq!(sent, full.len());
    let mut heard = first;
    heard.extend_from_slice(&second);
    heard.extend_from_slice(&tail);
    assert_eq!(heard, full);
}

#[test]
fn a_matching_rate_is_ready_without_a_tail() {
    let (chunk, sent) = next_feed(&[0.25, 0.5], 16_000, 0, false);
    assert_eq!(chunk, vec![0.25, 0.5]);
    assert_eq!(sent, 2);
    let (tail, sent) = next_feed(&[0.25, 0.5], 16_000, sent, true);
    assert!(tail.is_empty());
    assert_eq!(sent, 2);
}
