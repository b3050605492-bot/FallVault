// 账号导出工具：导出为 xlsx / txt
import ExcelJS from 'exceljs';
import { writeFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import type { Entry, Folder, Tag } from '@/types';

export interface ExportRow {
  id: number;
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  folderName: string;
  tagNames: string;
  isFavorite: string;
  createdAt: string;
  updatedAt: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTime(iso: string | undefined | null): string {
  if (!iso) return '';
  // SQLite 的 datetime 格式: YYYY-MM-DD HH:MM:SS
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso)) return iso;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(iso);
  }
}

function buildRows(entries: Entry[], folders: Folder[], tags: Tag[]): ExportRow[] {
  const folderMap = new Map<number, string>();
  for (const f of folders) folderMap.set(f.id, f.name);
  const tagMap = new Map<number, string>();
  for (const t of tags) tagMap.set(t.id, t.name);

  return entries.map((e) => {
    // 解析联表字段（tag_names 是逗号拼接）
    let tagNames = '';
    if (e.tag_names) {
      tagNames = e.tag_names.split(',').filter(Boolean).join('、');
    }
    return {
      id: e.id,
      title: e.title || '',
      username: e.username || '',
      password: e.password || '',
      website: e.website || '',
      notes: (e.notes || '').replace(/\r?\n/g, ' / '),
      folderName: e.folder_id != null ? (folderMap.get(e.folder_id) || '') : '',
      tagNames,
      isFavorite: e.is_favorite ? '是' : '否',
      createdAt: formatTime(e.created_at),
      updatedAt: formatTime(e.updated_at),
    };
  });
}

// 排序：收藏优先 → 更新时间倒序 → ID 倒序
function sortRows(rows: ExportRow[]): ExportRow[] {
  return [...rows].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite === '是' ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return b.id - a.id;
  });
}

// 导出 xlsx
export async function exportToXlsx(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(buildRows(entries, folders, tags));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FallVault';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('账号信息', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headers = [
    '序号', '标题', '分类', '标签', '账号/用户名', '密码', '网站地址', '备注', '收藏', '创建时间', '更新时间',
  ];
  sheet.columns = [
    { header: '序号', key: 'idx', width: 6 },
    { header: '标题', key: 'title', width: 24 },
    { header: '分类', key: 'folder', width: 14 },
    { header: '标签', key: 'tags', width: 20 },
    { header: '账号/用户名', key: 'username', width: 26 },
    { header: '密码', key: 'password', width: 24 },
    { header: '网站地址', key: 'website', width: 34 },
    { header: '备注', key: 'notes', width: 34 },
    { header: '收藏', key: 'fav', width: 8 },
    { header: '创建时间', key: 'created', width: 20 },
    { header: '更新时间', key: 'updated', width: 20 },
  ];

  // 表头样式
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1A1A2E' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  rows.forEach((r, i) => {
    sheet.addRow({
      idx: i + 1,
      title: r.title,
      folder: r.folderName,
      tags: r.tagNames,
      username: r.username,
      password: r.password,
      website: r.website,
      notes: r.notes,
      fav: r.isFavorite,
      created: r.createdAt,
      updated: r.updatedAt,
    });
  });

  // 数据行样式
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 20;
    row.alignment = { vertical: 'middle' };
    // 收藏行高亮
    const favCell = row.getCell(9);
    if (favCell.value === '是') {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8F6F1' },
      };
    }
  });

  // 边框
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D5E0' } },
        left: { style: 'thin', color: { argb: 'FFD0D5E0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D5E0' } },
        right: { style: 'thin', color: { argb: 'FFD0D5E0' } },
      };
    });
  });

  // 自动筛选
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + headers.length)}${rows.length + 1}` };

  // 写文件（exceljs 生成 buffer）
  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(savePath, new Uint8Array(buffer as ArrayBuffer));
}

// 导出 txt
export function buildTxt(entries: Entry[], folders: Folder[], tags: Tag[]): string {
  const rows = sortRows(buildRows(entries, folders, tags));
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const lines: string[] = [];
  lines.push('════════════════════════════════════════════════');
  lines.push('          FallVault 账号信息导出');
  lines.push(`          导出时间：${timeStr}`);
  lines.push(`          账号总数：${rows.length}`);
  lines.push('════════════════════════════════════════════════');
  lines.push('');

  rows.forEach((r, i) => {
    lines.push(`【${i + 1}】${r.title}`);
    lines.push('─'.repeat(46));
    if (r.folderName) lines.push(`  分类：${r.folderName}`);
    if (r.tagNames) lines.push(`  标签：${r.tagNames}`);
    lines.push(`  账号：${r.username}`);
    lines.push(`  密码：${r.password}`);
    if (r.website) lines.push(`  网址：${r.website}`);
    if (r.notes) lines.push(`  备注：${r.notes}`);
    lines.push(`  收藏：${r.isFavorite}`);
    if (r.createdAt) lines.push(`  创建：${r.createdAt}`);
    if (r.updatedAt) lines.push(`  更新：${r.updatedAt}`);
    lines.push('');
  });

  lines.push('════════════════════════════════════════════════');
  lines.push('本文件由 FallVault 生成，请妥善保管密码信息。');
  return lines.join('\n');
}

// 默认导出目录：文档/FallVaultExports
export async function defaultExportDir(): Promise<string> {
  try {
    const appData = await appDataDir();
    return `${appData}\\exports`;
  } catch {
    return '';
  }
}

// 导出 csv
export async function exportToCsv(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(buildRows(entries, folders, tags));
  // BOM 让 Excel 正确识别 UTF-8 中文
  const header = ['序号', '标题', '分类', '标签', '账号/用户名', '密码', '网站地址', '备注', '收藏', '创建时间', '更新时间'];
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    const cells = [
      String(i + 1), r.title, r.folderName, r.tagNames, r.username, r.password, r.website, r.notes, r.isFavorite, r.createdAt, r.updatedAt,
    ];
    // 转义：包含逗号/引号/换行的字段加引号
    lines.push(cells.map((c) => {
      const s = String(c ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(','));
  });
  const content = '\uFEFF' + lines.join('\r\n');
  const encoder = new TextEncoder();
  await writeFile(savePath, encoder.encode(content));
}

// 导出 json（结构化：含分类/标签信息，可回导）
export async function exportToJson(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(buildRows(entries, folders, tags));
  const { appDataDir } = await import('@tauri-apps/api/path');
  const data = {
    app: 'FallVault',
    version: '1.1.2',
    exportedAt: formatTime(new Date().toISOString()),
    count: rows.length,
    entries: rows.map((r) => ({
      title: r.title,
      username: r.username,
      password: r.password,
      website: r.website,
      notes: r.notes,
      folder: r.folderName,
      tags: r.tagNames,
      isFavorite: r.isFavorite === '是',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
  const content = JSON.stringify(data, null, 2);
  const encoder = new TextEncoder();
  await writeFile(savePath, encoder.encode(content));
}