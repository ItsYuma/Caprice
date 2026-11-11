use super::ReplyKind;

#[test]
fn reply_kind_names_http_and_unloaded_families() {
    assert_eq!(ReplyKind::parse("").unwrap(), ReplyKind::Http);
    assert_eq!(ReplyKind::parse("http").unwrap(), ReplyKind::Http);
    assert_eq!(ReplyKind::parse("  http ").unwrap(), ReplyKind::Http);
    assert_eq!(
        ReplyKind::parse("piper").unwrap(),
        ReplyKind::Local("piper")
    );
    assert_eq!(
        ReplyKind::parse(" kokoro ").unwrap(),
        ReplyKind::Local("kokoro")
    );
    assert_eq!(
        ReplyKind::parse("woof").unwrap_err(),
        "woof is retired. Use http."
    );
    assert_eq!(
        ReplyKind::parse("HTTP").unwrap_err(),
        "unknown reply engine: HTTP"
    );
    assert_eq!(
        ReplyKind::parse("bark").unwrap_err(),
        "unknown reply engine: bark"
    );
}
