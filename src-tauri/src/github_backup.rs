// GitHub 备份同步：把本地加密的 .fvault 备份上传到用户私有仓库（或下载回来）。
// 仅同步「已加密的 .fvault 文件」——绝不触碰主密码明文，安全问题不甩给仓库明文。
// 安全原则：所有命令体用 catch_unwind 包裹，任何 panic 都转成 Err 返回（弹提示），绝不 abort 进程黑屏。
// 令牌（PAT）只存本机 Windows 凭据管理器（Win32 Cred API，CRED_PERSIST_LOCAL_MACHINE），不进仓库、不进 git、不进 .fvault。
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::panic;
use std::path::Path;
use std::ptr::null_mut;
use std::time::{Duration, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{GetLastError, FILETIME, SYSTEMTIME};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};
use windows_sys::Win32::System::SystemInformation::GetLocalTime;

const API: &str = "https://api.github.com";
const MD_NAME: &str = "README.md";
const TIMEOUT: Duration = Duration::from_secs(20);
const SOURCE_REPO: &str = "https://github.com/b3050605492-bot/FallVault";

#[derive(Serialize)]
pub struct GhRepo {
    pub full_name: String,
}

// 构建阻塞式 client（禁用代理，避免 Clash 等干扰；带超时）。
fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("FallVault")
        .timeout(TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|e| format!("初始化网络失败：{}", e))
}

// 把可能 panic 的逻辑包起来：panic -> Err，绝不黑屏。
fn safe_run<T>(f: impl FnOnce() -> Result<T, String> + panic::UnwindSafe) -> Result<T, String> {
    panic::catch_unwind(f)
        .map_err(|_| "GitHub 操作发生内部错误，已被安全拦截（程序未崩溃）".to_string())?
}

// 本地索引文件路径：%APPDATA%/FallVault/github_index.json
// 仅存仓库名列表 + 令牌 label 列表 + 各仓库上次备份时间（不含令牌本身，令牌在凭据管理器）
fn index_path() -> Result<String, String> {
    let base =
        std::env::var("APPDATA").map_err(|_| "找不到 APPDATA 目录".to_string())?;
    let dir = Path::new(&base).join("FallVault");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("github_index.json").to_string_lossy().to_string())
}

// ---- 令牌存储（Windows 凭据管理器，手写 Win32 API，CRED_PERSIST_LOCAL_MACHINE 跨进程可读） ----
const CRED_PREFIX: &str = "FallVault-GitHub:"; // target name 前缀，后接 label

fn cred_target(label: &str) -> String {
    format!("{}{}", CRED_PREFIX, label)
}

fn to_wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn cred_set(target: &str, secret: &str) -> Result<(), String> {
    let mut target_w = to_wstr(target);
    let mut user_w = to_wstr("fallvault");
    let mut comment_w = to_wstr("FallVault GitHub token");
    let blob: Vec<u8> = secret.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_w.as_mut_ptr(),
        Comment: comment_w.as_mut_ptr(),
        LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: null_mut(),
        TargetAlias: null_mut(),
        UserName: user_w.as_mut_ptr(),
    };
    // SAFETY: cred 生命周期覆盖 CredWriteW 调用；blob 由 cred 引用，同样存活
    let r = unsafe { CredWriteW(&cred as *const CREDENTIALW, 0) };
    if r == 0 {
        return Err(format!("保存令牌失败（系统错误 {}）", unsafe { GetLastError() }));
    }
    Ok(())
}

fn cred_get(target: &str) -> Result<String, String> {
    let target_w = to_wstr(target);
    let mut pcred = null_mut();
    // SAFETY: CredReadW 成功时会分配 *pcred，随后在我们手里 CredFree
    let r = unsafe { CredReadW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pcred) };
    if r == 0 {
        return Err("找不到该令牌（可能已被删除）".to_string());
    }
    unsafe {
        let cred = &*pcred;
        let blob = std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        let s = String::from_utf8_lossy(blob).to_string();
        CredFree(pcred as *mut _);
        Ok(s)
    }
}

