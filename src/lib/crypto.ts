// FallVault 加密核心：主密码 + PBKDF2 派生 + AES-256-GCM 字段加密
// 使用 Web Crypto API（Tauri WebView 原生支持，无需外部依赖）
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { ENCRYPTED_ENTRY_FIELDS } from './entryEncryption';
import { readFileBytes, writeFileBytes } from './rustFs';
import { getDbPath } from './dbPath';
import { markVaultChanged } from './vaultChange';

// 内存中的主密钥（解锁后持有，锁定后清空）
let masterKey: CryptoKey | null = null;
// 内存中的主密码明文（仅用于自动备份时加密 .fvault，锁定后清空）
let masterPassword: string | null = null;

// 配置常量
const PBKDF2_ITERATIONS = 150_000;
const SALT_LENGTH = 16;   // 随机盐 16 字节
const IV_LENGTH = 12;     // GCM 推荐的 IV 长度
const VERIFY_TEXT = 'FallVault::master-key-verify';

// meta 表：存储加密元数据（salt + 校验密文）
const META_SQL = `
CREATE TABLE IF NOT EXISTS fly_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: Database | null = null;

async function metaDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load(await getDbPath());
  await db.execute(META_SQL);
  return db;
}

// ---- 基础工具：base64 <-> Uint8Array ----
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// ---- 密钥派生 ----
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // 不可导出，密钥只留在内存
    ['encrypt', 'decrypt']
  );
}

// ---- 加密 / 解密 ----
export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  if (!key) throw new Error('vault locked');
  const iv = randomBytes(IV_LENGTH);
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(plaintext || '')
  );
  // 格式: base64(iv):base64(ciphertext)
  return bytesToB64(iv) + ':' + bytesToB64(new Uint8Array(ct));
}

export async function decryptField(key: CryptoKey, encoded: string | null | undefined): Promise<string> {
  if (!key) throw new Error('vault locked');
  if (!encoded) return '';
  const sep = encoded.indexOf(':');
  if (sep < 0) {
    // 可能是旧版明文数据（未加密的遗留）——直接返回
    return encoded;
  }
  const iv = b64ToBytes(encoded.slice(0, sep));
  const ct = b64ToBytes(encoded.slice(sep + 1));
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ct as unknown as BufferSource
  );
  return new TextDecoder().decode(dec);
}

// 判断一段密文是否属于加密格式
export function isEncryptedField(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes(':') && !value.startsWith('http') && value.length > 24;
}

// ---- 元数据读写 ----
async function metaGet(key: string): Promise<string | null> {
  const d = await metaDb();
  const rows: any[] = await d.select('SELECT value FROM fly_meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

async function metaSet(key: string, value: string): Promise<void> {
  const d = await metaDb();
  await d.execute(
    'INSERT INTO fly_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ---- 公开 API ----

export function getMasterKey(): CryptoKey | null {
  return masterKey;
}

// 解锁宽限（免验证时长）：开启后，解锁成功的若干分钟内重新打开/从托盘唤起不要求重输
let graceEnabled = false;
let graceMinutes = 15;
let unlockExpireAt: number | null = null; // 免验证有效期截止时间戳(ms)

export function setUnlockGraceConfig(enabled: boolean, minutes: number): void {
  graceEnabled = enabled;
  graceMinutes = minutes > 0 ? minutes : 15;
  if (!enabled) {
    // 关闭宽限 → 立即作废
    unlockExpireAt = null;
  } else if (masterKey !== null) {
    // 已解锁状态下开启/调整宽限 → 立即以当前时刻重新开始计时
    unlockExpireAt = Date.now() + graceMinutes * 60_000;
  }
  // 注意：若当前处于锁定态（masterKey 为 null），不设置 expire，
  // 等下次 unlockVault 成功时再按 graceEnabled 计算（避免未输密码却直接进入）
}

// 当前是否处于免验证有效期内
export function isUnlockGraceValid(): boolean {
  if (!graceEnabled || unlockExpireAt === null) return false;
  return Date.now() < unlockExpireAt;
}

// 是否存在一个"已开启宽限的解锁会话"（用于区分：宽限未开启 vs 宽限已过期）
export function hasGraceSession(): boolean {
  return unlockExpireAt !== null;
}

// 手动锁定 / 超时后调用：清除宽限
export function clearUnlockGrace(): void {
  unlockExpireAt = null;
}

export function getMasterPassword(): string | null {
  return masterPassword;
}

export function isLocked(): boolean {
  return masterKey === null;
}

// 是否已设置过主密码
export async function hasMasterPassword(): Promise<boolean> {
  const salt = await metaGet('master_salt');
  const verifier = await metaGet('master_verifier');
  return !!(salt && verifier);
}

// 首次设置主密码（会被用于校验和此后解锁）
export async function setupMasterPassword(password: string): Promise<void> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  masterKey = key;
  masterPassword = password;

  // 存校验密文：加密固定文本，解锁时能解密 = 密码正确
  const verifier = await encryptField(key, VERIFY_TEXT);

  await metaSet('master_salt', bytesToB64(salt));
  await metaSet('master_verifier', verifier);
}

// 解锁：校验主密码，成功则内存持有密钥
export async function unlockVault(password: string): Promise<boolean> {
  const saltB64 = await metaGet('master_salt');
  const verifier = await metaGet('master_verifier');
  if (!saltB64 || !verifier) return false;

  const key = await deriveKey(password, b64ToBytes(saltB64));
  try {
    const decrypted = await decryptField(key, verifier);
    if (decrypted === VERIFY_TEXT) {
      masterKey = key;
      masterPassword = password;
      // 设置免验证有效期（若开启）
      unlockExpireAt = graceEnabled ? Date.now() + graceMinutes * 60_000 : null;
      return true;
    }
    return false;
  } catch {
    masterKey = null;
    return false;
  }
}

// 锁定：清空内存密钥 + 清除免验证宽限
export async function lockVault(): Promise<void> {
  masterKey = null;
  masterPassword = null;
  unlockExpireAt = null;
}

export class VaultIntegrityError extends Error {
  constructor(public report: IntegrityReport) {
    super('保险库存在无法读取的数据，主密码未修改。请查看异常详情。');
  }
}

let changingPassword = false;

// Prepare all ciphertext first; atomically replace rows, attachment paths and verifier.
export async function changeMasterPassword(newPassword: string): Promise<void> {
  if (!masterKey) throw new Error('vault locked');
  if (changingPassword) throw new Error('主密码正在修改，请稍候');
  changingPassword = true;
  const oldKey = masterKey;
  try {
    const dbPath = await getDbPath();
    const d = await Database.load(dbPath);
    const oldSalt = await metaGet('master_salt');
    const oldVerifier = await metaGet('master_verifier');
    const report = await verifyIntegrity();
    if (!report.ok) throw new VaultIntegrityError(report);

    const salt = randomBytes(SALT_LENGTH);
    const newKey = await deriveKey(newPassword, salt);
    const verifier = await encryptField(newKey, VERIFY_TEXT);
    const rows: any[] = await d.select('SELECT * FROM entries');
    const entries = [];
    for (const row of rows) {
      const after: string[] = [];
      for (const field of ENCRYPTED_ENTRY_FIELDS) {
        // Never skip a failed field or convert a decryption failure to an empty value.
        after.push(await encryptField(newKey, await decryptField(oldKey, row[field])));
      }
      entries.push({ id: row.id, before: ENCRYPTED_ENTRY_FIELDS.map((field) => row[field] ?? null), after });
    }
    const historyRows: any[] = await d.select('SELECT id, old_password FROM password_history');
    const history = [];
    for (const row of historyRows) {
      history.push({ id: row.id, before: row.old_password, after: await encryptField(newKey, await decryptField(oldKey, row.old_password)) });
    }
    const attachmentRows: any[] = await d.select('SELECT id, file_path FROM attachments');
    const attachments = [];
    for (const row of attachmentRows) {
      const original = await readFileBytes(row.file_path);
      const plaintext = await decryptAttachmentWithKey(oldKey, original);
      const { encrypted } = await encryptAttachmentWithKey(newKey, plaintext);
      const separator = Math.max(row.file_path.lastIndexOf('/'), row.file_path.lastIndexOf('\\'));
      const path = row.file_path.slice(0, separator + 1) + 'rekey_' + crypto.randomUUID() + '.fa';
      // New files are staged alongside the originals. A failed/interrupted commit
      // leaves the old database and files usable; never overwrite a source attachment.
      await writeFileBytes(path, encrypted);
      await decryptAttachmentWithKey(newKey, await readFileBytes(path));
      attachments.push({ id: row.id, before: row.file_path, after: path });
    }
    if (masterKey !== oldKey) throw new Error('保险库已锁定，请重新解锁后重试');
    await invoke('commit_master_password_change', {
      db: dbPath,
      data: { oldSalt, oldVerifier, salt: bytesToB64(salt), verifier, entries, history, attachments },
    });
    // Do not revive a session that was locked while the commit was in progress.
    if (masterKey === oldKey) {
      masterKey = newKey;
      masterPassword = newPassword;
    }
    markVaultChanged();
  } finally {
    changingPassword = false;
  }
}

// 首次设置主密码后：把数据库里已有的明文数据加密写回（数据迁移）
// 用法：setupMasterPassword(pw) 之后调用
export async function migratePlaintextToEncrypted(): Promise<number> {
  if (!masterKey) throw new Error('vault locked');
  const d = await Database.load(await getDbPath());
  const rows: any[] = await d.select(
    'SELECT id, username, password, notes FROM entries'
  );
  let migrated = 0;
  let changed = false;
  for (const r of rows) {
    const updates: string[] = [];
    const params: any[] = [];
    // 只有仍是明文（不是加密格式且非空）才加密
    if (r.username && !isEncryptedField(r.username)) {
      updates.push('username = ?');
      params.push(await encryptField(masterKey, r.username));
    }
    if (r.password && !isEncryptedField(r.password)) {
      updates.push('password = ?');
      params.push(await encryptField(masterKey, r.password));
    }
    if (r.notes && !isEncryptedField(r.notes)) {
      updates.push('notes = ?');
      params.push(await encryptField(masterKey, r.notes));
    }
    if (updates.length > 0) {
      params.push(r.id);
      await d.execute(
        `UPDATE entries SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      migrated++;
      changed = true;
    }
    // 密码历史也要加密
    const his: any[] = await d.select(
      'SELECT id, old_password FROM password_history WHERE entry_id = ?', [r.id]
    );
    for (const h of his) {
      if (h.old_password && !isEncryptedField(h.old_password)) {
        await d.execute(
          'UPDATE password_history SET old_password = ? WHERE id = ?',
          [await encryptField(masterKey, h.old_password), h.id]
        );
        changed = true;
      }
    }
  }
  if (changed) markVaultChanged();
  return migrated;
}




