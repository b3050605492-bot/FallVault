// 账号导入工具：支持 xlsx / csv / json，字段自动映射 + 冲突检测
import ExcelJS from 'exceljs';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Entry, Folder, Tag } from '@/types';
import { createEntry, getEntries } from './db';
import { getMasterKey, encryptField } from './crypto';

export interface ParsedRow {
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  folder?: string;
  tags?: string;
}

export type ConflictAction = 'skip' | 'replace' | 'both';
export type ConflictMode = 'ask' | 'all_skip' | 'all_replace' | 'all_both';

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

// ---- 表头别名映射 ----
const HEADER_ALIASES: Record<string, 'title' | 'username' | 'password' | 'website' | 'notes' | 'folder' | 'tags'> = {
  title: 'title', name: 'title', 标题: 'title', 名称: 'title', 站点: 'title', 网站名称: 'title',
  username: 'username', user: 'username', account: 'username', email: 'username', phone: 'username',
  用户名: 'username', 账号: 'username', 账户: 'username', 邮箱: 'username', 手机: 'username', 手机号: 'username', 用户: 'username',
  password: 'password', pwd: 'password', pass: 'password', 密码: 'password', 口令: 'password',
  website: 'website', url: 'website', link: 'website', site: 'website',
  网站: 'website', 网址: 'website', 地址: 'website', 链接: 'website', url地址: 'website', 网站地址: 'website',
  notes: 'notes', note: 'notes', remark: 'notes', comment: 'notes', description: 'notes',
  备注: 'notes', 说明: 'notes', 注释: 'notes', 描述: 'notes', 详情: 'notes',
  folder: 'folder', category: 'folder', group: 'folder',
  文件夹: 'folder', 分类: 'folder', 分组: 'folder', 类别: 'folder',
  tags: 'tags', tag: 'tags', label: 'tags', labels: 'tags',
  标签: 'tags', 标记: 'tags', 关键词: 'tags',
};

function normalizeHeader(h: string): string {
  return String(h || '').trim().toLowerCase().replace(/[_\-\s]/g, '');
}

function mapField(header: string): keyof ParsedRow | null {
  const norm = normalizeHeader(header);
  for (const [alias, field] of Object.entries(HEADER_ALIASES)) {
    if (normalizeHeader(alias) === norm) return field;
  }
  // 模糊匹配：包含关键词
  if (norm.includes('密码') || norm.includes('password') || norm.includes('pwd')) return 'password';
  if (norm.includes('用户') || norm.includes('账号') || norm.includes('账号名') || norm.includes('username') || norm.includes('user') || norm.includes('email') || norm.includes('邮箱')) return 'username';
  if (norm.includes('网站') || norm.includes('网址') || norm.includes('url') || norm.includes('website') || norm.includes('link')) return 'website';
  if (norm.includes('备注') || norm.includes('说明') || norm.includes('notes') || norm.includes('remark')) return 'notes';
  if (norm.includes('标题') || norm.includes('名称') || norm.includes('name') || norm.includes('title') || norm.includes('站点')) return 'title';
  if (norm.includes('分类') || norm.includes('分组') || norm.includes('folder') || norm.includes('category')) return 'folder';
  if (norm.includes('标签') || norm.includes('tag')) return 'tags';
  return null;
}

