use std::fs;
use std::path::PathBuf;

use super::{load_at, weights_file};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("caprice-parakeet-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir(&dir).unwrap();
    dir
}

#[test]
fn a_directory_resolves_one_gguf_and_prefers_q8() {
    let missing = PathBuf::from(format!(
        "/tmp/caprice-parakeet-missing-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&missing);
    assert_eq!(
        weights_file(&missing).unwrap_err(),
        "parakeet model path is missing"
    );

    let empty = scratch("empty");
    assert_eq!(
        weights_file(&empty).unwrap_err(),
        "parakeet model is missing a .gguf file"
    );
    fs::write(empty.join("notes.txt"), b"no weights").unwrap();
    assert_eq!(
        weights_file(&empty).unwrap_err(),
        "parakeet model is missing a .gguf file"
    );

    let one = scratch("one");
    let file = one.join("parakeet-unified-en-0.6b-Q4_K_M.gguf");
    fs::write(&file, b"gguf").unwrap();
    assert_eq!(weights_file(&one).unwrap(), file);
    assert_eq!(weights_file(&file).unwrap(), file);

    let many = scratch("many");
    fs::write(many.join("parakeet-unified-en-0.6b-Q4_K_M.gguf"), b"q4").unwrap();
    fs::write(many.join("parakeet-unified-en-0.6b-Q5_K_M.gguf"), b"q5").unwrap();
    let q8 = many.join("parakeet-unified-en-0.6b-Q8_0.gguf");
    fs::write(&q8, b"q8").unwrap();
    assert_eq!(weights_file(&many).unwrap(), q8);

    let ambiguous = scratch("ambiguous");
    fs::write(ambiguous.join("a-Q4_K_M.gguf"), b"a").unwrap();
    fs::write(ambiguous.join("b-Q5_K_M.gguf"), b"b").unwrap();
    assert_eq!(
        weights_file(&ambiguous).unwrap_err(),
        "parakeet model directory has more than one .gguf"
    );

    fs::remove_dir_all(&empty).unwrap();
    fs::remove_dir_all(&one).unwrap();
    fs::remove_dir_all(&many).unwrap();
    fs::remove_dir_all(&ambiguous).unwrap();
}

#[test]
fn a_file_that_is_not_unified_weights_fails_in_the_runtime() {
    let dir = scratch("bogus");
    let file = dir.join("not-weights.gguf");
    fs::write(&file, b"not a gguf").unwrap();
    let err = match load_at(&file) {
        Err(err) => err,
        Ok(_) => panic!("bogus parakeet weights loaded"),
    };
    assert!(!err.is_empty());
    assert!(!err.contains("missing a .gguf"));
    assert!(!err.contains("not linked"));
    fs::remove_dir_all(&dir).unwrap();
}
