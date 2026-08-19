// FallVault 加密核心：主密码 + PBKDF2 派生 + AES-256-GCM 字段加密
// 使用 Web Crypto API（Tauri WebView 原生支持，无需外部依赖）
import Database from '@tauri-apps/plugin-sql';

// 内存中的主密钥（解锁后持有，锁定后清空）
let masterKey: CryptoKey | null = null;

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
  db = await Database.load('sqlite:fallvault.db');
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
      return true;
    }
    return false;
  } catch {
    masterKey = null;
    return false;
  }
}

// 锁定：清空内存密钥
export async function lockVault(): Promise<void> {
  masterKey = null;
}

// 修改主密码（需已解锁）——无损版：先把全部数据用旧密钥解密，再用新密钥重新加密写回
export async function changeMasterPassword(newPassword: string): Promise<void> {
  if (!masterKey) throw new Error('vault locked');
  const oldKey = masterKey;

  // 1. 用旧密钥读出全部明文
  const d = await Database.load('sqlite:fallvault.db');
  const entries: any[] = await d.select(
    'SELECT id, username, password, notes FROM entries'
  );
  const plain = [];
  for (const r of entries) {
    try {
      plain.push({
        id: r.id,
        username: await decryptField(oldKey, r.username),
        password: await decryptField(oldKey, r.password),
        notes: await decryptField(oldKey, r.notes),
      });
    } catch (e) {
      // 旧密钥解不开的记录（异常残留）跳过，不阻断改密码
      console.error('re-encrypt skip entry', r.id, e);
    }
  }
  const hisRows: any[] = await d.select(
    'SELECT id, old_password FROM password_history'
  );
  const history: { id: number; old_password: string }[] = [];
  for (const h of hisRows) {
    try {
      history.push({ id: h.id, old_password: await decryptField(oldKey, h.old_password) });
    } catch (e) {
      console.error('re-encrypt skip history', h.id, e);
    }
  }

  // 2. 生成新盐 + 新密钥 + 新校验值
  const salt = randomBytes(SALT_LENGTH);
  const newKey = await deriveKey(newPassword, salt);
  const verifier = await encryptField(newKey, VERIFY_TEXT);

  // 3. 用新密钥重新加密全部数据并写回
  for (const p of plain) {
    await d.execute(
      'UPDATE entries SET username = ?, password = ?, notes = ? WHERE id = ?',
      [
        await encryptField(newKey, p.username),
        await encryptField(newKey, p.password),
        await encryptField(newKey, p.notes),
        p.id,
      ]
    );
  }
  for (const h of history) {
    await d.execute(
      'UPDATE password_history SET old_password = ? WHERE id = ?',
      [await encryptField(newKey, h.old_password), h.id]
    );
  }

  // 4. 更新元数据 + 内存密钥
  await metaSet('master_salt', bytesToB64(salt));
  await metaSet('master_verifier', verifier);
  masterKey = newKey;
}

// 首次设置主密码后：把数据库里已有的明文数据加密写回（数据迁移）
// 用法：setupMasterPassword(pw) 之后调用
export async function migratePlaintextToEncrypted(): Promise<number> {
  if (!masterKey) throw new Error('vault locked');
  const d = await Database.load('sqlite:fallvault.db');
  const rows: any[] = await d.select(
    'SELECT id, username, password, notes FROM entries'
  );
  let migrated = 0;
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
      }
    }
  }
  return migrated;
}
