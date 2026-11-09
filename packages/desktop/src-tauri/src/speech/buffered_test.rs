use std::cell::RefCell;

use super::{
    RangeDecoder, Utterance, CHUNK_MS, CHUNK_SAMPLES, LEFT_MS, LEFT_SAMPLES, RATE, RIGHT_MS,
    RIGHT_SAMPLES,
};

struct Call {
    audio: usize,
    window_start: usize,
    window_end: usize,
    commit_start: usize,
    commit_end: usize,
}

fn scripted(calls: &RefCell<Vec<Call>>) -> impl RangeDecoder + '_ {
    move |audio: &[f32],
          window_start: usize,
          window_end: usize,
          commit_start: usize,
          commit_end: usize| {
        assert!(window_end <= audio.len());
        assert!(window_start <= commit_start);
        assert!(commit_end <= window_end);
        calls.borrow_mut().push(Call {
            audio: audio.len(),
            window_start,
            window_end,
            commit_start,
            commit_end,
        });
        Ok(format!("{commit_start}:{commit_end}"))
    }
}

#[test]
fn the_160ms_row_is_1280_sample_steps_at_16khz() {
    assert_eq!(RATE, 16_000);
    assert_eq!(LEFT_MS, 5_600);
    assert_eq!(CHUNK_MS, 80);
    assert_eq!(RIGHT_MS, 80);
    assert_eq!(LEFT_SAMPLES, 89_600);
    assert_eq!(CHUNK_SAMPLES, 1_280);
    assert_eq!(RIGHT_SAMPLES, 1_280);
    assert_eq!(CHUNK_MS + RIGHT_MS, 160);
    assert_eq!((CHUNK_SAMPLES + RIGHT_SAMPLES) * 1_000 / RATE as usize, 160);
}

#[test]
fn chunk_boundaries_follow_the_160ms_row() {
    let calls = RefCell::new(Vec::new());
    let mut utterance = Utterance::new(scripted(&calls));
    let partial = utterance.feed(&[0.1; CHUNK_SAMPLES + RIGHT_SAMPLES - 1]);
    assert_eq!(partial.unwrap(), "");
    assert!(calls.borrow().is_empty());

    let partial = utterance.feed(&[0.1]).unwrap();
    {
        let calls = calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].audio, CHUNK_SAMPLES + RIGHT_SAMPLES);
        assert_eq!(calls[0].window_start, 0);
        assert_eq!(calls[0].window_end, CHUNK_SAMPLES + RIGHT_SAMPLES);
        assert_eq!(calls[0].commit_start, 0);
        assert_eq!(calls[0].commit_end, CHUNK_SAMPLES);
    }
    assert_eq!(partial, "0:1280");

    let partial = utterance.feed(&[0.1; CHUNK_SAMPLES - 1]).unwrap();
    assert_eq!(calls.borrow().len(), 1);
    assert_eq!(partial, "0:1280");

    let partial = utterance.feed(&[0.1]).unwrap();
    {
        let calls = calls.borrow();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].audio, CHUNK_SAMPLES * 2 + RIGHT_SAMPLES);
        assert_eq!(calls[1].window_start, 0);
        assert_eq!(calls[1].window_end, CHUNK_SAMPLES * 2 + RIGHT_SAMPLES);
        assert_eq!(calls[1].commit_start, CHUNK_SAMPLES);
        assert_eq!(calls[1].commit_end, CHUNK_SAMPLES * 2);
        assert_eq!(calls[1].window_end - calls[1].commit_end, RIGHT_SAMPLES);
    }
    assert_eq!(partial, "0:12801280:2560");

    let text = utterance.finish().unwrap();
    {
        let calls = calls.borrow();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[2].commit_start, CHUNK_SAMPLES * 2);
        assert_eq!(calls[2].commit_end, calls[2].audio);
        assert_eq!(calls[2].window_end, calls[2].audio);
        assert_eq!(calls[2].audio - calls[2].commit_start, RIGHT_SAMPLES);
    }
    assert_eq!(text, "0:12801280:25602560:3840");
}

#[test]
fn left_context_is_recomputed_for_each_chunk() {
    let calls = RefCell::new(Vec::new());
    let mut utterance = Utterance::new(scripted(&calls));
    let total = LEFT_SAMPLES + CHUNK_SAMPLES * 2 + RIGHT_SAMPLES;
    let audio = vec![0.2; total];
    utterance.feed(&audio).unwrap();
    drop(utterance);

    let calls = calls.into_inner();
    let last = calls.last().unwrap();
    assert_eq!(last.audio, total);
    assert_eq!(last.commit_end - last.commit_start, CHUNK_SAMPLES);
    assert_eq!(last.window_end, last.commit_end + RIGHT_SAMPLES);
    assert_eq!(last.window_start, last.commit_start - LEFT_SAMPLES);
    assert_eq!(
        last.window_end - last.window_start,
        LEFT_SAMPLES + CHUNK_SAMPLES + RIGHT_SAMPLES
    );
    assert_ne!(calls[0].window_start, last.window_start);
    assert!(calls
        .iter()
        .all(|call| call.window_end - call.commit_end == RIGHT_SAMPLES));
    assert!(calls
        .iter()
        .all(|call| call.commit_end <= call.audio - RIGHT_SAMPLES));
}

#[test]
fn finish_flushes_a_short_utterance() {
    let calls = RefCell::new(Vec::new());
    let mut utterance = Utterance::new(scripted(&calls));
    assert_eq!(utterance.feed(&[0.3; 40]).unwrap(), "");
    assert_eq!(utterance.feed(&[0.3; 60]).unwrap(), "");
    assert!(calls.borrow().is_empty());

    assert_eq!(utterance.finish().unwrap(), "0:100");
    {
        let calls = calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].audio, 100);
        assert_eq!(calls[0].window_start, 0);
        assert_eq!(calls[0].window_end, 100);
        assert_eq!(calls[0].commit_start, 0);
        assert_eq!(calls[0].commit_end, 100);
    }

    assert_eq!(utterance.finish().unwrap(), "0:100");
    assert_eq!(calls.borrow().len(), 1);
}
