use std::sync::{Arc, Mutex};

use super::super::capture::Captured;
use super::super::pcm::{resample_linear, Resampler};
use super::pull_chunk;

#[test]
fn a_feed_sends_the_stable_prefix_and_finish_sends_the_tail() {
    let rate = 8_000;
    let raw: Vec<f32> = (0..8).map(|index| index as f32).collect();
    let captured = Arc::new(Mutex::new(Captured::from_samples(&raw[..4])));
    let mut resampler = Resampler::new(rate, 16_000);
    let mut sent = 0usize;
    let mut expected = Resampler::new(rate, 16_000);
    let first = pull_chunk(&captured, rate, &mut resampler, &mut sent, false).unwrap();
    assert_eq!(first, expected.push(&raw[..4], false));
    assert_eq!(sent, 4);

    captured.lock().unwrap().replace(&raw);
    let second = pull_chunk(&captured, rate, &mut resampler, &mut sent, false).unwrap();
    assert_eq!(second, expected.push(&raw[4..], false));
    assert_eq!(sent, raw.len());

    let tail = pull_chunk(&captured, rate, &mut resampler, &mut sent, true).unwrap();
    assert_eq!(tail, expected.push(&[], true));
    let mut heard = first;
    heard.extend_from_slice(&second);
    heard.extend_from_slice(&tail);
    assert_eq!(heard, resample_linear(&raw, rate, 16_000));
}

#[test]
fn a_matching_rate_is_ready_without_a_tail() {
    let captured = Arc::new(Mutex::new(Captured::from_samples(&[0.25, 0.5])));
    let mut resampler = Resampler::new(16_000, 16_000);
    let mut sent = 0usize;
    let chunk = pull_chunk(&captured, 16_000, &mut resampler, &mut sent, false).unwrap();
    assert_eq!(chunk, vec![0.25, 0.5]);
    assert_eq!(sent, 2);
    let tail = pull_chunk(&captured, 16_000, &mut resampler, &mut sent, true).unwrap();
    assert!(tail.is_empty());
    assert_eq!(sent, 2);
}
