use super::ReplyKind;

#[test]
fn reply_kind_names_the_engine() {
    assert_eq!(ReplyKind::parse("").unwrap(), ReplyKind::Http);
    assert_eq!(ReplyKind::parse("http").unwrap(), ReplyKind::Http);
    assert_eq!(ReplyKind::parse("  http ").unwrap(), ReplyKind::Http);
    assert_eq!(ReplyKind::parse("woof").unwrap(), ReplyKind::Woof);
    assert_eq!(ReplyKind::parse(" woof ").unwrap(), ReplyKind::Woof);
    assert_eq!(
        ReplyKind::parse("HTTP").unwrap_err(),
        "unknown reply engine: HTTP"
    );
    assert_eq!(
        ReplyKind::parse("bark").unwrap_err(),
        "unknown reply engine: bark"
    );
}

#[test]
fn credit_is_the_woof_sentence_only_for_woof() {
    assert_eq!(ReplyKind::parse("").unwrap().credit(), "");
    assert_eq!(ReplyKind::parse("http").unwrap().credit(), "");
    assert_eq!(
        ReplyKind::parse("woof").unwrap().credit(),
        "Voice by Underdog Woof"
    );
    assert_eq!(
        ReplyKind::parse(" woof ").unwrap().credit(),
        "Voice by Underdog Woof"
    );
}
