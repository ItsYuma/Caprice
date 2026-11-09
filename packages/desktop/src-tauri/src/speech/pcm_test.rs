use super::{decode_wav, fresh_samples, resample_linear, stable_resample_len};

fn encode_wav(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let data_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(44 + data_len);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.saturating_mul(2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&pcm_i16(*sample).to_le_bytes());
    }
    bytes
}

fn pcm_i16(sample: f32) -> i16 {
    let scaled = sample.clamp(-1.0, 1.0) * 32767.0;
    scaled.round() as i16
}

#[test]
fn resample_doubles_an_integer_rate() {
    let out = resample_linear(&[0.0, 1.0], 8_000, 16_000);
    assert_eq!(out.len(), 4);
    assert!((out[0] - 0.0).abs() < 0.001);
    assert!((out[1] - 0.5).abs() < 0.001);
    assert!((out[2] - 1.0).abs() < 0.001);
    assert!((out[3] - 1.0).abs() < 0.001);
    assert_eq!(resample_linear(&[0.25], 16_000, 16_000), vec![0.25]);
    assert!(resample_linear(&[], 48_000, 16_000).is_empty());
}

#[test]
fn wav_round_trip_keeps_rate_and_pcm() {
    let bytes = encode_wav(16_000, &[0.0, 1.0, -1.0]);
    let (rate, samples) = decode_wav(&bytes).unwrap();
    assert_eq!(rate, 16_000);
    assert_eq!(samples.len(), 3);
    assert!((samples[0]).abs() < 0.001);
    assert!((samples[1] - 1.0).abs() < 0.001);
    assert!((samples[2] + 1.0).abs() < 0.001);
    assert_eq!(
        decode_wav(b"not-a-wav").unwrap_err(),
        "wav must be 16-bit mono pcm"
    );
}

#[test]
fn wav_encodes_pcm16_mono() {
    let samples = [0.0, 1.0, -1.0, 0.25, 0.5, 2.0, -2.0];
    let bytes = encode_wav(16_000, &samples);
    assert_eq!(bytes.len(), 44 + samples.len() * 2);
    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(
        u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        (bytes.len() - 8) as u32
    );
    assert_eq!(&bytes[8..12], b"WAVE");
    assert_eq!(&bytes[12..16], b"fmt ");
    assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 16);
    assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 1);
    assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);
    assert_eq!(
        u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
        16_000
    );
    assert_eq!(
        u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
        32_000
    );
    assert_eq!(u16::from_le_bytes(bytes[32..34].try_into().unwrap()), 2);
    assert_eq!(u16::from_le_bytes(bytes[34..36].try_into().unwrap()), 16);
    assert_eq!(&bytes[36..40], b"data");
    assert_eq!(
        u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
        (samples.len() * 2) as u32
    );
    assert_eq!(
        &bytes[44..52],
        &[0x00, 0x00, 0xff, 0x7f, 0x01, 0x80, 0x00, 0x20]
    );
    let pcm: Vec<i16> = bytes[44..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| i16::from_le_bytes(*chunk))
        .collect();
    assert_eq!(pcm, vec![0, 32767, -32767, 8192, 16384, 32767, -32767]);

    let empty = encode_wav(48_000, &[]);
    assert_eq!(empty.len(), 44);
    assert_eq!(
        u32::from_le_bytes(empty[24..28].try_into().unwrap()),
        48_000
    );
    assert_eq!(
        u32::from_le_bytes(empty[28..32].try_into().unwrap()),
        96_000
    );
    assert_eq!(u32::from_le_bytes(empty[40..44].try_into().unwrap()), 0);
}

#[test]
fn stable_prefix_matches_after_the_buffer_grows() {
    let raw: Vec<f32> = (0..4_800).map(|index| (index as f32) / 4_800.0).collect();
    let short = &raw[..1_200];
    let short_full = resample_linear(short, 48_000, 16_000);
    let long_full = resample_linear(&raw, 48_000, 16_000);
    let stable = stable_resample_len(short.len(), 48_000, 16_000);
    assert_eq!(stable, short_full.len());
    assert_eq!(&short_full[..stable], &long_full[..stable]);

    let first = fresh_samples(short, 48_000, 16_000, 0, false);
    let second = fresh_samples(&raw, 48_000, 16_000, first.sent, true);
    assert_eq!(first.sent, stable);
    let mut joined = first.samples;
    joined.extend_from_slice(&second.samples);
    assert_eq!(joined, long_full);

    let wide: Vec<f32> = (0..4_000).map(|index| (index as f32) / 4_000.0).collect();
    let narrow = &wide[..1_000];
    let narrow_full = resample_linear(narrow, 8_000, 16_000);
    let wide_full = resample_linear(&wide, 8_000, 16_000);
    let held = stable_resample_len(narrow.len(), 8_000, 16_000);
    assert!(held < narrow_full.len());
    assert_eq!(&narrow_full[..held], &wide_full[..held]);
    assert!(narrow_full[held..]
        .iter()
        .zip(wide_full[held..].iter())
        .any(|(before, after)| (before - after).abs() > 0.000_01));
    let head = fresh_samples(narrow, 8_000, 16_000, 0, false);
    let tail = fresh_samples(&wide, 8_000, 16_000, head.sent, true);
    assert_eq!(head.sent, held);
    let mut streamed = head.samples;
    streamed.extend_from_slice(&tail.samples);
    assert_eq!(streamed, wide_full);

    let same = fresh_samples(&[0.1, 0.2, 0.3], 16_000, 16_000, 1, false);
    assert_eq!(same.samples, vec![0.2, 0.3]);
    assert_eq!(same.sent, 3);
    assert!(fresh_samples(&[], 48_000, 16_000, 0, true)
        .samples
        .is_empty());
}