// ================= 数据完整性校验 =================
// 1) SQLite 物理完整性（PRAGMA integrity_check）
// 2) 全部条目解密健康检查（统计损坏/解不开的记录）

export interface IntegrityIssue {
  entryId: number;
  title: string;
  website: string;
  deleted: boolean;
  fields: string[];
  historyIds: number[];
  attachments: { id: number; name: string }[];
}

export interface IntegrityReport {
  ok: boolean;
  dbError?: string;
  corruptEntries: number;
  checkedEntries: number;
  issues: IntegrityIssue[];
}

export async function verifyIntegrity(): Promise<IntegrityReport> {
  const report: IntegrityReport = { ok: true, corruptEntries: 0, checkedEntries: 0, issues: [] };
  const key = masterKey;
  if (!key) return { ...report, ok: false, dbError: '保险库已锁定，请先解锁' };
  try {
    const d = await Database.load(await getDbPath());
    const checks: any[] = await d.select('PRAGMA integrity_check');
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok') {
      report.ok = false;
      report.dbError = checks.map((row) => row.integrity_check).join('; ') || '完整性检查未返回结果';
    }
    const all: any[] = await d.select('SELECT * FROM entries');
    const entriesById = new Map(all.map((row) => [Number(row.id), row]));
    const issues = new Map<number, IntegrityIssue>();
    const addIssue = (entryId: number, field: string): IntegrityIssue => {
      const row = entriesById.get(Number(entryId));
      let issue = issues.get(Number(entryId));
      if (!issue) {
        issue = { entryId: Number(entryId), title: row?.title || '', website: row?.website || '', deleted: !!row?.deleted_at, fields: [], historyIds: [], attachments: [] };
        issues.set(Number(entryId), issue);
      }
      if (!issue.fields.includes(field)) issue.fields.push(field);
      return issue;
    };
    for (const row of all) {
      report.checkedEntries++;
      for (const field of ENCRYPTED_ENTRY_FIELDS) {
        try {
          const plaintext = await decryptField(key, row[field]);
          if (field === 'custom_fields' && plaintext && !Array.isArray(JSON.parse(plaintext))) throw new Error('Invalid custom fields');
        } catch {
          addIssue(row.id, field);
        }
      }
    }
    const history: any[] = await d.select('SELECT id, entry_id, old_password FROM password_history');
    for (const row of history) {
      try { await decryptField(key, row.old_password); }
      catch { addIssue(row.entry_id, 'password_history').historyIds.push(row.id); }
    }
    const attachments: any[] = await d.select('SELECT id, entry_id, file_name, file_path FROM attachments');
    for (const row of attachments) {
      try { await decryptAttachmentWithKey(key, await readFileBytes(row.file_path)); }
      catch { addIssue(row.entry_id, 'attachment').attachments.push({ id: row.id, name: row.file_name }); }
    }
    report.issues = [...issues.values()];
    report.corruptEntries = report.issues.length;
    if (report.corruptEntries) report.ok = false;
  } catch (e: any) {
    report.ok = false;
    report.dbError = String(e?.message || e);
  }
  return report;
}