fn cred_delete(target: &str) -> Result<(), String> {
    let target_w = to_wstr(target);
    let r = unsafe { CredDeleteW(target_w.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if r == 0 {
        return Err(format!("删除令牌失败（系统错误 {}）", unsafe { GetLastError() }));
    }
    Ok(())
}

#[tauri::command]
pub fn github_cred_save(label: String, token: String) -> Result<(), String> {
    if label.trim().is_empty() {
        return Err("令牌名称不能为空".to_string());
    }
    cred_set(&cred_target(&label), &token)
}

#[tauri::command]
pub fn github_cred_get(label: String) -> Result<String, String> {
    cred_get(&cred_target(&label))
}

#[tauri::command]
pub fn github_cred_delete(label: String) -> Result<(), String> {
    cred_delete(&cred_target(&label))
}

// ---- 本地索引（仓库列表 / 令牌 label / 备份时间） ----
#[tauri::command]
pub fn github_save_index(json: String) -> Result<(), String> {
    let path = index_path()?;
    fs::write(&path, json).map_err(|e| format!("写入索引失败：{}", e))
}

#[tauri::command]
pub fn github_load_index() -> String {
    let path = match index_path() {
        Ok(p) => p,
        Err(_) => return "{}".to_string(),
    };
    fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string())
}

// 列出当前 token 可访问的仓库（取 full_name）
#[tauri::command]
pub fn github_list_repos(token: String) -> Result<Vec<GhRepo>, String> {
    safe_run(|| {
        let cli = build_client()?;
        let resp = cli
            .get(format!("{}/user/repos?per_page=100&sort=updated", API))
            .bearer_auth(&token)
            .send()
            .map_err(|e| format!("请求失败（网络或代理问题？）：{}", e))?;
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            return Err(format!("GitHub 返回错误 {}（token 无效或无权限？）", code));
        }
        let arr: Vec<serde_json::Value> = resp
            .json()
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
    })
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
    best
        .map(|(_, p)| p)
        .ok_or_else(|| "没有找到任何 .fvault 备份，请先做一次备份".into())
}

// 生成/更新 README_FallVault_Backup.md（首次备份创建，之后仅保留；不含任何密码）
fn ensure_readme(cli: &reqwest::blocking::Client, token: &str, repo: &str) -> Result<(), String> {
    let url = format!("{}/repos/{}/contents/{}", API, repo, MD_NAME);
    let exists = matches!(cli.get(&url).bearer_auth(token).send(), Ok(r) if r.status().is_success());
    if exists {
        return Ok(()); // 已存在则不动，避免覆盖用户可能修改的说明
    }
    let body = format!(
        "# FallVault 备份仓库\n\n\
此仓库由 [FallVault]({}) 自动备份使用，里面只存放**已加密**的 `fallvault-backup-*.fvault` 文件（文件名带时间，每次备份一个）。\n\n\
## 重要说明\n\
- 备份文件用你的 **FallVault 主密码** 加密（AES-256-GCM），文件名形如 `fallvault-backup-2026-08-22-14:18:05.fvault`。\n\
- 恢复备份时，请在 FallVault 的「加密备份」里选择该文件，并输入你的**主密码**解密。\n\
- **主密码不会、也绝不会上传到任何仓库或云端**，请务必牢记自己的主密码。\n\
- 本文件不含任何明文凭据。\n\n\
## 源码\n\
{}\n",
        SOURCE_REPO, SOURCE_REPO
    );
    let mut map = HashMap::new();
    map.insert("message", "Add FallVault backup README".to_string());
    map.insert("content", B64.encode(body.as_bytes()));
    cli.put(&url)
        .bearer_auth(token)
        .json(&map)
        .send()
        .map_err(|e| format!("创建说明文档失败：{}", e))?;
    Ok(())
}

// 本地可读时间戳 YYYY-MM-DD-HH:MM:SS（用 Windows GetLocalTime，非 UTC；分隔符 GitHub 安全）
fn local_ts() -> String {
    let mut st: SYSTEMTIME = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut st) };
    let p = |n: u16| format!("{:02}", n);
    format!(
        "{}-{}-{}-{}:{}:{}",
        st.wYear, p(st.wMonth), p(st.wDay), p(st.wHour), p(st.wMinute), p(st.wSecond)
    )
}

// 备份文件名（带本地时间，分隔符清晰）：fallvault-backup-YYYY-MM-DD-HH:MM:SS.fvault
fn backup_filename() -> String {
    format!("fallvault-backup-{}.fvault", local_ts())
}

