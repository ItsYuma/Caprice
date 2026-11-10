use super::{parse_lcu, parse_live};

#[test]
fn live_paths_encode_riot_ids_and_stay_on_the_documented_api() {
    assert_eq!(
        parse_live("").expect("default"),
        "/liveclientdata/allgamedata"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=Name#TAG").expect("hash"),
        "/liveclientdata/playerscores?riotId=Name%23TAG"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=Hide on bush#KR1").expect("space"),
        "/liveclientdata/playerscores?riotId=Hide%20on%20bush%23KR1"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=플레이어#KR1").expect("unicode"),
        "/liveclientdata/playerscores?riotId=%ED%94%8C%EB%A0%88%EC%9D%B4%EC%96%B4%23KR1"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=Name%23TAG").expect("encoded"),
        "/liveclientdata/playerscores?riotId=Name%23TAG"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=Name%23TAG#X y").expect("mixed"),
        "/liveclientdata/playerscores?riotId=Name%23TAG%23X%20y"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=A%2bB").expect("lower hex"),
        "/liveclientdata/playerscores?riotId=A%2bB"
    );
    assert!(parse_live("/lol-summoner/v1/current-summoner").is_err());
    assert!(parse_live("/liveclientdata/../secret").is_err());
    assert!(parse_live("/liveclientdata/%2e%2e/secret").is_err());
    assert!(parse_live("/liveclientdata/%252e%252e/secret").is_err());
    assert!(parse_live("https://127.0.0.1:2999/liveclientdata/allgamedata").is_err());
    assert!(parse_live("/liveclientdata/allgamedata\n/etc/passwd").is_err());
    assert!(parse_live("/liveclientdata/playerscores?riotId=a%0d%0aHost:evil").is_err());
    assert!(parse_live("/liveclientdata/playerscores?next=http://evil.com").is_err());
    assert!(parse_live("/liveclientdata/allgamedata?x=@evil").is_err());
    assert!(parse_live("/liveclientdata/allgamedata\\..\\secret").is_err());
}

#[test]
fn lcu_calls_keep_the_method_and_send_json() {
    let accept = parse_lcu("post /lol-matchmaking/v1/ready-check/accept").expect("accept");
    assert_eq!(accept.method, "POST");
    assert_eq!(accept.path, "/lol-matchmaking/v1/ready-check/accept");
    assert_eq!(accept.body.as_deref(), Some("{}"));

    let pick = parse_lcu(
        "PATCH /lol-champ-select/v1/session/actions/3\n{\"championId\":103,\"completed\":true}",
    )
    .expect("pick");
    assert_eq!(pick.method, "PATCH");
    assert_eq!(
        pick.body.as_deref(),
        Some("{\"championId\":103,\"completed\":true}")
    );

    let named =
        parse_lcu("GET /lol-summoner/v1/current-summoner?riotId=플레이어#KR1").expect("named");
    assert_eq!(
        named.path,
        "/lol-summoner/v1/current-summoner?riotId=%ED%94%8C%EB%A0%88%EC%9D%B4%EC%96%B4%23KR1"
    );
    assert_eq!(named.body, None);
    let encoded =
        parse_lcu("GET /lol-summoner/v1/current-summoner?riotId=Name%23TAG").expect("encoded");
    assert_eq!(
        encoded.path,
        "/lol-summoner/v1/current-summoner?riotId=Name%23TAG"
    );

    let stop = parse_lcu("DELETE /lol-lobby/v2/lobby/matchmaking/search").expect("stop");
    assert_eq!(stop.body, None);

    let complete =
        parse_lcu("POST /lol-champ-select/v1/session/actions/3/complete").expect("complete");
    assert_eq!(complete.method, "POST");
    assert_eq!(
        complete.path,
        "/lol-champ-select/v1/session/actions/3/complete"
    );
    assert_eq!(complete.body.as_deref(), Some("{}"));

    assert!(parse_lcu("GET /lol-summoner/v1/current-summoner\n{}").is_err());
    assert!(parse_lcu("PATCH /lol-lobby/v2/lobby\nnot json").is_err());
    assert!(parse_lcu("TRACE /lol-lobby/v2/lobby").is_err());
    assert!(parse_lcu("GET http://127.0.0.1/lol-lobby/v2/lobby").is_err());
    assert!(parse_lcu("GET /lol-lobby/../v2/lobby").is_err());
    assert!(parse_lcu("POST /lol-lobby/v2/lobby extra").is_err());
}
