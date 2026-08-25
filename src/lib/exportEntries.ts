// 账号导出工具：导出为 xlsx / csv / txt / json，含 TOTP 密钥、自定义字段、密码历史、附件（解密导出真文件）
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { readFileBytes } from '@/lib/rustFs';
import { decryptAttachment } from '@/lib/crypto';
import { getPasswordHistory, getAttachments } from '@/lib/db';
import type { Entry, Folder, Tag } from '@/types';

export interface ExportRow {
  id: number;
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  totp: string;           // 2FA 密钥（otpauth:// 或 Base32）
  folderName: string;
  tagNames: string;
  customFields: string;   // 自定义字段（key: value 列表）
  passwordHistory: string; // 密码历史（旧密码 + 修改时间）
  attachments: string;    // 附件文件名列表（真文件导出到 _attachments 子目录）
  icon: string;           // 图标标识
  isFavorite: string;
  createdAt: string;
  updatedAt: string;
  // 内部用：附件实体（用于复制真文件）
  _attachments?: { fileName: string; filePath: string }[];
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

function safeName(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '未命名';
}

// 丰富单条账号：补充分类名 + 拉取密码历史 + 附件列表
async function enrichEntry(e: Entry, folderMap: Map<number, string>): Promise<ExportRow> {
  let tagNames = '';
  if (e.tag_names) tagNames = e.tag_names.split(',').filter(Boolean).join('、');

  // 自定义字段
  let customFields = '';
  if (e.customFields && e.customFields.length) {
    customFields = e.customFields
      .map((cf: any) => `${cf.key}${cf.hidden ? '(密)' : ''}: ${cf.value}`)
      .join(' / ');
  }

  // 密码历史
  let passwordHistory = '';
  try {
    const hist = await getPasswordHistory(e.id);
    if (hist && hist.length) {
      passwordHistory = hist
        .map((h: any) => `${h.old_password} (${formatTime(h.changed_at)})`)
        .join(' / ');
    }
  } catch { /* 忽略 */ }

  // 附件
  let attachments = '';
  let _attachments: { fileName: string; filePath: string }[] = [];
  try {
    const atts = await getAttachments(e.id);
    if (atts && atts.length) {
      attachments = atts.map((a: any) => a.file_name).join('、');
      _attachments = atts.map((a: any) => ({ fileName: a.file_name, filePath: a.file_path }));
    }
  } catch { /* 忽略 */ }

  return {
    id: e.id,
    title: e.title || '',
    username: e.username || '',
    password: e.password || '',
    website: e.website || '',
    notes: (e.notes || '').replace(/\r?\n/g, ' / '),
    totp: e.totp_secret || '',
    folderName: e.folder_id != null ? (folderMap.get(e.folder_id) || '') : '',
    tagNames,
    customFields,
    passwordHistory,
    attachments,
    icon: e.icon || '',
    isFavorite: e.is_favorite ? '是' : '否',
    createdAt: formatTime(e.created_at),
    updatedAt: formatTime(e.updated_at),
    _attachments,
  };
}

// 异步构建（拉取密码历史 + 附件 + 分类名）
async function buildRows(entries: Entry[], folders: Folder[], tags: Tag[]): Promise<ExportRow[]> {
  const folderMap = new Map<number, string>();
  for (const f of folders) folderMap.set(f.id, f.name);
  const enriched = await Promise.all(entries.map((e) => enrichEntry(e, folderMap)));
  return enriched;
}

// 排序：收藏优先 → 更新时间倒序 → ID 倒序
function sortRows(rows: ExportRow[]): ExportRow[] {
  return [...rows].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite === '是' ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return b.id - a.id;
  });
}

const COLUMNS = [
  '序号', '标题', '分类', '标签', '账号/用户名', '密码', '网站地址', '2FA 密钥',
  '自定义字段', '密码历史', '附件', '图标', '备注', '收藏', '创建时间', '更新时间',
];

