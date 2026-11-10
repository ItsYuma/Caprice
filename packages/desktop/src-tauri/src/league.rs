#[path = "games/mod.rs"]
mod games;

use games::discover::{basic_token, current_credentials};
use games::request::{parse_lcu, parse_live};
use games::transport::{exchange, insecure_local, loopback_url};

// Riot documents the Live Client Data API on 127.0.0.1:2999.
const LIVE_CLIENT_PORT: u16 = 2999;

#[tauri::command]
pub(crate) async fn league_live(path: String) -> Result<String, String> {
    let path = parse_live(&path)?;
    let client = insecure_local()?;
    let url = loopback_url("https", LIVE_CLIENT_PORT, &path)?;
    exchange(&client, &url, "GET", "", None, "live client").await
}

#[tauri::command]
pub(crate) async fn league_lcu(request: String) -> Result<String, String> {
    let call = parse_lcu(&request)?;
    let creds = tauri::async_runtime::spawn_blocking(current_credentials)
        .await
        .map_err(|err| err.to_string())??;
    let client = insecure_local()?;
    let url = loopback_url(&creds.protocol, creds.port, &call.path)?;
    exchange(
        &client,
        &url,
        &call.method,
        &basic_token(&creds.token),
        call.body.as_deref(),
        "league client",
    )
    .await
}