// 列出仓库里所有 fallvault-backup-*.fvault 文件（返回 (文件名, sha)）
fn list_backup_files(
    cli: &reqwest::blocking::Client,
    token: &str,
    repo: &str,
) -> Result<Vec<(String, String)>, String> {
    let url = format!("{}/repos/{}/contents/", API, repo);
    let resp = cli
        .get(&url)
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("列举文件失败：{}", e))?;
    if !resp.status().is_success() {
        return Ok(vec![]);
    }
    let arr: Vec<serde_json::Value> = resp.json().map_err(|e| e.to_string())?;
    let mut out = vec![];
    for item in arr {
        if let (Some(name), Some(sha)) = (
            item.get("name").and_then(|v| v.as_str()),
            item.get("sha").and_then(|v| v.as_str()),
        ) {
            if name.starts_with("fallvault-backup-") && name.ends_with(".fvault") {
                out.push((name.to_string(), sha.to_string()));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0)); // 文件名时间戳升序，最新的在最后
    Ok(out)
}

// 删除仓库里指定的备份文件（按 sha）
fn delete_remote_file(
    cli: &reqwest::blocking::Client,
    token: &str,
    repo: &str,
    name: &str,
    sha: &str,
) -> Result<(), String> {
    let url = format!("{}/repos/{}/contents/{}", API, repo, name);
    let mut body = HashMap::new();
    body.insert("message", format!("Prune old backup {}", name));
    body.insert("sha", sha.to_string());
    cli.delete(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .map_err(|e| format!("删除旧备份失败：{}", e))?;
    Ok(())
}

// 最多保留的仓库备份份数
const KEEP_MAX: usize = 10;

// 上传最新备份到仓库（每次生成带时间的新文件名，并清理旧备份；首次创建说明 md）
#[tauri::command]
pub fn github_upload_backup(token: String, repo: String, data_dir: String) -> Result<String, String> {
    safe_run(|| {
        let backup_dir = Path::new(&data_dir).join("backups");
        let src = latest_backup(&backup_dir)?;
        let bytes = fs::read(&src).map_err(|e| format!("读取备份失败：{}", e))?;
        let b64 = B64.encode(&bytes);

        let cli = build_client()?;

        // 首次备份时生成说明 md（不含密码）
        ensure_readme(&cli, &token, &repo)?;

        // 每次一个新的带时间文件名，不再覆盖同一个
        let fname = backup_filename();
        let url = format!("{}/repos/{}/contents/{}", API, repo, fname);
        let mut body = HashMap::new();
        body.insert("message", format!("FallVault backup {}", fname));
        body.insert("content", b64);

        let resp = cli
            .put(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .map_err(|e| format!("上传失败（网络或代理问题？）：{}", e))?;
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            return Err(format!(
                "上传失败，GitHub 返回 {}（仓库名对吗？需 owner/name 格式，且 token 有写权限）",
                code
            ));
        }

        // 清理：只保留最近 KEEP_MAX 份
        let mut files = list_backup_files(&cli, &token, &repo)?;
        while files.len() > KEEP_MAX {
            let (old_name, old_sha) = files.remove(0);
            let _ = delete_remote_file(&cli, &token, &repo, &old_name, &old_sha);
        }

        Ok(format!("已上传到 {}/{}（{}）", repo, fname, local_ts()))
    })
}

// 从仓库下载「所有」备份文件：返回 [(文件名, base64内容)]，由前端让用户选文件夹批量保存
#[tauri::command]
pub fn github_download_backup(token: String, repo: String) -> Result<serde_json::Value, String> {
    safe_run(|| {
        let cli = build_client()?;
        // 列出所有备份（按文件名升序，最旧的在前）
        let files = list_backup_files(&cli, &token, &repo)?;
        if files.is_empty() {
            return Err("仓库里还没有 FallVault 备份，请先上传一次".into());
        }
        let mut items: Vec<serde_json::Value> = Vec::new();
        for (fname, _sha) in files {
            let url = format!("{}/repos/{}/contents/{}", API, repo, fname);
            let resp = cli
                .get(&url)
                .bearer_auth(&token)
                .send()
                .map_err(|e| format!("下载失败（网络或代理问题？）：{}", e))?;
            if !resp.status().is_success() {
                return Err(format!("下载 {} 失败，GitHub 返回 {}", fname, resp.status().as_u16()));
            }
            let j: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
            let content = j
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("{} 返回数据缺少 content", fname))?;
            let clean = content.replace('\n', "").replace('\r', "");
            let bytes = B64.decode(clean).map_err(|e| format!("{} 解码失败：{}", fname, e))?;
            let mut obj = serde_json::Map::new();
            obj.insert("filename".into(), serde_json::Value::String(fname));
            obj.insert("content".into(), serde_json::Value::String(B64.encode(&bytes)));
            items.push(serde_json::Value::Object(obj));
        }
        let mut out = serde_json::Map::new();
        out.insert("files".into(), serde_json::Value::Array(items));
        Ok(serde_json::Value::Object(out))
    })
}
