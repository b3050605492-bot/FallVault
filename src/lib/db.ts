import Database from '@tauri-apps/plugin-sql';
import { remove } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import type { Entry, Folder, Tag, PasswordHistory, Attachment } from '@/types';
import { getMasterKey, encryptField, decryptField, isEncryptedField } from './crypto';

let db: Database | null = null;

const INIT_SQL = `
-- 分类表
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'Folder',
  parent_id INTEGER DEFAULT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#7DD3C0',
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 账号条目表
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  website TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  totp_secret TEXT DEFAULT '',
  totp_type TEXT DEFAULT 'totp',
  icon TEXT DEFAULT 'Lock',
  folder_id INTEGER DEFAULT NULL,
  is_favorite INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

-- 条目-标签关联表
CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 附件表
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- 密码历史表
CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  old_password TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- 插入默认分类
INSERT OR IGNORE INTO folders (id, name, icon, sort_order) VALUES 
  (1, '默认', 'Inbox', 0),
  (2, '游戏', 'Gamepad2', 1),
  (3, '社交', 'MessageCircle', 2),
  (4, '银行', 'Landmark', 3),
  (5, '工作', 'Briefcase', 4);

-- 插入默认标签
INSERT OR IGNORE INTO tags (id, name, color) VALUES 
  (1, '常用', '#7DD3C0'),
  (2, '重要', '#9B8DB5'),
  (3, '待更新', '#D4B070'),
  (4, '游戏', '#C0C8D8'),
  (5, '银行', '#7DB8D3');

-- 兼容迁移：老库补充新增列（如 totp_secret）
`;

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  db = await Database.load('sqlite:fallvault.db');
  await db.execute(INIT_SQL);
  // 兼容迁移：老库补列（ALTER TABLE 已存在列会报错，捕获忽略）
  const migrations = [
    "ALTER TABLE entries ADD COLUMN totp_secret TEXT DEFAULT ''",
    "ALTER TABLE entries ADD COLUMN custom_fields TEXT DEFAULT ''",
    "ALTER TABLE entries ADD COLUMN totp_type TEXT DEFAULT 'totp'",
  ];
  for (const m of migrations) {
    try {
      await db.execute(m);
    } catch {}
  }
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// 将 WAL 数据落盘到主库（防止恢复备份/退出时丢失 master 校验与最新写入）
export async function checkpointDatabase(): Promise<void> {
  try {
    const d = getDb();
    await d.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch { /* ignore */ }
}

// === Folders ===
export async function getFolders(): Promise<Folder[]> {
  return getDb().select('SELECT * FROM folders ORDER BY sort_order, created_at');
}

export async function createFolder(name: string, icon: string = 'Folder', parentId: number | null = null): Promise<number> {
  const result = await getDb().execute(
    'INSERT INTO folders (name, icon, parent_id) VALUES (?, ?, ?)',
    [name, icon, parentId]
  );
  return Number(result.lastInsertId);
}

export async function updateFolder(id: number, name: string, icon: string): Promise<void> {
  await getDb().execute('UPDATE folders SET name = ?, icon = ? WHERE id = ?', [name, icon, id]);
}

export async function deleteFolder(id: number): Promise<void> {
  await getDb().execute('DELETE FROM folders WHERE id = ?', [id]);
}

// === Tags ===
export async function getTags(): Promise<Tag[]> {
  return getDb().select('SELECT * FROM tags ORDER BY name');
}

export async function createTag(name: string, color: string = '#7DD3C0'): Promise<number> {
  const result = await getDb().execute('INSERT INTO tags (name, color) VALUES (?, ?)', [name, color]);
  return Number(result.lastInsertId);
}

export async function deleteTag(id: number): Promise<void> {
  await getDb().execute('DELETE FROM tags WHERE id = ?', [id]);
}

// === 加解密辅助 ===
// 解密一行 entry 的敏感字段（password/username/notes/custom_fields）
// 单条解密失败不拖垮整组：该字段置空并记录错误（可能是旧密钥加密的残留）
async function decryptRows(rows: any[]): Promise<any[]> {
  const key = getMasterKey();
  const out: any[] = [];
  for (const r of rows) {
    const row: any = { ...r, password: '', username: '', notes: '', totp_secret: '', customFields: [] };
    let err = '';
    for (const field of ['password', 'username', 'notes', 'totp_secret'] as const) {
      try {
        row[field] = await decryptField(key as any, r[field]);
      } catch (e: any) {
        if (!err) err = `${field}=${e?.message || 'decrypt fail'}`;
        row[field] = '';
      }
    }
    // 自定义字段：加密 JSON
    try {
      const raw = r.custom_fields ? await decryptField(key as any, r.custom_fields) : '';
      row.customFields = raw ? JSON.parse(raw) : [];
    } catch {
      row.customFields = [];
    }
    if (err) row.__decryptError = err;
    out.push(row);
  }
  return out;
}

// ================ Entries ================
export async function getEntries(folderId?: number, tagId?: number, search?: string): Promise<Entry[]> {
  let sql = `
    SELECT e.*, GROUP_CONCAT(t.name) as tag_names, GROUP_CONCAT(t.color) as tag_colors,
           (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) as attach_count,
           f.name as folder_name
    FROM entries e
    LEFT JOIN entry_tags et ON e.id = et.entry_id
    LEFT JOIN tags t ON et.tag_id = t.id
    LEFT JOIN folders f ON e.folder_id = f.id
  `;
  const params: any[] = [];
  const conditions: string[] = [];

  const searching = !!(search && search.trim());
  if (folderId !== undefined && !searching) {
    conditions.push('e.folder_id = ?');
    params.push(folderId);
  }
  if (tagId !== undefined && !searching) {
    conditions.push('et.tag_id = ?');
    params.push(tagId);
  }
  // 搜索时加密字段（用户名/备注/自定义字段/TOTP）无法在 SQL 中匹配，故拉取全部后在内存中全字段过滤
  if (searching) {
    // 不加 SQL 条件，交给 filterEntriesByQuery 做全字段匹配
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' GROUP BY e.id ORDER BY e.is_favorite DESC, e.updated_at DESC';

  const rows: any[] = await getDb().select(sql, params);
  const decrypted = await decryptRows(rows);
  if (searching) {
    return filterEntriesByQuery(decrypted, search!.trim());
  }
  return decrypted;
}

// 全字段、多关键词(AND)内存匹配：标题/网站/用户名/备注/标签/自定义字段/TOTP/文件夹
export function filterEntriesByQuery(entries: Entry[], rawQuery: string): Entry[] {
  const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((e) => {
    const haystacks: string[] = [
      e.title || '',
      e.website || '',
      e.username || '',
      e.notes || '',
      e.totp_secret || '',
      e.folder_name || '',
      e.tag_names || '',
    ];
    if (e.customFields) {
      for (const cf of e.customFields) {
        haystacks.push(cf.key || '', cf.value || '');
      }
    }
    const hay = haystacks.join('  ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export async function getFavorites(): Promise<Entry[]> {
  const rows: any[] = await getDb().select(`    SELECT e.*, GROUP_CONCAT(t.name) as tag_names, GROUP_CONCAT(t.color) as tag_colors,
           (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) as attach_count
    FROM entries e
    LEFT JOIN entry_tags et ON e.id = et.entry_id
    LEFT JOIN tags t ON et.tag_id = t.id
    WHERE e.is_favorite = 1
    GROUP BY e.id ORDER BY e.updated_at DESC
  `);
  return decryptRows(rows);
}

export async function getEntryById(id: number): Promise<Entry | null> {
  const rows: any[] = await getDb().select('SELECT * FROM entries WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const decrypted = await decryptRows(rows);
  return (decrypted[0] as Entry) || null;}

export async function getEntryTags(entryId: number): Promise<number[]> {
  const rows: any[] = await getDb().select('SELECT tag_id FROM entry_tags WHERE entry_id = ?', [entryId]);
  return rows.map((r) => Number(r.tag_id));
}

export async function createEntry(entry: Partial<Entry>, tagIds: number[] = []): Promise<number> {
  const key = getMasterKey();
  const cfJson = entry.customFields && entry.customFields.length
    ? await encryptField(key as any, JSON.stringify(entry.customFields))
    : '';
  const result = await getDb().execute(
    `INSERT INTO entries (title, username, password, totp_secret, totp_type, website, notes, icon, folder_id, is_favorite, custom_fields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.title || '',
      entry.username ? await encryptField(key as any, entry.username) : '',
      entry.password ? await encryptField(key as any, entry.password) : '',
      entry.totp_secret ? await encryptField(key as any, entry.totp_secret) : '',
      entry.totp_type || 'totp',
      entry.website || '',
      entry.notes ? await encryptField(key as any, entry.notes) : '',
      entry.icon || 'Lock',
      entry.folder_id || null,
      entry.is_favorite ? 1 : 0,
      cfJson,
    ]
  );
  const entryId = Number(result.lastInsertId);

  for (const tagId of tagIds) {
    await getDb().execute('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [entryId, tagId]);
  }

  return entryId;
}

export async function updateEntry(id: number, entry: Partial<Entry>, tagIds?: number[]): Promise<void> {
  const key = getMasterKey();

  // Save password history if password changed
  if (entry.password) {
    const old = await getEntryById(id);
    if (old && old.password !== entry.password) {
      await getDb().execute(
        'INSERT INTO password_history (entry_id, old_password) VALUES (?, ?)',
        [id, await encryptField(key as any, old.password)]
      );
    }
  }

  // 自定义字段：加密 JSON（若提供了则更新，未提供保持原值）
  let cfJson: string | undefined;
  if (entry.customFields !== undefined) {
    cfJson = entry.customFields.length
      ? await encryptField(key as any, JSON.stringify(entry.customFields))
      : '';
  }

  const updateCols = [
    'title = ?', 'username = ?', 'password = ?', 'totp_secret = ?', 'totp_type = ?', 'website = ?', 'notes = ?',
    'icon = ?', 'folder_id = ?', 'is_favorite = ?', 'updated_at = datetime(\'now\', \'localtime\')',
  ];
  const updateParams: any[] = [
    entry.title,
    entry.username ? await encryptField(key as any, entry.username) : '',
    entry.password ? await encryptField(key as any, entry.password) : '',
    entry.totp_secret ? await encryptField(key as any, entry.totp_secret) : '',
    entry.totp_type || 'totp',
    entry.website,
    entry.notes ? await encryptField(key as any, entry.notes) : '',
    entry.icon,
    entry.folder_id,
    entry.is_favorite ? 1 : 0,
  ];
  if (cfJson !== undefined) {
    updateCols.push('custom_fields = ?');
    updateParams.push(cfJson);
  }
  updateParams.push(id);

  await getDb().execute(
    `UPDATE entries SET ${updateCols.join(', ')} WHERE id = ?`,
    updateParams
  );

  if (tagIds !== undefined) {
    await getDb().execute('DELETE FROM entry_tags WHERE entry_id = ?', [id]);
    for (const tagId of tagIds) {
      await getDb().execute('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [id, tagId]);
    }
  }
}

export async function deleteEntry(id: number): Promise<void> {
  const entry = await getEntryById(id);
  if (entry?.icon) {
    try {
      const appData = await appDataDir();
      const normalizedIcon = entry.icon.replace(/\\/g, '/');
      const normalizedAppData = appData.replace(/\\/g, '/');
      if (normalizedIcon.includes('/icons/') && normalizedIcon.startsWith(normalizedAppData)) {
        await remove(entry.icon);
      }
    } catch {
      // 忽略文件删除错误
    }
  }
  await getDb().execute('DELETE FROM entries WHERE id = ?', [id]);
}

export async function toggleFavorite(id: number): Promise<void> {
  await getDb().execute('UPDATE entries SET is_favorite = NOT is_favorite WHERE id = ?', [id]);
}

// === Password History ===
export async function getPasswordHistory(entryId: number): Promise<PasswordHistory[]> {
  return getDb().select(
    'SELECT * FROM password_history WHERE entry_id = ? ORDER BY changed_at DESC',
    [entryId]
  );
}

// === Attachments ===
export async function getAttachments(entryId: number): Promise<Attachment[]> {
  return getDb().select('SELECT * FROM attachments WHERE entry_id = ?', [entryId]);
}

export async function addAttachment(entryId: number, fileName: string, filePath: string, fileSize: number): Promise<number> {
  const result = await getDb().execute(
    'INSERT INTO attachments (entry_id, file_name, file_path, file_size) VALUES (?, ?, ?, ?)',
    [entryId, fileName, filePath, fileSize]
  );
  return Number(result.lastInsertId);
}

export async function deleteAttachment(id: number): Promise<void> {
  await getDb().execute('DELETE FROM attachments WHERE id = ?', [id]);
}
