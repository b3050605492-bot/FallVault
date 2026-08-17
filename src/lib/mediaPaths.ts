// 统一数据目录管理：图标/背景都存放在 dataPath 下
// 目录结构：
//   {dataPath}/icons/      账号图标
//   {dataPath}/backgrounds/ 自定义背景
// 用户可在设置中自定义 dataPath，默认是 AppData/com.fall.fallvault/media
import { appDataDir } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import { useAppStore } from '@/stores/appStore';

export async function getDataRoot(): Promise<string> {
  const { settings } = useAppStore.getState();
  if (settings.dataPath && settings.dataPath.trim()) {
    return settings.dataPath.replace(/[\\/]+$/, '');
  }
  const appData = await appDataDir();
  return `${appData}\\media`;
}

export async function getIconsDir(): Promise<string> {
  const root = await getDataRoot();
  const dir = `${root}\\icons`;
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function getBackgroundsDir(): Promise<string> {
  const root = await getDataRoot();
  const dir = `${root}\\backgrounds`;
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureDataDirs(): Promise<void> {
  const root = await getDataRoot();
  await mkdir(`${root}\\icons`, { recursive: true });
  await mkdir(`${root}\\backgrounds`, { recursive: true });
}

export function isLocalMediaPath(path: string): boolean {
  if (!path) return false;
  return (
    path.includes('\\icons\\') || path.includes('/icons/') ||
    path.includes('\\backgrounds\\') || path.includes('/backgrounds/')
  );
}