// ---- JSON 解析 ----
function parseJson(text: string): ParsedRow[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (data.entries || data.items || data.data || Object.values(data || {})).find?.(Array.isArray) as any[] || [];
  return arr.filter((r) => r && typeof r === 'object').map((r) => ({
    title: String(r.title ?? r.name ?? r.标题 ?? r.名称 ?? ''),
    username: String(r.username ?? r.account ?? r.email ?? r.账号 ?? r.用户名 ?? r.邮箱 ?? ''),
    password: String(r.password ?? r.pwd ?? r.密码 ?? ''),
    website: String(r.website ?? r.url ?? r.网站 ?? r.网址 ?? ''),
    notes: String(r.notes ?? r.remark ?? r.备注 ?? r.说明 ?? ''),
    folder: String(r.folder ?? r.category ?? r.分类 ?? r.分组 ?? ''),
    tags: String(r.tags ?? r.tag ?? r.标签 ?? '').replace(/[\[\]"]/g, ''),
  }));
}

function csvParse(text: string): string[][] {
  // 简单 CSV 解析（支持引号包裹 + 逗号/分号分隔）
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  // 探测分隔符
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuote = true;
        else if (ch === delim) { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

// ---- 从表头解析行 ----
function rowsFromHeader(headerCells: string[], dataRows: string[][]): ParsedRow[] {
  const map: (keyof ParsedRow | null)[] = headerCells.map((h) => mapField(h));
  return dataRows.map((cells) => {
    const row: ParsedRow = { title: '', username: '', password: '', website: '', notes: '' };
    cells.forEach((cell, i) => {
      const field = map[i];
      if (field && cell !== undefined) (row as any)[field] = String(cell).trim();
    });
    return row;
  }).filter((r) => r.title || r.username || r.password || r.website);
}

// ---- 解析文件 ----
export async function parseImportFile(filePath: string): Promise<ParsedRow[]> {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf);

  if (ext === 'json') {
    const text = new TextDecoder('utf-8').decode(bytes);
    return parseJson(text);
  }

  if (ext === 'csv' || ext === 'txt') {
    // 尝试 UTF-8 / GBK 解码
    let text: string;
    try {
      text = new TextDecoder('utf-8').decode(bytes);
      // UTF-8 中文可能乱码，检测（有替换字符则试 GBK）
      if (text.includes('\uFFFD')) throw new Error('gbk');
    } catch {
      // Windows Chinese 的 csv 常是 GBK/GB18030
      const decoder = new (TextDecoder as any)('gb18030');
      text = decoder.decode(bytes);
    }
    const matrix = csvParse(text);
    if (matrix.length === 0) return [];
    // 有表头（第一行含"标题/密码/账号"等关键词）→ 按表头映射；否则按固定列
    const headerSample = matrix[0].join(' ');
    const hasHeader = /标题|密码|账号|用户|网站|备注|title|password|username|website/i.test(headerSample);
    if (hasHeader) {
      return rowsFromHeader(matrix[0], matrix.slice(1));
    }
    // 无表头：固定顺序 title, username, password, website, notes
    return matrix.map((cells) => ({
      title: cells[0] || '',
      username: cells[1] || '',
      password: cells[2] || '',
      website: (cells[3] || '').trim(),
      notes: cells[4] || '',
    })).filter((r) => r.title || r.password || r.username);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as any);
    const sheet = wb.worksheets[0];
    if (!sheet) return [];
    const matrix: string[][] = [];
    sheet.eachRow((row, rowNum) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        cells.push(v == null ? '' : String(v instanceof Date ? v.toISOString() : v));
      });
      matrix.push(cells);
    });
    if (matrix.length === 0) return [];
    const headerSample = matrix[0].join(' ');
    const hasHeader = /标题|密码|账号|用户|网站|备注|title|password|username|website/i.test(headerSample);
    if (hasHeader) return rowsFromHeader(matrix[0], matrix.slice(1));
    return matrix.map((cells) => ({
      title: cells[0] || '',
      username: cells[1] || '',
      password: cells[2] || '',
      website: (cells[3] || '').trim(),
      notes: cells[4] || '',
    })).filter((r) => r.title || r.password || r.username);
  }

  throw new Error('unsupported format');
}

// 判定重复 key
function entryKey(r: ParsedRow): string {
  return `${(r.website || '').trim().toLowerCase()}|${(r.username || '').trim().toLowerCase()}`;
}

// ---- 执行导入 ----
export async function importEntries(
  rows: ParsedRow[],
  mode: ConflictMode,
): Promise<ImportResult> {
  const key = getMasterKey();
  if (!key) throw new Error('vault locked');

  // 现有条目（解密后）
  const existing = await getEntries();
  const existingKeys = new Set(existing.map((e) => `${(e.website || '').toLowerCase()}|${(e.username || '').toLowerCase()}`));

  const result: ImportResult = { imported: 0, skipped: 0, duplicates: 0, errors: [] };
  const localSeen = new Set<string>();

  for (const row of rows) {
    const k = entryKey(row);
    const isDup = existingKeys.has(k) || localSeen.has(k);

    let action: 'add' | 'skip' | 'replace' | 'both' = 'add';
    if (isDup && k) {
      if (mode === 'all_skip') action = 'skip';
      else if (mode === 'all_replace') action = 'replace';
      else if (mode === 'all_both') action = 'both';
      else action = 'skip'; // ask 默认跳过重复（UI 可覆盖）
      result.duplicates++;
    }

    if (action === 'skip') {
      result.skipped++;
      continue;
    }

    try {
      // 解析标签名 → tag id（按需创建标签）
      const tagIds = await resolveTagIds(row.tags);
      await createEntry({
        title: row.title || (row.website ? row.website.replace(/^https?:\/\/(www\.)?/, '') : '未命名'),
        username: row.username || '',
        password: row.password || '',
        website: row.website || '',
        notes: row.notes || '',
        folder_id: undefined,
      }, tagIds);
      localSeen.add(k);
      result.imported++;
    } catch (e: any) {
      result.errors.push(`${row.title || row.website}: ${e?.message || 'error'}`);
    }
  }

  return result;
}

// 解析标签名列表 → tag id（不存在的自动创建）
async function resolveTagIds(tagsStr: string | undefined): Promise<number[]> {
  if (!tagsStr) return [];
  const names = tagsStr
    .split(/[,，、;；|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return [];
  const { getTags, createTag } = await import('./db');
  const existing = await getTags();
  const nameToId = new Map(existing.map((t) => [t.name, t.id]));
  const ids: number[] = [];
  for (const name of names) {
    if (nameToId.has(name)) {
      ids.push(nameToId.get(name)!);
    } else {
      const newId = await createTag(name);
      nameToId.set(name, newId);
      ids.push(newId);
    }
  }
  return ids;
}

// 导入后返回文件夹/标签需要合并？本版本保持简单：不自动建文件夹标签
