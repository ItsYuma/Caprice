use super::detected_json;

#[test]
fn a_found_client_is_league_and_a_miss_is_empty() {
    assert_eq!(detected_json(true), "[\"league\"]");
    assert_eq!(detected_json(false), "[]");
}
