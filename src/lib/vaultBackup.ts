// .fvault 加密备份：导出（含附件）与恢复
// 整包格式：AES-256-GCM 加密的 JSON（含全部条目、分类、标签、附件 base64）
// 备份密码通过 PBKDF2(15万次) 派生密钥 → 随机 data key 加密数据 → data key 抛加密存文件头
import { writeFile } from '@tauri-apps/plugin-fs';
import Database from '@tauri-apps/plugin-sql';
import { getMasterKey, encryptField, decryptField, isEncryptedField } from './crypto';

const PBKDF2_ITERATIONS = 150_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const b64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const rand = (n: number) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ct: string }> {
  const iv = rand(IV_LENGTH);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext as unknown as BufferSource
  );
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

async function aesDecrypt(key: CryptoKey, iv: string, ct: string): Promise<Uint8Array> {
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) as unknown as BufferSource },
    key,
    unb64(ct) as unknown as BufferSource
  );
  return new Uint8Array(dec);
}

interface BackupData {
  app: string;
  version: string;
  exportedAt: string;
  folders: { id: number; name: string; icon: string; parent_id: number | null }[];
  tags: { id: number; name: string; color: string }[];
  entries: {
    id: number;
    title: string;
    username: string;
    password: string;
    website: string;
    notes: string;
    totp_secret: string;
    icon: string;
    folder_id: number | null;
    is_favorite: boolean;
    created_at: string;
    updated_at: string;
    tag_ids: number[];
    attachments?: { name: string; data_b64: string; size: number }[];
  }[];
}

export interface BackupResult {
  exported: number;
  attachments: number;
}

// 读取当前时间，用于生成默认文件名
export function backupStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

// 导出：返回加密后的文件内容字符串 + 计数（不写盘，由调用方决定如何落盘）
export async function buildBackupContent(
  password: string,
  includeAttachments: boolean = true,
): Promise<{ content: string; entryCount: number; attachmentCount: number }> {
  const masterKey = getMasterKey();
  if (!masterKey) throw new Error('vault locked');

  const d = await Database.load('sqlite:fallvault.db');

  // 读取全部数据
  const folderRows: any[] = await d.select('SELECT * FROM folders');
  const tagRows: any[] = await d.select('SELECT * FROM tags');
  const entryRows: any[] = await d.select('SELECT * FROM entries');
  const etRows: any[] = await d.select('SELECT entry_id, tag_id FROM entry_tags');
  const attachRows: any[] = await d.select('SELECT * FROM attachments');

  const etMap = new Map<number, number[]>();
  etRows.forEach((r) => {
    const arr = etMap.get(r.entry_id) || [];
    arr.push(Number(r.tag_id));
    etMap.set(r.entry_id, arr);
  });

  // 附件读取（base64）
  const attachByEntry = new Map<number, { name: string; data_b64: string; size: number }[]>();
  let attachmentCount = 0;
  if (includeAttachments) {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    for (const a of attachRows) {
      try {
        const buf = await readFile(a.file_path);
        const bytes = new Uint8Array(buf);
        const row = { name: a.file_name, data_b64: b64(bytes), size: bytes.length };
        const arr = attachByEntry.get(a.entry_id) || [];
        arr.push(row);
        attachByEntry.set(a.entry_id, arr);
        attachmentCount++;
      } catch {
        // 附件文件可能已丢失，跳过
      }
    }
  }

  const entries: BackupData['entries'] = [];
  for (const e of entryRows) {
    const decrypt = async (v: string) => {
      if (!v) return '';
      if (!isEncryptedField(v)) return v; // 明文旧数据
      try { return await decryptField(masterKey as any, v); } catch { return ''; }
    };
    entries.push({
      id: e.id,
      title: e.title || '',
      username: await decrypt(e.username || ''),
      password: await decrypt(e.password || ''),
      website: e.website || '',
      notes: await decrypt(e.notes || ''),
      totp_secret: await decrypt(e.totp_secret || ''),
      icon: e.icon || '',
      folder_id: e.folder_id ?? null,
      is_favorite: !!e.is_favorite,
      created_at: e.created_at || '',
      updated_at: e.updated_at || '',
      tag_ids: etMap.get(e.id) || [],
      attachments: includeAttachments ? (attachByEntry.get(e.entry_id) || []) : undefined,
    });
  }

  const data: BackupData = {
    app: 'FallVault',
    version: '1.1.2',
    exportedAt: new Date().toISOString(),
    folders: folderRows.map((f) => ({ id: f.id, name: f.name, icon: f.icon || '', parent_id: f.parent_id ?? null })),
    tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color || '#7DD3C0' })),
    entries,
  };

  // 整包加密：
  // 1. 生成随机 salt + 备份密码派生收件密钥
  // 2. 生成随机 data key，用它 AES-GCM 加密 JSON 数据
  // 3. data key 用收件密钥加密，连同 salt/iv 存文件头
  const salt = rand(SALT_LENGTH);
  const receiverKey = await deriveKey(password, salt);
  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const dataKeyRaw = await crypto.subtle.exportKey('raw', dataKey as CryptoKey);
  const wrapped = await aesEncrypt(receiverKey, new Uint8Array(dataKeyRaw));

  const payload = new TextEncoder().encode(JSON.stringify(data));
  const body = await aesEncrypt(dataKey as CryptoKey, payload);

  const fileContent = JSON.stringify({
    fvault: 1,
    salt: b64(salt),
    wrapped_iv: wrapped.iv,
    wrapped_ct: wrapped.ct,
    body_iv: body.iv,
    body_ct: body.ct,
    created: data.exportedAt,
  });

  return { content: fileContent, entryCount: entries.length, attachmentCount };
}

