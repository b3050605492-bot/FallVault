// 半自动填充桥接：前端把"待填账号/密码"写给 Rust 端，由全局热键触发粘贴
import { invoke } from '@tauri-apps/api/core';

export interface FillPayload {
  username: string;
  password: string;
}

// 设置当前待填目标（选中/查看某条账号时调用）
export async function setFillTarget(payload: FillPayload | null): Promise<void> {
  try {
    await invoke('set_fill_target', { target: payload });
  } catch {
    // 忽略（Rust 端未就绪等）
  }
}

// 更新填充选项（填充后是否重置待填账号）
export async function setAutofillOptions(resetAfterUse: boolean): Promise<void> {
  try {
    await invoke('set_autofill_options', { resetAfterUse });
  } catch {
    // 忽略
  }
}

// 更新全局热键
export async function setAutofillHotkey(hotkey: string): Promise<void> {
  try {
    await invoke('set_autofill_hotkey', { hotkey });
  } catch {
    // 忽略
  }
}
