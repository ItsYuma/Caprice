use std::io::{Read, Write};

use super::{
    basic_token, candidate_paths, clip, credentials_from_args, exchange, insecure_local,
    install_dir_from_settings, locate_from, loopback_url, parse_lcu, parse_live, parse_lockfile,
    Locate, Os, BODY_LIMIT,
};

#[test]
fn live_paths_stay_on_the_documented_api() {
    assert_eq!(
        parse_live("").expect("default"),
        "/liveclientdata/allgamedata"
    );
    assert_eq!(
        parse_live("/liveclientdata/playerscores?riotId=Name#TAG").expect("query"),
        "/liveclientdata/playerscores?riotId=Name%23TAG"
    );
    assert!(parse_live("/lol-summoner/v1/current-summoner").is_err());
    assert!(parse_live("/liveclientdata/../secret").is_err());
    assert!(parse_live("https://127.0.0.1:2999/liveclientdata/allgamedata").is_err());
    assert!(parse_live("/liveclientdata/allgamedata\n/etc/passwd").is_err());
    assert_eq!(
        loopback_url("https", 2999, "/liveclientdata/gamestats").expect("url"),
        "https://127.0.0.1:2999/liveclientdata/gamestats"
    );
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

    let stop = parse_lcu("DELETE /lol-lobby/v2/lobby/matchmaking/search").expect("stop");
    assert_eq!(stop.body, None);

    assert!(parse_lcu("GET /lol-summoner/v1/current-summoner\n{}").is_err());
    assert!(parse_lcu("PATCH /lol-lobby/v2/lobby\nnot json").is_err());
    assert!(parse_lcu("TRACE /lol-lobby/v2/lobby").is_err());
    assert!(parse_lcu("GET http://127.0.0.1/lol-lobby/v2/lobby").is_err());
}

#[test]
fn lockfile_and_process_credentials_are_found_without_returning_the_token_path() {
    let parsed = parse_lockfile("LeagueClient:42:5312:secret:https").expect("lock");
    assert_eq!(parsed.port, 5312);
    assert_eq!(parsed.token, "secret");
    assert_eq!(parsed.protocol, "https");
    assert!(parse_lockfile("nope").is_none());
    assert_eq!(basic_token("abc"), "cmlvdDphYmM=");

    let args = vec![
        "C:\\Riot Games\\League of Legends\\LeagueClientUx.exe".to_string(),
        "--app-port=5444".to_string(),
        "--remoting-auth-token=from-proc".to_string(),
    ];
    let from_proc = credentials_from_args(&args).expect("proc");
    assert_eq!(from_proc.port, 5444);
    assert_eq!(from_proc.token, "from-proc");
    assert!(credentials_from_args(&["--app-port=1".to_string()]).is_none());

    let settings = "product_install_full_path: \"D:/Riot Games/League of Legends\"\n";
    assert_eq!(
        install_dir_from_settings(settings).as_deref(),
        Some("D:/Riot Games/League of Legends")
    );

    let input = Locate {
        override_path: String::new(),
        home: "/Users/me".to_string(),
        program_files: "C:\\Program Files".to_string(),
        platform: Os::Windows,
        settings: settings.to_string(),
        proc_args: Vec::new(),
    };
    let paths = candidate_paths(&input, install_dir_from_settings(settings).as_deref());
    assert!(paths
        .iter()
        .any(|path| { path == "D:\\Riot Games\\League of Legends\\lockfile" }));
    assert!(paths
        .iter()
        .any(|path| { path == "C:\\Program Files\\Riot Games\\League of Legends\\lockfile" }));

    let found = locate_from(&input, &|path| {
        if path == "D:\\Riot Games\\League of Legends\\lockfile" {
            Some("LeagueClient:1:2999:secret:https".to_string())
        } else {
            None
        }
    })
    .expect("located");
    assert_eq!(found.port, 2999);
    assert_eq!(found.token, "secret");

    let missing = Locate {
        override_path: "/missing/lockfile".to_string(),
        home: String::new(),
        program_files: String::new(),
        platform: Os::Linux,
        settings: String::new(),
        proc_args: Vec::new(),
    };
    match locate_from(&missing, &|_| None) {
        Err(message) => {
            assert_eq!(message, "CAPRICE_LEAGUE_LOCKFILE is not a league lockfile");
        }
        Ok(_) => panic!("override path was missing"),
    }
}

#[test]
fn a_long_body_is_cut() {
    let bytes = vec![b'a'; BODY_LIMIT + 5];
    let text = clip(&bytes);
    assert!(text.ends_with("\ntruncated"));
    assert_eq!(text.len(), BODY_LIMIT + "\ntruncated".len());
    assert!(!text.contains(&"a".repeat(BODY_LIMIT + 1)));
}

#[test]
fn exchange_posts_to_loopback_and_keeps_the_body() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 4096];
        let read = stream.read(&mut buf).expect("read");
        let request = String::from_utf8_lossy(&buf[..read]).to_string();
        let payload = "{\"phase\":\"ChampSelect\"}";
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        request
    });

    let client = insecure_local().expect("client");
    let text = tauri::async_runtime::block_on(exchange(
        &client,
        &format!("http://127.0.0.1:{port}/lol-gameflow/v1/gameflow-phase"),
        "GET",
        &basic_token("abc"),
        None,
        "league client",
    ))
    .expect("get");
    let request = handle.join().expect("server").to_ascii_lowercase();

    assert_eq!(text, "{\"phase\":\"ChampSelect\"}");
    assert!(request.starts_with("get /lol-gameflow/v1/gameflow-phase "));
    assert!(request.contains("authorization: basic cmlvddphymm="));
    assert!(request.contains("accept: application/json"));
}

#[test]
fn exchange_sends_a_json_body_and_reports_status() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 4096];
        let read = stream.read(&mut buf).expect("read");
        let request = String::from_utf8_lossy(&buf[..read]).to_string();
        let payload = "no lobby";
        let response = format!(
            "HTTP/1.1 404 Not Found\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(response.as_bytes()).expect("write");
        request
    });

    let client = insecure_local().expect("client");
    let err = tauri::async_runtime::block_on(exchange(
        &client,
        &format!("http://127.0.0.1:{port}/lol-lobby/v2/lobby/matchmaking/search"),
        "POST",
        "",
        Some("{}"),
        "league client",
    ))
    .expect_err("status");
    let request = handle.join().expect("server");

    assert_eq!(err, "league client returned 404: no lobby");
    assert!(request
        .to_ascii_lowercase()
        .starts_with("post /lol-lobby/v2/lobby/matchmaking/search "));
    assert!(request.contains("\r\n\r\n{}"));
}

#[test]
fn exchange_refuses_a_url_that_leaves_the_machine() {
    let client = insecure_local().expect("client");
    let err = tauri::async_runtime::block_on(exchange(
        &client,
        "https://example.com/liveclientdata/allgamedata",
        "GET",
        "",
        None,
        "live client",
    ))
    .expect_err("remote");

    assert_eq!(err, "league url is not local");
}
