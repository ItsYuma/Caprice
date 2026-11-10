use std::time::Duration;

const BODY_LIMIT: usize = 4_000_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);

pub(in crate::league) fn insecure_local() -> Result<reqwest::Client, String> {
    local_client(REQUEST_TIMEOUT)
}

fn local_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // The League client and the live client present a certificate that is not publicly trusted.
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .retry(reqwest::retry::never())
        .no_proxy()
        .local_address(std::net::IpAddr::from(std::net::Ipv4Addr::LOCALHOST))
        .build()
        .map_err(|err| err.to_string())
}

pub(in crate::league) fn loopback_url(
    protocol: &str,
    port: u16,
    path: &str,
) -> Result<reqwest::Url, String> {
    if protocol != "https" && protocol != "http" {
        return Err("league client protocol is not http".to_string());
    }

    if port == 0 {
        return Err("league client port is missing".to_string());
    }

    if path_leaves_loopback(path) {
        return Err("league url is not local".to_string());
    }

    let url = reqwest::Url::parse(&format!("{protocol}://127.0.0.1:{port}{path}"))
        .map_err(|_| "league url is not local".to_string())?;

    if url.scheme() != protocol || url.port() != Some(port) || !is_local(&url) {
        return Err("league url is not local".to_string());
    }

    Ok(url)
}

pub(in crate::league) async fn exchange(
    client: &reqwest::Client,
    url: &reqwest::Url,
    method: &str,
    basic: &str,
    body: Option<&str>,
    kind: &str,
) -> Result<String, String> {
    exchange_limited(client, url, method, basic, body, kind, BODY_LIMIT).await
}

async fn exchange_limited(
    client: &reqwest::Client,
    url: &reqwest::Url,
    method: &str,
    basic: &str,
    body: Option<&str>,
    kind: &str,
    limit: usize,
) -> Result<String, String> {
    if !is_local(url) {
        return Err("league url is not local".to_string());
    }

    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "league client method is not allowed".to_string())?;
    let mut request = client
        .request(verb, url.clone())
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
    let (bytes, truncated) = read_bounded(response, limit)
        .await
        .map_err(|err| down(kind, err))?;
    let text = clip(&bytes, truncated);

    if !status.is_success() {
        return Err(format!("{kind} returned {}: {text}", status.as_u16()));
    }

    if text.is_empty() {
        return Ok("{}".to_string());
    }

    Ok(text)
}

fn path_leaves_loopback(path: &str) -> bool {
    if !path.starts_with('/') || path.starts_with("//") {
        return true;
    }

    let route = path.split('?').next().unwrap_or(path);

    if route.contains('\\')
        || route.contains('@')
        || route.contains("://")
        || route
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte < 0x20 || byte == 0x7f)
    {
        return true;
    }

    route.split('/').any(|segment| {
        segment == ".." || segment.eq_ignore_ascii_case("%2e%2e") || segment.contains(':')
    })
}

fn is_local(url: &reqwest::Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }

    if url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return false;
    }

    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return false;
    }

    let Some(mut segments) = url.path_segments() else {
        return false;
    };

    segments.all(|segment| segment != "..")
}

async fn read_bounded(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<(Vec<u8>, bool), reqwest::Error> {
    let declared = declared_length(&response);
    let mut body = Vec::new();

    loop {
        if body.len() >= limit {
            let truncated = declared.map(|len| len > body.len() as u64).unwrap_or(true);
            return Ok((body, truncated));
        }

        let Some(chunk) = response.chunk().await? else {
            return Ok((body, false));
        };

        if chunk.is_empty() {
            continue;
        }

        if extend_bounded(&mut body, &chunk, limit) {
            return Ok((body, true));
        }
    }
}

fn declared_length(response: &reqwest::Response) -> Option<u64> {
    let header = response.headers().get(reqwest::header::CONTENT_LENGTH)?;
    header.to_str().ok()?.trim().parse().ok()
}

fn extend_bounded(body: &mut Vec<u8>, chunk: &[u8], limit: usize) -> bool {
    let room = limit.saturating_sub(body.len());

    if chunk.len() > room {
        body.extend_from_slice(&chunk[..room]);
        true
    } else {
        body.extend_from_slice(chunk);
        false
    }
}

fn down(kind: &str, err: reqwest::Error) -> String {
    if err.is_connect() || err.is_timeout() {
        format!("{kind} is not running")
    } else {
        err.to_string()
    }
}

fn clip(bytes: &[u8], truncated: bool) -> String {
    let mut text = String::from_utf8_lossy(bytes).into_owned();

    if truncated && text.ends_with('\u{FFFD}') {
        text.pop();
    }

    if truncated {
        text.push_str("\ntruncated");
    }

    text
}

#[cfg(test)]
#[path = "transport_test.rs"]
mod tests;
