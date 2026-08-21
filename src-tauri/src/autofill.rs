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

// 把前端传来的热键 token（rdev 变体名，如 "KeyA" / "Num1" / "F2" / "Insert" / "Tab"）映射到 rdev::Key
fn map_key(name: &str) -> Option<rdev::Key> {
    match name {
        "Ins" | "Insert" => Some(rdev::Key::Insert),
        "F1" => Some(rdev::Key::F1),
        "F2" => Some(rdev::Key::F2),
        "F3" => Some(rdev::Key::F3),
        "F4" => Some(rdev::Key::F4),
        "F5" => Some(rdev::Key::F5),
        "F6" => Some(rdev::Key::F6),
        "F7" => Some(rdev::Key::F7),
        "F8" => Some(rdev::Key::F8),
        "F9" => Some(rdev::Key::F9),
        "F10" => Some(rdev::Key::F10),
        "F11" => Some(rdev::Key::F11),
        "F12" => Some(rdev::Key::F12),
        "KeyA" => Some(rdev::Key::KeyA),
        "KeyB" => Some(rdev::Key::KeyB),
        "KeyC" => Some(rdev::Key::KeyC),
        "KeyD" => Some(rdev::Key::KeyD),
        "KeyE" => Some(rdev::Key::KeyE),
        "KeyF" => Some(rdev::Key::KeyF),
        "KeyG" => Some(rdev::Key::KeyG),
        "KeyH" => Some(rdev::Key::KeyH),
        "KeyI" => Some(rdev::Key::KeyI),
        "KeyJ" => Some(rdev::Key::KeyJ),
        "KeyK" => Some(rdev::Key::KeyK),
        "KeyL" => Some(rdev::Key::KeyL),
        "KeyM" => Some(rdev::Key::KeyM),
        "KeyN" => Some(rdev::Key::KeyN),
        "KeyO" => Some(rdev::Key::KeyO),
        "KeyP" => Some(rdev::Key::KeyP),
        "KeyQ" => Some(rdev::Key::KeyQ),
        "KeyR" => Some(rdev::Key::KeyR),
        "KeyS" => Some(rdev::Key::KeyS),
        "KeyT" => Some(rdev::Key::KeyT),
        "KeyU" => Some(rdev::Key::KeyU),
        "KeyV" => Some(rdev::Key::KeyV),
        "KeyW" => Some(rdev::Key::KeyW),
        "KeyX" => Some(rdev::Key::KeyX),
        "KeyY" => Some(rdev::Key::KeyY),
        "KeyZ" => Some(rdev::Key::KeyZ),
        "Num0" => Some(rdev::Key::Num0),
        "Num1" => Some(rdev::Key::Num1),
        "Num2" => Some(rdev::Key::Num2),
        "Num3" => Some(rdev::Key::Num3),
        "Num4" => Some(rdev::Key::Num4),
        "Num5" => Some(rdev::Key::Num5),
        "Num6" => Some(rdev::Key::Num6),
        "Num7" => Some(rdev::Key::Num7),
        "Num8" => Some(rdev::Key::Num8),
        "Num9" => Some(rdev::Key::Num9),
        "Tab" => Some(rdev::Key::Tab),
        "Return" => Some(rdev::Key::Return),
        "Delete" => Some(rdev::Key::Delete),
        "Backspace" => Some(rdev::Key::Backspace),
        "Escape" => Some(rdev::Key::Escape),
        "Space" => Some(rdev::Key::Space),
        "Pause" => Some(rdev::Key::Pause),
        "ScrollLock" => Some(rdev::Key::ScrollLock),
        "PrintScreen" => Some(rdev::Key::PrintScreen),
        "CapsLock" => Some(rdev::Key::CapsLock),
        "BackQuote" => Some(rdev::Key::BackQuote),
        "Minus" => Some(rdev::Key::Minus),
        "Equal" => Some(rdev::Key::Equal),
        "LeftBracket" => Some(rdev::Key::LeftBracket),
        "RightBracket" => Some(rdev::Key::RightBracket),
        "BackSlash" => Some(rdev::Key::BackSlash),
        "SemiColon" => Some(rdev::Key::SemiColon),
        "Quote" => Some(rdev::Key::Quote),
        "Comma" => Some(rdev::Key::Comma),
        "Dot" => Some(rdev::Key::Dot),
        "Slash" => Some(rdev::Key::Slash),
        "UpArrow" => Some(rdev::Key::UpArrow),
        "DownArrow" => Some(rdev::Key::DownArrow),
        "LeftArrow" => Some(rdev::Key::LeftArrow),
        "RightArrow" => Some(rdev::Key::RightArrow),
        "Home" => Some(rdev::Key::Home),
        "End" => Some(rdev::Key::End),
        "PageUp" => Some(rdev::Key::PageUp),
        "PageDown" => Some(rdev::Key::PageDown),
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

// 构造一个键盘输入事件
fn key_input(vk: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: 1, // INPUT_KEYBOARD
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
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

// 模拟一次 Ctrl+V 粘贴（真正的原子组合：Ctrl 按住期间按下/抬起 V，再抬起 Ctrl）
unsafe fn send_paste() {
    let inputs = [
        key_input(VK_CONTROL as u16, 0),
        key_input(VK_V as u16, 0),
        key_input(VK_V as u16, KEYEVENTF_KEYUP),
        key_input(VK_CONTROL as u16, KEYEVENTF_KEYUP),
    ];
    windows_sys::Win32::UI::Input::KeyboardAndMouse::SendInput(
        4,
        inputs.as_ptr(),
        std::mem::size_of::<INPUT>() as i32,
    );
    thread::sleep(Duration::from_millis(30));
}

// 执行填充流程：账号 → Tab 跳到密码框 → 密码（密码后不自动回车，避免直接提交登录）
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
        // Tab 跳到下一个输入框（密码框）
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
