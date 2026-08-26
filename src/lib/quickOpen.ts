// 快速打开：全局快捷键在 Rust 端注册（不依赖 webview 是否存活，托盘/最小化均可触发）
// 前端只负责把热键字符串传给 Rust 命令 set_quick_open_hotkey
import { invoke } from '@tauri-apps/api/core';

// 设置/更新快速打开热键。空字符串表示关闭。
export async function setQuickOpenHotkey(hotkey: string): Promise<void> {
  await invoke('set_quick_open_hotkey', { hotkey: hotkey || '' });
}

// 兼容性占位（不再使用 JS 端注册）
export async function clearQuickOpenHotkey(): Promise<void> {
  await invoke('set_quick_open_hotkey', { hotkey: '' });
}
