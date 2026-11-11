#[tauri::command]
pub(crate) async fn league_live(path: String) -> Result<String, String> {
    caprice_league::league_live(path).await
}

#[tauri::command]
pub(crate) async fn league_lcu(request: String) -> Result<String, String> {
    caprice_league::league_lcu(request).await
}

#[tauri::command]
pub(crate) async fn games_detected() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(caprice_league::games_detected)
        .await
        .map_err(|err| err.to_string())
}
