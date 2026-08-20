// Prevents additional console window on Windows, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    std::fs::copy(&src, &dst).map_err(|e| format!("{}", e)).map(|_| ())
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
                            let _ = w.show();
                            let _ = w.set_focus();
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

            // 关闭窗口 → 锁定的同时最小化到托盘（不退出）
            if let Some(win) = app.get_webview_window("main") {
                win.clone().on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.emit("fallvault:lock", ());
                        let _ = win.hide();
                    }
                });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
