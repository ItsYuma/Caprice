use base64::engine::general_purpose::STANDARD;
use base64::Engine;

// Riot documents the Live Client Data API on 127.0.0.1:2999.
const LIVE_CLIENT_PORT: u16 = 2999;

const BODY_LIMIT: usize = 80_000;

struct Lockfile {
    port: u16,
    token: String,
    protocol: String,
}

struct LcuCall {
    method: String,
    path: String,
    body: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Os {
    Windows,
    Macos,
    Linux,
}

struct Locate {
    override_path: String,
    home: String,
    program_files: String,
    platform: Os,
    settings: String,
    proc_args: Vec<String>,
}

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
    let creds = current_credentials()?;
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

fn current_credentials() -> Result<Lockfile, String> {
    let program_data = std::env::var("ProgramData").unwrap_or_default();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| {
        if cfg!(windows) {
            "C:\\Program Files".to_string()
        } else {
            String::new()
        }
    });
    let input = Locate {
        override_path: std::env::var("CAPRICE_LEAGUE_LOCKFILE").unwrap_or_default(),
        home,
        program_files,
        platform: current_os(),
        settings: settings_text(&program_data),
        proc_args: running_client_args(),
    };
    locate_from(&input, &read_text)
}

fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Macos
    } else {
        Os::Linux
    }
}

fn settings_text(program_data: &str) -> String {
    if program_data.is_empty() {
        return String::new();
    }

    let path = format!(
        "{program_data}\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml"
    );
    std::fs::read_to_string(path).unwrap_or_default()
}

fn read_text(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

fn running_client_args() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }

        let Ok(bytes) = std::fs::read(entry.path().join("cmdline")) else {
            continue;
        };
        let args = split_cmdline(&bytes);

        if credentials_from_args(&args).is_some() {
            return args;
        }
    }

    Vec::new()
}

fn split_cmdline(bytes: &[u8]) -> Vec<String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect()
}

fn locate_from(input: &Locate, read: &dyn Fn(&str) -> Option<String>) -> Result<Lockfile, String> {
    let override_path = input.override_path.trim();

    if !override_path.is_empty() {
        let Some(text) = read(override_path) else {
            return Err("CAPRICE_LEAGUE_LOCKFILE is not a league lockfile".to_string());
        };

        return parse_lockfile(&text)
            .ok_or_else(|| "CAPRICE_LEAGUE_LOCKFILE is not a league lockfile".to_string());
    }

    if let Some(found) = credentials_from_args(&input.proc_args) {
        return Ok(found);
    }

    let install = install_dir_from_settings(&input.settings);

    for path in candidate_paths(input, install.as_deref()) {
        let Some(text) = read(&path) else {
            continue;
        };

        if let Some(found) = parse_lockfile(&text) {
            return Ok(found);
        }
    }

    Err("league client is not running".to_string())
}

fn credentials_from_args(args: &[String]) -> Option<Lockfile> {
    let client = args.iter().any(|arg| arg.contains("LeagueClientUx"));

    if !client {
        return None;
    }

    let mut port = None;
    let mut token = None;

    for arg in args {
        if let Some(value) = arg.strip_prefix("--app-port=") {
            port = parse_port(value);
        }

        if let Some(value) = arg.strip_prefix("--remoting-auth-token=") {
            if !value.is_empty() {
                token = Some(value.to_string());
            }
        }
    }

    Some(Lockfile {
        port: port?,
        token: token?,
        protocol: "https".to_string(),
    })
}

fn install_dir_from_settings(text: &str) -> Option<String> {
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("product_install_full_path:") else {
            continue;
        };
        let value = rest.trim().trim_matches('"').trim();

        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    None
}

fn candidate_paths(input: &Locate, install_dir: Option<&str>) -> Vec<String> {
    let mut paths = Vec::new();

    if let Some(dir) = install_dir {
        paths.push(lockfile_in(
            &native_dir(dir, input.platform),
            input.platform,
        ));
    }

    match input.platform {
        Os::Windows => {
            paths.push(lockfile_in(
                "C:\\Riot Games\\League of Legends",
                Os::Windows,
            ));
            paths.push(lockfile_in(
                "C:\\Games\\Riot Games\\League of Legends",
                Os::Windows,
            ));

            if !input.program_files.is_empty() {
                paths.push(lockfile_in(
                    &format!("{}\\Riot Games\\League of Legends", input.program_files),
                    Os::Windows,
                ));
            }
        }
        Os::Macos => {
            paths.push(lockfile_in(
                "/Applications/League of Legends.app/Contents/LoL",
                Os::Macos,
            ));

            if !input.home.is_empty() {
                paths.push(lockfile_in(
                    &format!(
                        "{}/Applications/League of Legends.app/Contents/LoL",
                        input.home
                    ),
                    Os::Macos,
                ));
            }
        }
        Os::Linux => {}
    }

    paths
}

fn lockfile_in(dir: &str, platform: Os) -> String {
    let sep = if platform == Os::Windows { '\\' } else { '/' };
    format!("{dir}{sep}lockfile")
}

