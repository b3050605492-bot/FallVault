// 统一数据目录管理：图标/背景/附件都存放在「数据文件夹」下
//   {dataDir}/media/icons/      账号图标
//   {dataDir}/media/backgrounds/ 自定义背景
//   {dataDir}/attachments/       附件
// 目录创建走 Rust 命令（std::fs），避免 fs 插件作用域限制
import { getDataDir } from '@/lib/backupManager';

async function ensureDir(dir: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('create_dir_all', { path: dir });
  return dir;
}

export async function getDataRoot(): Promise<string> {
  return `${await getDataDir()}\\media`;
}

export async function getIconsDir(): Promise<string> {
  return ensureDir(`${await getDataRoot()}\\icons`);
}

export async function getBackgroundsDir(): Promise<string> {
  return ensureDir(`${await getDataRoot()}\\backgrounds`);
}

export async function getAttachmentsDir(): Promise<string> {
  return ensureDir(`${await getDataRoot()}\\..\\attachments`);
}

export async function ensureDataDirs(): Promise<void> {
  await ensureDir(`${await getDataRoot()}\\icons`);
  await ensureDir(`${await getDataRoot()}\\backgrounds`);
}

export function isLocalMediaPath(path: string): boolean {
  if (!path) return false;
  return (
    path.includes('\\icons\\') || path.includes('/icons/') ||
    path.includes('\\backgrounds\\') || path.includes('/backgrounds/')
  );
}