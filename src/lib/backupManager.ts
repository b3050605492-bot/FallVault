import { join } from '@tauri-apps/api/path';
import { getMasterPassword } from '@/lib/crypto';
import { buildBackupContent, restoreVaultFromContent } from '@/lib/vaultBackup';
import { useAppStore } from '@/stores/appStore';

// 所有备份相关的文件 IO 走 Rust 命令（std::fs），避免 fs 插件作用域限制
async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

export interface BackupInfo {
  name: string;       // 文件名
  path: string;      // 完整路径（用于恢复）
  time: string;       // 可读时间
  size: string;       // 可读大小
  sizeBytes: number;
}

function ts(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 数据文件夹：用户自定义（settings.dataDir）优先；未设置则回退到 exe 同级 data/
export async function getDataDir(): Promise<string> {
  const sd = useAppStore.getState().settings.dataDir?.trim();
  if (sd) return sd.replace(/[\\/]+$/, '');
  const exeDir = await invoke<string>('get_exe_dir');
  return `${exeDir}\\data`.replace(/[\\/]+$/, '');
}

// 是否已设置数据文件夹
export function isDataDirSet(): boolean {
  return !!useAppStore.getState().settings.dataDir?.trim();
}

// 自动备份目录：数据文件夹/backups
export async function getBackupDir(): Promise<string> {
  return await join(await getDataDir(), 'backups');
}

export async function ensureBackupDir(): Promise<string> {
  const dir = await getBackupDir();
  await invoke('create_dir_all', { path: dir });
  return dir;
}

// 创建一次自动备份：生成加密的 .fvault 文件（与手动"恢复备份"同一种格式）
// 加密密码使用主密码，因此恢复时输入主密码即可（与"恢复备份"完全一致）
// 仅在已解锁（内存持有主密码）且已设置数据文件夹时执行；否则跳过
export async function createBackup(): Promise<string | null> {
  try {
    if (!isDataDirSet()) return null; // 未设置数据文件夹，禁用自动备份
    const mp = getMasterPassword();
    if (!mp) return null; // 已锁定，无法加密，跳过
    const dir = await ensureBackupDir();
    const dest = await join(dir, `FallVault_自动备份_${ts(new Date())}.fvault`);
    const { content, entryCount, attachmentCount } = await buildBackupContent(mp, true);
    await invoke('write_text_file', { path: dest, contents: content });
    await pruneBackups();
    return dest;
  } catch (e) {
    console.error('createBackup failed', e);
    return null;
  }
}

// 列出历史备份（.fvault 加密备份，按时间倒序）
export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const dir = await getBackupDir();
    const names: string[] = await invoke('list_dir_names', { path: dir });
    const files = names.filter((n) => n.endsWith('.fvault') && n.startsWith('FallVault_'));
    const infos: BackupInfo[] = [];
    for (const name of files) {
      const full = await join(dir, name);
      const sizeBytes = await invoke<number>('file_size', { path: full }).catch(() => 0);
      const m = name.match(/FallVault_自动备份_(\d{8})-(\d{6})\.fvault/);
      let time = name;
      if (m) {
        const y = m[1].slice(0, 4), mo = m[1].slice(4, 6), d = m[1].slice(6, 8);
        const hh = m[2].slice(0, 2), mm = m[2].slice(2, 4), ss = m[2].slice(4, 6);
        time = `${y}-${mo}-${d} ${hh}:${mm}:${ss}`;
      }
      infos.push({ name, path: full, time, size: humanSize(sizeBytes), sizeBytes });
    }
    infos.sort((a, b) => b.name.localeCompare(a.name));
    return infos;
  } catch {
    return [];
  }
}

// 保留最新 max 份，删除更旧的
async function pruneBackups(): Promise<void> {
  try {
    const max = (await import('@/stores/appStore')).useAppStore.getState().settings.autoBackupMax || 5;
    const dir = await getBackupDir();
    const names: string[] = await invoke('list_dir_names', { path: dir });
    const files = names
      .filter((n) => n.endsWith('.fvault') && n.startsWith('FallVault_'))
      .sort((a, b) => b.localeCompare(a)); // 倒序：最新在前
    const toDelete = files.slice(max);
    for (const name of toDelete) {
      await invoke('remove_file', { path: await join(dir, name) });
    }
  } catch { }
}

// 恢复某个备份：复用与"恢复备份"完全相同的逻辑（用密码解密 .fvault 内容）
export async function restoreBackup(path: string, password: string): Promise<{ newEntries: number; skippedEntries: number } | null> {
  try {
    const text: string = await invoke('read_text_file', { path });
    return await restoreVaultFromContent(password, text);
  } catch (e) {
    console.error('restoreBackup failed', e);
    return null;
  }
}

// 自动备份调度器（返回停止函数）
let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoBackup(intervalMin: number, onTick?: (ok: boolean) => void): () => void {
  stopAutoBackup();
  const ms = Math.max(1, intervalMin) * 60 * 1000;
  timer = setInterval(() => {
    createBackup().then((r) => onTick?.(!!r));
  }, ms);
  return stopAutoBackup;
}
export function stopAutoBackup() {
  if (timer) { clearInterval(timer); timer = null; }
}