// 导出 xlsx
export async function exportToXlsx(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(await buildRows(entries, folders, tags));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FallVault';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('账号信息', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: '序号', key: 'idx', width: 6 },
    { header: '标题', key: 'title', width: 24 },
    { header: '分类', key: 'folder', width: 14 },
    { header: '标签', key: 'tags', width: 20 },
    { header: '账号/用户名', key: 'username', width: 26 },
    { header: '密码', key: 'password', width: 24 },
    { header: '网站地址', key: 'website', width: 34 },
    { header: '2FA 密钥', key: 'totp', width: 40 },
    { header: '自定义字段', key: 'customFields', width: 30 },
    { header: '密码历史', key: 'passwordHistory', width: 40 },
    { header: '附件', key: 'attachments', width: 30 },
    { header: '图标', key: 'icon', width: 12 },
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
      totp: r.totp,
      customFields: r.customFields,
      passwordHistory: r.passwordHistory,
      attachments: r.attachments,
      icon: r.icon,
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
    const favCell = row.getCell(14);
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
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLUMNS.length)}${rows.length + 1}` };

  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(savePath, new Uint8Array(buffer as ArrayBuffer));
}

// 导出 txt
export function buildTxt(entries: Entry[], folders: Folder[], tags: Tag[]): Promise<string> {
  return buildRows(entries, folders, tags).then((all) => {
    const rows = sortRows(all);
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
      if (r.totp) lines.push(`  2FA 密钥：${r.totp}`);
      if (r.customFields) lines.push(`  自定义字段：${r.customFields}`);
      if (r.passwordHistory) lines.push(`  密码历史：${r.passwordHistory}`);
      if (r.attachments) lines.push(`  附件：${r.attachments}（见同名 _attachments 文件夹）`);
      if (r.icon) lines.push(`  图标：${r.icon}`);
      if (r.notes) lines.push(`  备注：${r.notes}`);
      lines.push(`  收藏：${r.isFavorite}`);
      if (r.createdAt) lines.push(`  创建：${r.createdAt}`);
      if (r.updatedAt) lines.push(`  更新：${r.updatedAt}`);
      lines.push('');
    });

    lines.push('════════════════════════════════════════════════');
    lines.push('本文件由 FallVault 生成，请妥善保管密码信息。');
    return lines.join('\n');
  });
}

// 默认导出目录
export async function defaultExportDir(): Promise<string> {
  try {
    const appData = await import('@tauri-apps/api/path').then((m) => m.appDataDir());
    return `${appData}\\exports`;
  } catch {
    return '';
  }
}

// 导出 csv
export async function exportToCsv(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(await buildRows(entries, folders, tags));
  const header = COLUMNS;
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    const cells = [
      String(i + 1), r.title, r.folderName, r.tagNames, r.username, r.password, r.website, r.totp,
      r.customFields, r.passwordHistory, r.attachments, r.icon, r.notes, r.isFavorite, r.createdAt, r.updatedAt,
    ];
    lines.push(cells.map((c) => {
      const s = String(c ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(','));
  });
  const content = '﻿' + lines.join('\r\n');
  const encoder = new TextEncoder();
  await writeFile(savePath, encoder.encode(content));
}

// 导出 json（结构化：含分类/标签/2FA/自定义字段/密码历史/附件信息，可回导）
export async function exportToJson(entries: Entry[], folders: Folder[], tags: Tag[], savePath: string): Promise<void> {
  const rows = sortRows(await buildRows(entries, folders, tags));
  const data = {
    app: 'FallVault',
    version: '1.1.7',
    exportedAt: formatTime(new Date().toISOString()),
    count: rows.length,
    attachmentsDir: `${stripExt(syncBasename(savePath))}_attachments`,
    entries: rows.map((r) => ({
      title: r.title,
      username: r.username,
      password: r.password,
      website: r.website,
      totp: r.totp,
      notes: r.notes,
      folder: r.folderName,
      tags: r.tagNames,
      customFields: r.customFields,
      passwordHistory: r.passwordHistory,
      attachments: r.attachments,
      icon: r.icon,
      isFavorite: r.isFavorite === '是',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
  const content = JSON.stringify(data, null, 2);
  const encoder = new TextEncoder();
  await writeFile(savePath, encoder.encode(content));
}

// 同步获取文件名（去路径）与父目录
function syncBasename(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i >= 0 ? p.slice(i + 1) : p;
}
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
function syncDirname(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i >= 0 ? p.slice(0, i) : p;
}

// 把每个账号的附件（加密 .fa）解密并复制到导出目录的 {文件名去扩展}_attachments/ 下（按账号分子目录）
export async function exportAttachments(entries: Entry[], savePath: string): Promise<number> {
  const dir = syncDirname(savePath);
  const base = stripExt(syncBasename(savePath));
  const attRoot = `${dir}\\${base}_attachments`;
  // 重新拉取附件列表（buildRows 已拿过，但为避免额外耦合，这里直接按 entry 取）
  let copied = 0;
  for (const e of entries) {
    let atts: any[] = [];
    try { atts = await getAttachments(e.id); } catch { continue; }
    if (!atts.length) continue;
    const entryDir = `${attRoot}\\${e.id}_${safeName(e.title)}`;
    await mkdir(entryDir, { recursive: true }).catch(() => {});
    for (const a of atts) {
      try {
        const enc = await readFileBytes(a.file_path);
        const dec = await decryptAttachment(enc);
        const dest = `${entryDir}\\${a.file_name}`;
        await writeFile(dest, dec);
        copied++;
      } catch { /* 单个失败忽略 */ }
    }
  }
  return copied;
}
