// Prevents additional console window on Windows, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 计算数据库路径并启动本地桥接服务
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("fallvault.db");
            let db_str = db_path.to_string_lossy().to_string();
            // 后台启动 HTTP 服务（绑定 127.0.0.1:6666）
            let _ = bridge::start_bridge(db_str);
            Ok(())
        })
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![bridge::get_bridge_token_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