export async function exportVault(
  password: string,
  savePath: string,
  includeAttachments: boolean = true,
): Promise<BackupResult> {
  const { content, entryCount, attachmentCount } = await buildBackupContent(password, includeAttachments);
  await writeFile(savePath, new TextEncoder().encode(content));
  return { exported: entryCount, attachments: attachmentCount };
}

// ============ 恢复 ============
export interface RestoreResult {
  entries: number;
  folders: number;
  tags: number;
  newEntries: number;
  skippedEntries: number;
}

export async function restoreVault(password: string, filePath: string): Promise<RestoreResult> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const buf = await readFile(filePath);
  const text = new TextDecoder().decode(new Uint8Array(buf));
  return applyBackupContent(password, text);
}

// 与 restoreVault 相同，但接收已读取的文件内容字符串（用于走 Rust 读取的自动备份恢复）
export async function restoreVaultFromContent(password: string, text: string): Promise<RestoreResult> {
  return applyBackupContent(password, text);
}

async function applyBackupContent(password: string, text: string): Promise<RestoreResult> {
  let header: any;
  try {
    header = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 FallVault 备份文件');
  }
  if (!header.fvault || !header.salt || !header.wrapped_iv || !header.wrapped_ct || !header.body_iv || !header.body_ct) {
    throw new Error('备份文件格式不正确');
  }

  // 1. 用备份密码解出 data key
  const receiverKey = await deriveKey(password, unb64(header.salt));
  let dataKeyRaw: Uint8Array;
  try {
    dataKeyRaw = await aesDecrypt(receiverKey, header.wrapped_iv, header.wrapped_ct);
  } catch {
    throw new Error('备份密码错误');
  }
  const dataKey = await crypto.subtle.importKey(
    'raw', dataKeyRaw as unknown as BufferSource, { name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt']
  );

  // 2. 解密数据包
  let dataBytes: Uint8Array;
  try {
    dataBytes = await aesDecrypt(dataKey as CryptoKey, header.body_iv, header.body_ct);
  } catch {
    throw new Error('备份数据损坏或密码错误');
  }
  const data: BackupData = JSON.parse(new TextDecoder().decode(dataBytes));
  if (data.app !== 'FallVault') throw new Error('不是 FallVault 备份');

  const d = await Database.load('sqlite:fallvault.db');
  const masterKey = getMasterKey();
  if (!masterKey) throw new Error('vault locked');

  const enc = (v: string) => (v ? encryptField(masterKey as any, v) : '');
  const dec = async (v: string) => {
    if (!v) return '';
    if (!isEncryptedField(v)) return v;
    try { return await decryptField(masterKey as any, v); } catch { return ''; }
  };

  // 3. 写入分类/标签（避免重复）
  const folderIdMap = new Map<number, number>();
  let foldersAdded = 0;
  for (const f of data.folders) {
    const exists: any[] = await d.select('SELECT id FROM folders WHERE name = ? AND icon = ?', [f.name, f.icon || '']);
    if (exists.length > 0) {
      folderIdMap.set(f.id, Number(exists[0].id));
    } else {
      const r = await d.execute('INSERT INTO folders (name, icon, parent_id) VALUES (?, ?, ?)', [f.name, f.icon || '', f.parent_id ?? null]);
      const newId = Number(r.lastInsertId);
      folderIdMap.set(f.id, newId);
      foldersAdded++;
    }
  }

  const tagIdMap = new Map<number, number>();
  let tagsAdded = 0;
  for (const t of data.tags) {
    const exists: any[] = await d.select('SELECT id FROM tags WHERE name = ?', [t.name]);
    if (exists.length > 0) {
      tagIdMap.set(t.id, Number(exists[0].id));
    } else {
      const r = await d.execute('INSERT INTO tags (name, color) VALUES (?, ?)', [t.name, t.color || '#7DD3C0']);
      const newId = Number(r.lastInsertId);
      tagIdMap.set(t.id, newId);
      tagsAdded++;
    }
  }

  // 4. 写入条目（标题+账号+网站+密码 明文相同判定重复 → 跳过）
  // 注意：加密字段使用随机 IV，密文每次不同，必须用明文比对
  const existing: any[] = await d.select('SELECT id, title, username, password, website FROM entries');
  const existingPlain = await Promise.all(existing.map(async (e) => ({
    title: e.title || '',
    username: await dec(e.username || ''),
    password: await dec(e.password || ''),
    website: e.website || '',
  })));
  const isDup = (e: any) =>
    existingPlain.some((x) =>
      x.title === e.title &&
      x.username === (e.username || '') &&
      x.password === (e.password || '') &&
      x.website === (e.website || '')
    );

  let newEntries = 0;
  let skipped = 0;
  for (const e of data.entries) {
    if (isDup(e)) {
      skipped++;
      continue;
    }
    const r = await d.execute(
      `INSERT INTO entries (title, username, password, totp_secret, website, notes, icon, folder_id, is_favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.title, await enc(e.username), await enc(e.password), await enc(e.totp_secret),
        e.website, await enc(e.notes), e.icon || 'Lock',
        e.folder_id != null ? (folderIdMap.get(e.folder_id) ?? null) : null,
        e.is_favorite ? 1 : 0, e.created_at || '', e.updated_at || '',
      ]
    );
    const newEntryId = Number(r.lastInsertId);
    newEntries++;

    for (const tid of e.tag_ids) {
      const mapped = tagIdMap.get(tid);
      if (mapped != null) {
        await d.execute('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [newEntryId, mapped]);
      }
    }

    // 附件恢复
    if (e.attachments && e.attachments.length > 0) {
      const { getAttachmentsDir } = await import('@/lib/mediaPaths');
      const { writeFileBytes } = await import('@/lib/rustFs');
      const attDir = await getAttachmentsDir();
      for (const att of e.attachments) {
        const destPath = `${attDir}\\att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${att.name.replace(/[\\/:*?"<>|]/g, '_')}`;
        await writeFileBytes(destPath, unb64(att.data_b64));
        await d.execute(
          'INSERT INTO attachments (entry_id, file_name, file_path, file_size) VALUES (?, ?, ?, ?)',
          [newEntryId, att.name, destPath, att.size]
        );
      }
    }
  }

  return { entries: data.entries.length, folders: data.folders.length, tags: data.tags.length, newEntries, skippedEntries: skipped };
}
