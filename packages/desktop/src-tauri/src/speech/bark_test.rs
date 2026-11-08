use std::fs;
use std::path::PathBuf;

use super::load_at;

#[test]
fn bark_refuses_a_directory_without_the_checkpoint() {
    let dir = PathBuf::from(format!("/tmp/caprice-bark-{}", std::process::id()));
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
