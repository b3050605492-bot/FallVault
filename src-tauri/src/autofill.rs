// 半自动浏览器填充：全局热键（默认 Ins）→ 把待填账号/密码粘贴进当前焦点输入框
// 账号先粘贴，Tab 跳到密码框，再粘贴密码，最后清空剪贴板（避免密码残留）
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use tauri_plugin_clipboard_manager::ClipboardExt;

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_TAB, VK_V,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct FillTarget {
    pub username: String,
    pub password: String,
}

// 全局状态：待填数据 + 当前热键（字符串，如 "Ins"）
pub struct AutofillState {
    pub target: Mutex<Option<FillTarget>>,
    pub hotkey: Mutex<String>,
    pub busy: Mutex<bool>,
}

impl AutofillState {
    pub fn new() -> Self {
        Self {
            target: Mutex::new(None),
            hotkey: Mutex::new("Ins".to_string()),
            busy: Mutex::new(false),
        }
    }
}

// 把前端传来的热键名映射到 rdev 的 Key（仅支持常见几个）
fn map_key(name: &str) -> Option<rdev::Key> {
    match name.trim().to_lowercase().as_str() {
        "ins" | "insert" => Some(rdev::Key::Insert),
        "f1" => Some(rdev::Key::F1),
        "f2" => Some(rdev::Key::F2),
        "f3" => Some(rdev::Key::F3),
        "f4" => Some(rdev::Key::F4),
        "f5" => Some(rdev::Key::F5),
        "f6" => Some(rdev::Key::F6),
        "f7" => Some(rdev::Key::F7),
        "f8" => Some(rdev::Key::F8),
        "f9" => Some(rdev::Key::F9),
        "f10" => Some(rdev::Key::F10),
        "f11" => Some(rdev::Key::F11),
        "f12" => Some(rdev::Key::F12),
        "pause" => Some(rdev::Key::Pause),
        _ => None,
    }
}

// 判断前台窗口是否属于我们自己（避免把密码填进 FallVault 自身）
fn foreground_is_ours() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == 0 {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid != 0 && pid == std::process::id()
    }
}

// 发送一次按键（按下+抬起）
unsafe fn send_key(vk: u16) {
    let down = INPUT {
        r#type: 1, // INPUT_KEYBOARD
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let up = INPUT {
        r#type: 1,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    windows_sys::Win32::UI::Input::KeyboardAndMouse::SendInput(
        1,
        &down,
        std::mem::size_of::<INPUT>() as i32,
    );
    thread::sleep(Duration::from_millis(20));
    windows_sys::Win32::UI::Input::KeyboardAndMouse::SendInput(
        1,
        &up,
        std::mem::size_of::<INPUT>() as i32,
    );
    thread::sleep(Duration::from_millis(20));
}

// 模拟 Ctrl+V 粘贴（当前剪贴板内容）
unsafe fn send_paste() {
    // Ctrl down
    send_key(VK_CONTROL as u16);
    send_key(VK_V as u16);
    // Ctrl up
    send_key(VK_CONTROL as u16);
}

// 执行填充流程
fn do_fill(app: &AppHandle, target: &FillTarget) {
    if target.username.is_empty() && target.password.is_empty() {
        return;
    }
    unsafe {
        // 先确认前台不是我们自己
        if foreground_is_ours() {
            return;
        }
        // 账号
        if !target.username.is_empty() {
            let _ = app.clipboard().write_text(target.username.clone());
            thread::sleep(Duration::from_millis(60));
            send_paste();
            thread::sleep(Duration::from_millis(120));
        }
        // 跳到下一个输入框
        send_key(VK_TAB as u16);
        thread::sleep(Duration::from_millis(120));
        // 密码
        if !target.password.is_empty() {
            let _ = app.clipboard().write_text(target.password.clone());
            thread::sleep(Duration::from_millis(60));
            send_paste();
            thread::sleep(Duration::from_millis(300));
        }
        // 清空剪贴板，避免密码残留
        let _ = app.clipboard().write_text(String::new());
    }
}

// 启动全局热键监听线程
pub fn start_autofill(app: AppHandle, state: Arc<AutofillState>) {
    thread::spawn(move || {
        let _ = rdev::listen(move |event| {
            if let rdev::EventType::KeyPress(key) = event.event_type {
                // 读取当前配置的热键
                let configured = {
                    let h = state.hotkey.lock().unwrap();
                    map_key(&h).unwrap_or(rdev::Key::Insert)
                };
                if key == configured {
                    // 防重入
                    {
                        let mut busy = state.busy.lock().unwrap();
                        if *busy {
                            return;
                        }
                        *busy = true;
                    }
                    let target = {
                        let t = state.target.lock().unwrap();
                        t.clone()
                    };
                    if let Some(t) = target {
                        do_fill(&app, &t);
                    }
                    {
                        let mut busy = state.busy.lock().unwrap();
                        *busy = false;
                    }
                }
            }
        });
    });
}