// ================= 附件加密 =================
// 附件文件内容用主密钥 AES-GCM 加密存储（.fa 后缀），读取时解密
export async function encryptAttachment(bytes: Uint8Array): Promise<{ encrypted: Uint8Array; meta: string }> {
  if (!masterKey) throw new Error('vault locked');
  return encryptAttachmentWithKey(masterKey, bytes);
}

async function encryptAttachmentWithKey(key: CryptoKey, bytes: Uint8Array): Promise<{ encrypted: Uint8Array; meta: string }> {
  const iv = randomBytes(IV_LENGTH);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    bytes as unknown as BufferSource
  );
  // 加密文件格式：iv(12) + ct
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  // meta: 加密参数记录（当前无额外参数，保留结构便于未来扩展）
  const meta = bytesToB64(iv);
  return { encrypted: out, meta };
}

export async function decryptAttachment(encryptedBytes: Uint8Array): Promise<Uint8Array> {
  if (!masterKey) throw new Error('vault locked');
  return decryptAttachmentWithKey(masterKey, encryptedBytes);
}

async function decryptAttachmentWithKey(key: CryptoKey, encryptedBytes: Uint8Array): Promise<Uint8Array> {
  if (encryptedBytes.length < IV_LENGTH) throw new Error('bad attachment');
  const iv = encryptedBytes.slice(0, IV_LENGTH);
  const ct = encryptedBytes.slice(IV_LENGTH);
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ct as unknown as BufferSource
  );
  return new Uint8Array(dec);
}
