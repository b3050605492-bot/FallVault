const DIRTY_STORAGE_KEY = 'fallvault:github-backup-dirty';
const LAST_SUCCESS_STORAGE_KEY = 'fallvault:github-backup-last-success';

export const VAULT_CHANGED_EVENT = 'fallvault:vault-changed';

let memoryMarker: string | null = null;
let memoryLastSuccess: { repo: string; at: number } | null = null;
let markerSequence = 0;

function emitVaultChanged(marker: string | null): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VAULT_CHANGED_EVENT, { detail: marker }));
  }
}

export function markVaultChanged(): string {
  const marker = `${Date.now()}-${++markerSequence}`;
  memoryMarker = marker;
  try {
    localStorage.setItem(DIRTY_STORAGE_KEY, marker);
  } catch { /* localStorage 不可用时保留内存标记 */ }
  emitVaultChanged(marker);
  return marker;
}

export function getVaultChangeMarker(): string | null {
  try {
    return localStorage.getItem(DIRTY_STORAGE_KEY) || memoryMarker;
  } catch {
    return memoryMarker;
  }
}

export function getVaultChangeTime(): number | null {
  const marker = getVaultChangeMarker();
  if (!marker) return null;
  const timestamp = Number(marker.split('-', 1)[0]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getLastGithubBackupAt(repo: string): number | null {
  try {
    const raw = localStorage.getItem(LAST_SUCCESS_STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : memoryLastSuccess;
    return saved?.repo === repo && Number.isFinite(Number(saved.at)) ? Number(saved.at) : null;
  } catch {
    return memoryLastSuccess?.repo === repo ? memoryLastSuccess.at : null;
  }
}

export function setLastGithubBackupAt(repo: string, at = Date.now()): void {
  const value = { repo, at };
  memoryLastSuccess = value;
  try {
    localStorage.setItem(LAST_SUCCESS_STORAGE_KEY, JSON.stringify(value));
  } catch { /* localStorage 不可用时保留内存时间 */ }
}

// 解锁等状态恢复后，若仍有未备份修改，通知调度器重新开始防抖计时。
export function requestPendingVaultBackup(): void {
  if (!getVaultChangeMarker() || typeof window === 'undefined') return;
  emitVaultChanged(getVaultChangeMarker());
}

// 仅清除本次备份开始时捕获的标记；备份过程中若又有修改，新标记会继续保留。
export function clearVaultChangeMarker(expectedMarker: string | null): void {
  if (!expectedMarker || getVaultChangeMarker() !== expectedMarker) return;
  memoryMarker = null;
  try {
    localStorage.removeItem(DIRTY_STORAGE_KEY);
  } catch { /* ignore */ }
  emitVaultChanged(null);
}
