// Prevents additional console window on Windows, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dependency_on_unit_never_type_fallback)]

// 半自动浏览器填充：全局热键（默认 Ins）→ 把待填账号/密码粘贴进当前焦点输入框
mod autofill;
mod github_backup;
pub use github_backup::*;
use autofill::{start_autofill, AutofillState, FillTarget};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;

use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

// 用系统文件管理器打开指定文件夹（Windows 下调用 explorer）
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("\"{}\"", path))
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }
    Ok(())
}

// 返回可执行文件所在目录（软件根目录），用于存放用户数据（壁纸/图标/备份）
#[tauri::command]
fn get_exe_dir() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("{}", e))?;
    let dir = exe
        .parent()
        .ok_or("no parent dir")?
        .to_string_lossy()
        .to_string();
    Ok(dir)
}

// 解析内置资源文件：依次尝试 resourceDir/name 与 exeDir/resources/name，
// 返回第一个真实存在的路径；都不存在则回退 exeDir/resources/name（交给上层报错）
#[tauri::command]
fn resolve_resource(app: tauri::AppHandle, name: String) -> String {
    use tauri::Manager;
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        candidates.push(format!("{}/{}", rd.to_string_lossy(), name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(format!("{}/resources/{}", parent.to_string_lossy(), name));
        }
    }
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return c.clone();
        }
    }
    candidates.last().cloned().unwrap_or_default()
}

// 以下命令用 std::fs 直接读写，绕过 fs 插件的作用域限制（备份/媒体放在 exe 同级目录）
#[tauri::command]
fn create_dir_all(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("{}", e))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, contents.as_bytes()).map_err(|e| format!("{}", e))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{}", e))
}

#[tauri::command]
fn list_dir_names(path: String) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    match std::fs::read_dir(&path) {
        Ok(rd) => {
            for entry in rd.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    out.push(name.to_string());
                }
            }
            Ok(out)
        }
        Err(_) => Ok(out),
    }
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    let _ = std::fs::remove_file(&path);
    Ok(())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn file_size(path: String) -> i64 {
    match std::fs::metadata(&path) {
        Ok(m) => m.len() as i64,
        Err(_) => 0,
    }
}

#[tauri::command]
fn copy_file(src: String, dst: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&dst).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::copy(&src, &dst)
        .map_err(|e| format!("{}", e))
        .map(|_| ())
}

#[tauri::command]
fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, &data).map_err(|e| format!("{}", e))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("{}", e))
}

// 半自动填充：前端写入"待填账号/密码"
#[tauri::command]
fn set_fill_target(state: tauri::State<Arc<AutofillState>>, target: Option<FillTarget>) {
    *state.target.lock().unwrap() = target;
    // 刷新活跃时刻（避免刚设置就被闲置判定清除）
    *state.last_active.lock().unwrap() = Instant::now();
}

// 半自动填充：前端更新热键（字符串，如 "Ins"）
#[tauri::command]
fn set_autofill_hotkey(state: tauri::State<Arc<AutofillState>>, hotkey: String) {
    *state.hotkey.lock().unwrap() = hotkey;
}

// 半自动填充：前端更新选项（填充后是否重置待填账号）
#[tauri::command]
fn set_autofill_options(state: tauri::State<Arc<AutofillState>>, reset_after_use: bool) {
    *state.reset_after_use.lock().unwrap() = reset_after_use;
}

// 锁定策略：免验证时长是否开启。关闭时，关到托盘/最小化再开必须重新输密码
struct LockPolicy {
    grace_enabled: Mutex<bool>,
}

// 前端同步免验证时长开关状态
#[tauri::command]
fn set_grace_enabled(state: tauri::State<Arc<LockPolicy>>, enabled: bool) {
    *state.grace_enabled.lock().unwrap() = enabled;
}

fn main() {
    tauri::Builder::default()
        // 单实例：多次双击 exe 只保留一个应用，新实例聚焦已有窗口并退出
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(AutofillState::new()))
        .manage(Arc::new(LockPolicy { grace_enabled: Mutex::new(false) }))
        .setup(|app| {
            // 系统托盘：Show / Lock / Quit
            let show_i = MenuItem::with_id(app, "show", "打开 FallVault", true, None::<&str>)?;
            let lock_i = MenuItem::with_id(app, "lock", "锁定", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &lock_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("FallVault")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            // 已可见：只聚焦，不打扰正在使用的用户
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.set_focus();
                            } else {
                                // 从「关闭到托盘」恢复：若未开启免验证时长，则强制重新锁定（要求重输密码）
                                let grace = *app.state::<Arc<LockPolicy>>().grace_enabled.lock().unwrap();
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                                if !grace {
                                    let _ = app.emit("fallvault:lock", ());
                                }
                            }
                        }
                    }
                    "lock" => {
                        let _ = app.emit("fallvault:lock", ());
                    }
                    "quit" => {
                        std::process::exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // 关闭窗口 → 最小化到托盘（不退出）；未开启免验证时长则要求重输密码
            if let Some(win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                win.clone().on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let grace = *app_handle.state::<Arc<LockPolicy>>().grace_enabled.lock().unwrap();
                        if !grace {
                            let _ = app_handle.emit("fallvault:lock", ());
                        }
                        let _ = win.hide();
                    }
                });
            }

            // 启动半自动填充全局热键监听
            {
                let state = app.state::<Arc<AutofillState>>();
                start_autofill(app.app_handle().clone(), state.inner().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            get_exe_dir,
            create_dir_all,
            write_text_file,
            read_text_file,
            list_dir_names,
            remove_file,
            file_exists,
            file_size,
            copy_file,
            write_file_bytes,
            read_file_bytes,
            resolve_resource,
            set_fill_target,
            set_autofill_hotkey,
            set_autofill_options,
            set_grace_enabled,
            github_list_repos,
            github_upload_backup,
            github_download_backup,
            github_cred_save,
            github_cred_get,
            github_cred_delete,
            github_save_index,
            github_load_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
