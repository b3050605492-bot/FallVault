// FallVault 浏览器桥接服务：本地 HTTP 服务，供浏览器扩展调用
//  - POST /api/pair        下发配对 token（首次调用时生成，存数据库）
//  - GET  /api/entries?host=xxx   查询指定网站的账号列表（需 token）
//  - POST /api/entries     保存新账号（需 token）
//  - GET  /api/ping        健康检查
//
// 安全：仅监听 127.0.0.1，请求需带 X-FallVault-Token 头（与数据库配对 token 一致）
// CORS 放宽用于扩展 origin，但因带自定义头 + 非标准端口 + 本地地址，实际外部网页无法利用。

use std::sync::{Arc, Mutex};
use rusqlite::{Connection, params};
use serde_json::{json, Value};
use tiny_http::{Server, Response, Header};

const PORT: u16 = 6666;

struct BridgeState {
    db_path: String,
}

// ---------- 数据库辅助 ----------
fn open_db(path: &str) -> Result<Connection, String> {
    Connection::open(path).map_err(|e| e.to_string())
}

fn ensure_pair_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bridge_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    ).map_err(|e| e.to_string())
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn.prepare("SELECT value FROM bridge_settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query_map(params![key], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(Ok(v)) => Ok(Some(v)),
        _ => Ok(None),
    }
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO bridge_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_or_create_token(db_path: &str) -> Result<String, String> {
    let conn = open_db(db_path)?;
    ensure_pair_table(&conn)?;
    if let Some(t) = get_setting(&conn, "pair_token")? {
        return Ok(t);
    }
    let token: String = format!("fv{}{}", rand::random::<u32>() % 10000 + 1000, rand::random::<u32>() % 10000 + 1000);
    set_setting(&conn, "pair_token", &token)?;
    Ok(token)
}

// ---------- 账号查询 ----------
fn list_entries_for_host(conn: &Connection, host: &str) -> Result<Vec<Value>, String> {
    let host_lower = host.to_lowercase().trim().to_string();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, username, password, website, notes, folder_id, icon
             FROM entries
             WHERE website IS NOT NULL AND website != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, Option<i64>>(6)?,
            r.get::<_, String>(7)?,
        ))
    })
    .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        if let Ok((id, title, username, password, website, notes, folder_id, icon)) = row {
            // 匹配：website 包含 host 或 host 包含 website 域名主干
            let w = website.to_lowercase();
            let matches_host = w.contains(&host_lower)
                || host_lower.contains(&w.split('/').nth(2).unwrap_or("").to_lowercase());
            if matches_host {
                out.push(json!({
                    "id": id,
                    "title": title,
                    "username": username,
                    "password": password,
                    "website": website,
                    "notes": notes,
                    "folder_id": folder_id,
                    "icon": icon,
                }));
            }
        }
    }
    Ok(out)
}

// ---------- 保存账号 ----------
fn create_entry(conn: &Connection, body: &Value) -> Result<Value, String> {
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let username = body.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let website = body.get("website").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let folder_id = body.get("folder_id").and_then(|v| v.as_i64());
    let favorite = body.get("is_favorite").and_then(|v| v.as_i64()).unwrap_or(0);

    if title.trim().is_empty() {
        return Err("title required".into());
    }
    if password.trim().is_empty() {
        return Err("password required".into());
    }

    conn.execute(
        "INSERT INTO entries (title, username, password, website, notes, icon, folder_id, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, 'Globe', ?6, ?7)",
        params![title, username, password, website, notes, folder_id, favorite],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(json!({ "id": id, "title": title }))
}

fn json_response(status: u16, body: Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let data = body.to_string();
    let r = Response::from_string(data)
        .with_status_code(status)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap())
        .with_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type, X-FallVault-Token"[..]).unwrap());
    r
}

fn text_response(status: u16, text: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(text.to_string())
        .with_status_code(status)
}

