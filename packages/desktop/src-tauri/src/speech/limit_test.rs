use super::super::test_support::{env_lock, EnvGuard};
use super::duration_ms;

#[test]
fn an_unset_deadline_uses_the_default_and_a_bad_value_is_an_error() {
    let _lock = env_lock();
    let _cleared = EnvGuard::set("CAPRICE_STT_DEADLINE_MS", None);
    assert_eq!(
        duration_ms("CAPRICE_STT_DEADLINE_MS", 180_000).unwrap(),
        std::time::Duration::from_millis(180_000)
    );
    let _empty = EnvGuard::set("CAPRICE_STT_DEADLINE_MS", Some("  "));
    assert_eq!(
        duration_ms("CAPRICE_STT_DEADLINE_MS", 180_000).unwrap(),
        std::time::Duration::from_millis(180_000)
    );
    let _set = EnvGuard::set("CAPRICE_STT_DEADLINE_MS", Some("250"));
    assert_eq!(
        duration_ms("CAPRICE_STT_DEADLINE_MS", 180_000).unwrap(),
        std::time::Duration::from_millis(250)
    );
    let _zero = EnvGuard::set("CAPRICE_STT_DEADLINE_MS", Some("0"));
    assert_eq!(
        duration_ms("CAPRICE_STT_DEADLINE_MS", 180_000).unwrap_err(),
        "CAPRICE_STT_DEADLINE_MS is not a whole number of milliseconds"
    );
    let _bad = EnvGuard::set("CAPRICE_TTS_DEADLINE_MS", Some("later"));
    assert_eq!(
        duration_ms("CAPRICE_TTS_DEADLINE_MS", 60_000).unwrap_err(),
        "CAPRICE_TTS_DEADLINE_MS is not a whole number of milliseconds"
    );
}
