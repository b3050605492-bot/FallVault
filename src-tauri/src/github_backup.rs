// GitHub 备份同步：把本地加密的 .fvault 备份上传到用户私有仓库（或下载回来）。
// 仅同步「已加密的 .fvault 文件」——绝不触碰主密码明文，安全问题不甩给仓库明文。
// 注意：所有网络/解析错误一律返回 Err(String)，绝不 unwrap panic（否则会拖垮整个 app 黑屏）。
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const API: &str = "https://api.github.com";
const FILE_NAME: &str = "fallvault-backup.fvault";
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(serde::Serialize)]
pub struct GhRepo {
    pub full_name: String,
}

// 构建基础 client（含超时）。不在这里拼 Authorization，改用请求级的 bearer_auth，避免 HeaderValue 解析 panic。
fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("FallVault")
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("初始化网络失败：{}", e))
}

// 列出当前 token 可访问的仓库（取 full_name）
#[tauri::command]
pub async fn github_list_repos(token: String) -> Result<Vec<GhRepo>, String> {
    let cli = build_client()?;
    let resp = cli
        .get(format!("{}/user/repos?per_page=100&sort=updated", API))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("请求失败（网络或代理问题？）：{}", e))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        return Err(format!("GitHub 返回错误 {}（token 无效或无权限？）", code));
    }
    let arr: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("解析失败：{}", e))?;
    let mut out = Vec::new();
    for r in arr {
        if let Some(name) = r.get("full_name").and_then(|v| v.as_str()) {
            out.push(GhRepo {
                full_name: name.to_string(),
            });
        }
    }
    if out.is_empty() {
        return Err("该 token 下没有可访问的仓库（确认 token 有 repo 权限）".into());
    }
    Ok(out)
}

// 找出 backups 目录里最新的 .fvault（按修改时间）
fn latest_backup(backup_dir: &Path) -> Result<String, String> {
    if !backup_dir.exists() {
        return Err("备份目录不存在，请先做一次备份".into());
    }
    let mut best: Option<(u64, String)> = None;
    for entry in fs::read_dir(backup_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("fvault") {
            let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let path = p.to_string_lossy().to_string();
            if best.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
                best = Some((mtime, path));
            }
        }
    }
    best.map(|(_, p)| p)
        .ok_or_else(|| "没有找到任何 .fvault 备份，请先做一次备份".into())
}

// 上传最新备份到仓库
#[tauri::command]
pub async fn github_upload_backup(
    token: String,
    repo: String,
    data_dir: String,
) -> Result<String, String> {
    let backup_dir = Path::new(&data_dir).join("backups");
    let src = latest_backup(&backup_dir)?;
    let bytes = fs::read(&src).map_err(|e| format!("读取备份失败：{}", e))?;
    let b64 = B64.encode(&bytes);

    let cli = build_client()?;
    let url = format!("{}/repos/{}/contents/{}", API, repo, FILE_NAME);
    // 先看是否已存在（需要 sha 才能更新）
    let sha = match cli
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let j: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
            j.get("sha").and_then(|v| v.as_str()).map(|s| s.to_string())
        }
        _ => None,
    };

    let mut body = HashMap::new();
    body.insert("message", "FallVault backup update".to_string());
    body.insert("content", b64);
    if let Some(s) = sha {
        body.insert("sha", s);
    }

    let resp = cli
        .put(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("上传失败（网络或代理问题？）：{}", e))?;
    if resp.status().is_success() {
        Ok(format!("已上传到 {}/{}", repo, FILE_NAME))
    } else {
        let code = resp.status().as_u16();
        Err(format!(
            "上传失败，GitHub 返回 {}（仓库名对吗？需 owner/name 格式，且 token 有写权限）",
            code
        ))
    }
}

// 从仓库下载备份到本地 backups 目录
#[tauri::command]
pub async fn github_download_backup(
    token: String,
    repo: String,
    data_dir: String,
) -> Result<String, String> {
    let backup_dir = Path::new(&data_dir).join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let cli = build_client()?;
    let url = format!("{}/repos/{}/contents/{}", API, repo, FILE_NAME);
    let resp = cli
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("下载失败（网络或代理问题？）：{}", e))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("仓库里还没有 FallVault 备份，请先上传一次".into());
    }
    if !resp.status().is_success() {
        return Err(format!("下载失败，GitHub 返回 {}", resp.status().as_u16()));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let content = j
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "返回数据缺少 content".to_string())?;
    let clean = content.replace('\n', "").replace('\r', "");
    let bytes = B64
        .decode(clean)
        .map_err(|e| format!("解码失败：{}", e))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = backup_dir.join(format!("github-{}.fvault", stamp));
    fs::write(&dest, &bytes).map_err(|e| format!("写入失败：{}", e))?;
    Ok(format!("已下载到 {}", dest.to_string_lossy()))
}
