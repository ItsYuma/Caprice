use std::fs;

use telmo::parakeet::Token;

use super::{load_at, place_tokens, token_span};

#[test]
fn bark_refuses_a_directory_without_the_checkpoint() {
    let dir = std::env::temp_dir().join(format!("caprice-bark-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir(&dir).unwrap();

    let missing_config = match load_at(&dir) {
        Err(message) => message,
        Ok(_) => panic!("loaded a directory with no checkpoint"),
    };
    assert_eq!(missing_config, "bark model is missing config.json");

    fs::write(dir.join("config.json"), b"{}").unwrap();
    fs::write(dir.join("tokenizer.json"), b"{}").unwrap();
    let missing_weights = match load_at(&dir) {
        Err(message) => message,
        Ok(_) => panic!("loaded a directory with no weights"),
    };
    assert_eq!(missing_weights, "bark model is missing model.safetensors");

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn tokens_inside_the_leading_silence_are_dropped() {
    assert!(token_span(0, 1).is_none());
    assert!(token_span(0, 3).is_none());
    assert_eq!(token_span(0, 4), Some((0, 1_120)));
    assert_eq!(token_span(4, 2), Some((1_120, 3_680)));
    assert_eq!(token_span(4, 0), Some((1_120, 2_400)));

    let placed = place_tokens(&[
        Token {
            id: 1,
            frame: 0,
            duration: 1,
        },
        Token {
            id: 2,
            frame: 4,
            duration: 2,
        },
    ]);
    assert_eq!(placed.len(), 1);
    assert_eq!(placed[0].id, 2);
    assert_eq!(placed[0].start, 1_120);
    assert_eq!(placed[0].end, 3_680);
}
