use std::io::Read;
use std::time::Duration;

const MAX_HTML_BYTES: u64 = 1024 * 1024;

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(start) = rest.find('&') {
        output.push_str(&rest[..start]);
        rest = &rest[start..];

        let Some(end) = rest.find(';') else {
            output.push_str(rest);
            return output;
        };
        if end > 12 {
            output.push('&');
            rest = &rest[1..];
            continue;
        }

        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "nbsp" => Some(' '),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => {
                entity[1..].parse::<u32>().ok().and_then(char::from_u32)
            }
            _ => None,
        };

        if let Some(ch) = decoded {
            output.push(ch);
        } else {
            output.push_str(&rest[..=end]);
        }
        rest = &rest[end + 1..];
    }

    output.push_str(rest);
    output
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

fn extract_title(html: &str) -> Option<String> {
    let title_start = find_ascii_case_insensitive(html, "<title")?;
    let content_offset = html[title_start..].find('>')? + 1;
    let content_start = title_start + content_offset;
    let content_end =
        find_ascii_case_insensitive(&html[content_start..], "</title")? + content_start;
    let decoded = decode_html_entities(&html[content_start..content_end]);
    let normalized = decoded.split_whitespace().collect::<Vec<_>>().join(" ");

    if normalized.is_empty() {
        None
    } else {
        Some(normalized.chars().take(200).collect())
    }
}

fn fetch_title_blocking(url: String) -> Result<Option<String>, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "网页地址格式不正确".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 HTTP 或 HTTPS 网页".into());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) FallVault/1.1")
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("初始化网页请求失败: {e}"))?;

    let response = client
        .get(parsed)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|e| format!("读取网页失败: {e}"))?;

    if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        let value = content_type
            .to_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !value.contains("text/html") && !value.contains("application/xhtml+xml") {
            return Ok(None);
        }
    }

    let mut bytes = Vec::new();
    response
        .take(MAX_HTML_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取网页内容失败: {e}"))?;
    Ok(extract_title(&String::from_utf8_lossy(&bytes)))
}

#[tauri::command]
pub async fn fetch_website_title(url: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_title_blocking(url))
        .await
        .map_err(|e| format!("网页标题任务失败: {e}"))?
}