fn native_dir(dir: &str, platform: Os) -> String {
    if platform == Os::Windows {
        dir.replace('/', "\\")
    } else {
        dir.replace('\\', "/")
    }
}

fn parse_lockfile(text: &str) -> Option<Lockfile> {
    let parts: Vec<&str> = text.trim().split(':').collect();

    if parts.len() < 5 {
        return None;
    }

    let port = parse_port(parts[2])?;
    let protocol = parts[parts.len() - 1].trim().to_ascii_lowercase();

    if protocol != "https" && protocol != "http" {
        return None;
    }

    let token = parts[3..parts.len() - 1].join(":");

    if token.is_empty() {
        return None;
    }

    Some(Lockfile {
        port,
        token,
        protocol,
    })
}

fn parse_port(text: &str) -> Option<u16> {
    let port = text.parse::<u16>().ok()?;

    if port == 0 {
        None
    } else {
        Some(port)
    }
}

fn parse_live(input: &str) -> Result<String, String> {
    let text = input.trim();
    let path = if text.is_empty() {
        "/liveclientdata/allgamedata"
    } else if text.contains('\n') || text.contains('\r') {
        return Err("live client input is one path".to_string());
    } else {
        text
    };
    let path = local_path(path)?;

    if !path.starts_with("/liveclientdata/") {
        return Err("live client path must start with /liveclientdata/".to_string());
    }

    Ok(path)
}

fn parse_lcu(input: &str) -> Result<LcuCall, String> {
    let mut lines = input.trim().lines();
    let first = lines.next().unwrap_or("").trim();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_ascii_uppercase();
    let path = parts.next().unwrap_or("");

    if parts.next().is_some() {
        return Err("league client input is a method and a path".to_string());
    }

    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err("league client method is not allowed".to_string());
    }

    let path = local_path(path)?;
    let mut payload = String::new();

    for line in lines {
        if !payload.is_empty() {
            payload.push('\n');
        }

        payload.push_str(line);
    }

    let payload = payload.trim().to_string();

    if method == "GET" && !payload.is_empty() {
        return Err("GET takes no body".to_string());
    }

    if payload.is_empty() {
        let body = if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
            Some("{}".to_string())
        } else {
            None
        };

        return Ok(LcuCall { method, path, body });
    }

    serde_json::from_str::<serde_json::Value>(&payload)
        .map_err(|_| "league client body is not json".to_string())?;

    Ok(LcuCall {
        method,
        path,
        body: Some(payload),
    })
}

fn local_path(path: &str) -> Result<String, String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("league path must start with /".to_string());
    }

    if path.contains("..")
        || path.contains('\\')
        || path.contains('@')
        || path.contains("://")
        || path
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || !byte.is_ascii())
    {
        return Err("league path is not allowed".to_string());
    }

    Ok(path.replace('#', "%23"))
}

fn loopback_url(protocol: &str, port: u16, path: &str) -> Result<String, String> {
    if protocol != "https" && protocol != "http" {
        return Err("league client protocol is not http".to_string());
    }

    if port == 0 {
        return Err("league client port is missing".to_string());
    }

    Ok(format!("{protocol}://127.0.0.1:{port}{path}"))
}

fn basic_token(token: &str) -> String {
    STANDARD.encode(format!("riot:{token}"))
}

fn insecure_local() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // The League client and the live client present a certificate that is not publicly trusted.
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|err| err.to_string())
}

async fn exchange(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    basic: &str,
    body: Option<&str>,
    kind: &str,
) -> Result<String, String> {
    guard_loopback(url)?;
    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "league client method is not allowed".to_string())?;
    let mut request = client
        .request(verb, url)
        .header("accept", "application/json");

    if !basic.is_empty() {
        request = request.header("authorization", format!("Basic {basic}"));
    }

    if let Some(payload) = body {
        request = request
            .header("content-type", "application/json")
            .body(payload.to_string());
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => return Err(down(kind, err)),
    };
    let status = response.status();
    let bytes = response.bytes().await.map_err(|err| down(kind, err))?;
    let text = clip(&bytes);

    if !status.is_success() {
        return Err(format!("{kind} returned {}: {text}", status.as_u16()));
    }

    if text.is_empty() {
        return Ok("{}".to_string());
    }

    Ok(text)
}

fn guard_loopback(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| "league url is not local".to_string())?;
    let host = rest.split('/').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");

    if host == "127.0.0.1" {
        Ok(())
    } else {
        Err("league url is not local".to_string())
    }
}

fn down(kind: &str, err: reqwest::Error) -> String {
    if err.is_connect() || err.is_timeout() {
        format!("{kind} is not running")
    } else {
        err.to_string()
    }
}

fn clip(bytes: &[u8]) -> String {
    let limit = BODY_LIMIT.min(bytes.len());
    let mut text = String::from_utf8_lossy(&bytes[..limit]).into_owned();

    if bytes.len() > BODY_LIMIT {
        if text.ends_with('\u{FFFD}') {
            text.pop();
        }

        text.push_str("\ntruncated");
    }

    text
}

#[cfg(test)]
#[path = "league_test.rs"]
mod tests;
