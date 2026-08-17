import Database from '@tauri-apps/plugin-sql';
import { remove } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import type { Entry, Folder, Tag, PasswordHistory, Attachment } from '@/types';

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
`;

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  db = await Database.load('sqlite:fallvault.db');
  await db.execute(INIT_SQL);
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized');
  return db;
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

// === Entries ===
export async function getEntries(folderId?: number, tagId?: number, search?: string): Promise<Entry[]> {
  let sql = `
    SELECT e.*, GROUP_CONCAT(t.name) as tag_names, GROUP_CONCAT(t.color) as tag_colors,
           (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) as attach_count
    FROM entries e
    LEFT JOIN entry_tags et ON e.id = et.entry_id
    LEFT JOIN tags t ON et.tag_id = t.id
  `;
  const params: any[] = [];
  const conditions: string[] = [];

  if (folderId !== undefined) {
    conditions.push('e.folder_id = ?');
    params.push(folderId);
  }
  if (search) {
    conditions.push(`(e.title LIKE ? OR e.username LIKE ? OR e.website LIKE ? OR e.notes LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (tagId !== undefined) {
    conditions.push('et.tag_id = ?');
    params.push(tagId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' GROUP BY e.id ORDER BY e.is_favorite DESC, e.updated_at DESC';

  return getDb().select(sql, params);
}

export async function getFavorites(): Promise<Entry[]> {
  return getDb().select(`
    SELECT e.*, GROUP_CONCAT(t.name) as tag_names, GROUP_CONCAT(t.color) as tag_colors,
           (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) as attach_count
    FROM entries e
    LEFT JOIN entry_tags et ON e.id = et.entry_id
    LEFT JOIN tags t ON et.tag_id = t.id
    WHERE e.is_favorite = 1
    GROUP BY e.id ORDER BY e.updated_at DESC
  `);
}

export async function getEntryById(id: number): Promise<Entry | null> {
  const rows: any[] = await getDb().select('SELECT * FROM entries WHERE id = ?', [id]);
  return (rows[0] as Entry) || null;
}

export async function getEntryTags(entryId: number): Promise<number[]> {
  const rows: any[] = await getDb().select('SELECT tag_id FROM entry_tags WHERE entry_id = ?', [entryId]);
  return rows.map((r) => Number(r.tag_id));
}

export async function createEntry(entry: Partial<Entry>, tagIds: number[] = []): Promise<number> {
  const result = await getDb().execute(
    `INSERT INTO entries (title, username, password, website, notes, icon, folder_id, is_favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.title || '',
      entry.username || '',
      entry.password || '',
      entry.website || '',
      entry.notes || '',
      entry.icon || 'Lock',
      entry.folder_id || null,
      entry.is_favorite ? 1 : 0,
    ]
  );
  const entryId = Number(result.lastInsertId);

  for (const tagId of tagIds) {
    await getDb().execute('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [entryId, tagId]);
  }

  return entryId;
}

export async function updateEntry(id: number, entry: Partial<Entry>, tagIds?: number[]): Promise<void> {
  // Save password history if password changed
  if (entry.password) {
    const old = await getEntryById(id);
    if (old && old.password !== entry.password) {
      await getDb().execute(
        'INSERT INTO password_history (entry_id, old_password) VALUES (?, ?)',
        [id, old.password]
      );
    }
  }

  await getDb().execute(
    `UPDATE entries SET title = ?, username = ?, password = ?, website = ?, notes = ?, 
     icon = ?, folder_id = ?, is_favorite = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
    [
      entry.title,
      entry.username,
      entry.password,
      entry.website,
      entry.notes,
      entry.icon,
      entry.folder_id,
      entry.is_favorite ? 1 : 0,
      id,
    ]
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