pub fn start_bridge(db_path: String) -> Result<(), String> {
    let server = Server::http(&format!("127.0.0.1:{}", PORT)).map_err(|e| e.to_string())?;
    let state = Arc::new(Mutex::new(BridgeState { db_path }));

    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let st = state.clone();
            let method = request.method().to_string();
            let url = request.url().to_string();

            // CORS 预检
            if method == "OPTIONS" {
                let _ = request.respond(json_response(200, json!("ok")));
                continue;
            }

            // 读取 body
            let mut body_str = String::new();
            let _ = request.as_reader().read_to_string(&mut body_str);

            let st = st.lock().unwrap();
            let conn = match open_db(&st.db_path) {
                Ok(c) => c,
                Err(e) => {
                    let _ = request.respond(text_response(500, &format!("db error: {}", e)));
                    continue;
                }
            };

            // 路由
            let path = url.split('?').next().unwrap_or("");
            let resp: Result<Value, String> = match path {
                "/api/ping" => Ok(json!({ "ok": true, "app": "FallVault", "version": "1.0.0" })),
                "/api/pair" if method == "POST" => {
                    // 安全配对：接收用户从 FallVault 设置面板复制的配对码
                    let code: String = serde_json::from_str::<Value>(&body_str)
                        .ok()
                        .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(|s| s.to_string()))
                        .unwrap_or_default();
                    let saved = match get_or_create_token(&st.db_path) {
                        Ok(t) => t,
                        Err(err) => {
                            let _ = request.respond(json_response(500, json!({ "error": err })));
                            continue;
                        }
                    };
                    if saved == code {
                        Ok(json!({ "ok": true }))
                    } else {
                        Err("invalid code".to_string())
                    }
                }
                "/api/entries" if method == "GET" => {
                    // 鉴权
                    let token = request.headers()
                        .iter()
                        .find(|h| h.field.equiv("X-FallVault-Token"))
                        .map(|h| h.value.as_str().to_string());
                    let saved = get_setting(&conn, "pair_token").unwrap_or(None);
                    if saved.is_none() || token.is_none() || saved.as_deref() != token.as_deref() {
                        Err("unauthorized".to_string())
                    } else {
                        // 简单解析 query
                        let q = url.split('?').nth(1).unwrap_or("");
                        let host_val = q.split('&')
                            .find(|kv| kv.starts_with("host="))
                            .map(|kv| kv[5..].to_string())
                            .unwrap_or_default();
                        let entries = match list_entries_for_host(&conn, &host_val) {
                            Ok(e) => e,
                            Err(err) => {
                                let _ = request.respond(json_response(500, json!({ "error": err })));
                                continue;
                            }
                        };
                        Ok(json!({ "entries": entries }))
                    }
                }
                "/api/entries" if method == "POST" => {
                    let token = request.headers()
                        .iter()
                        .find(|h| h.field.equiv("X-FallVault-Token"))
                        .map(|h| h.value.as_str().to_string());
                    let saved = get_setting(&conn, "pair_token").unwrap_or(None);
                    if saved.is_none() || token.is_none() || saved.as_deref() != token.as_deref() {
                        Err("unauthorized".to_string())
                    } else {
                        let body: Value = serde_json::from_str(&body_str).unwrap_or(json!({}));
                        create_entry(&conn, &body)
                    }
                }
                _ => Err("not found".to_string()),
            };

            match resp {
                Ok(v) => {
                    let _ = request.respond(json_response(200, v));
                }
                Err(msg) => {
                    let status = if msg == "unauthorized" { 401 } else if msg == "invalid code" { 403 } else if msg == "not found" { 404 } else { 500 };
                    let _ = request.respond(json_response(status, json!({ "error": msg })));
                }
            }
        }
    });

    Ok(())
}

// Tauri 命令：获取配对 token（设置面板显示用）
#[tauri::command]
pub fn get_bridge_token_command(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = dir.join("fallvault.db");
    get_or_create_token(&db_path.to_string_lossy())
}
