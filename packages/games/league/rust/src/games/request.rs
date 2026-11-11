pub(crate) struct LcuCall {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) body: Option<String>,
}

pub(crate) fn parse_live(input: &str) -> Result<String, String> {
    let text = input.trim();
    let path = if text.is_empty() {
        "/liveclientdata/allgamedata"
    } else if text.contains('\n') || text.contains('\r') {
        return Err("live client input is one path".to_string());
    } else {
        text
    };
    let route = path.split('?').next().unwrap_or(path);

    if !route.starts_with("/liveclientdata/") {
        return Err("live client path must start with /liveclientdata/".to_string());
    }

    local_path(path)
}

pub(crate) fn parse_lcu(input: &str) -> Result<LcuCall, String> {
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

fn local_path(input: &str) -> Result<String, String> {
    if input.bytes().any(|byte| byte < 0x20 || byte == 0x7f) {
        return Err("league path is not allowed".to_string());
    }

    let (path, query) = match input.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (input, None),
    };

    if !path.starts_with('/') || path.starts_with("//") {
        return Err("league path must start with /".to_string());
    }

    if path_is_unsafe(path) {
        return Err("league path is not allowed".to_string());
    }

    if let Some(query) = query {
        if query_is_unsafe(query) {
            return Err("league path is not allowed".to_string());
        }

        return Ok(format!("{}?{}", encode_path(path), encode_query(query)));
    }

    Ok(encode_path(path))
}

fn path_is_unsafe(path: &str) -> bool {
    repeats_unsafe(path, path_text_is_unsafe)
}

fn query_is_unsafe(query: &str) -> bool {
    repeats_unsafe(query, query_text_is_unsafe)
}

fn repeats_unsafe(text: &str, unsafe_text: impl Fn(&str) -> bool) -> bool {
    let mut current = text.to_string();

    for _ in 0..4 {
        if unsafe_text(&current) {
            return true;
        }

        let decoded = percent_decode_lossy(&current);

        if decoded == current {
            return false;
        }

        current = decoded;
    }

    unsafe_text(&current)
}

fn path_text_is_unsafe(path: &str) -> bool {
    if !path.is_ascii()
        || path.contains('\\')
        || path.contains('@')
        || path.contains("://")
        || path.contains("//")
    {
        return true;
    }

    if path
        .bytes()
        .any(|byte| byte.is_ascii_whitespace() || byte < 0x20 || byte == 0x7f)
    {
        return true;
    }

    path.split('/').any(|segment| segment == "..")
}

fn query_text_is_unsafe(query: &str) -> bool {
    query.contains("://")
        || query.contains('\\')
        || query.contains('@')
        || query.contains("//")
        || query.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
}

fn encode_path(path: &str) -> String {
    let mut encoded = String::new();

    for (index, segment) in path.split('/').enumerate() {
        if index > 0 {
            encoded.push('/');
        }

        encoded.push_str(&encode_component(segment));
    }

    encoded
}

fn encode_query(query: &str) -> String {
    let mut encoded = String::new();

    for (index, pair) in query.split('&').enumerate() {
        if index > 0 {
            encoded.push('&');
        }

        match pair.split_once('=') {
            Some((key, value)) => {
                encoded.push_str(&encode_component(key));
                encoded.push('=');
                encoded.push_str(&encode_component(value));
            }
            None => encoded.push_str(&encode_component(pair)),
        }
    }

    encoded
}

fn encode_component(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut encoded = String::new();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && is_hex(bytes[index + 1])
            && is_hex(bytes[index + 2])
        {
            encoded.push('%');
            encoded.push(bytes[index + 1] as char);
            encoded.push(bytes[index + 2] as char);
            index += 3;
            continue;
        }

        let ch = match raw[index..].chars().next() {
            Some(ch) => ch,
            None => break,
        };

        if is_unreserved(ch) {
            encoded.push(ch);
        } else {
            let mut buf = [0_u8; 4];

            for byte in ch.encode_utf8(&mut buf).as_bytes() {
                push_percent(&mut encoded, *byte);
            }
        }

        index += ch.len_utf8();
    }

    encoded
}

fn percent_decode_lossy(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && is_hex(bytes[index + 1])
            && is_hex(bytes[index + 2])
        {
            decoded.push(hex_byte(bytes[index + 1], bytes[index + 2]));
            index += 3;
            continue;
        }

        let ch = match input[index..].chars().next() {
            Some(ch) => ch,
            None => break,
        };
        let mut buf = [0_u8; 4];
        decoded.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
        index += ch.len_utf8();
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn is_unreserved(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_' | '~')
}

fn is_hex(byte: u8) -> bool {
    byte.is_ascii_hexdigit()
}

fn hex_byte(hi: u8, lo: u8) -> u8 {
    (hex_value(hi) << 4) | hex_value(lo)
}

fn hex_value(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

fn push_percent(out: &mut String, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    out.push('%');
    out.push(HEX[(byte >> 4) as usize] as char);
    out.push(HEX[(byte & 0x0f) as usize] as char);
}

#[cfg(test)]
#[path = "request_test.rs"]
mod tests;
