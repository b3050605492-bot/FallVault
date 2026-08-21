import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { createEntry } from './db';

interface CsvRow {
  [key: string]: string;
}

// 解析 CSV（支持引号包裹、逗号分隔、首行为表头）
// Chrome/Edge 导出的密码格式表头示例：
//   name,url,username,password
//   url,username,password   （老格式无 name）
//   name,url,username,password,note
function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] ?? '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// 从浏览器导出的 CSV 导入账号（Chrome / Edge 等）
export async function importBrowserCsv(): Promise<{ imported: number; skipped: number }> {
  const selected = await open({
    multiple: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (!selected || typeof selected !== 'string') return { imported: 0, skipped: 0 };

  const text = await readTextFile(selected);
  const { rows } = parseCsv(text);
  let imported = 0;
  let skipped = 0;

  for (const r of rows) {
    const username = r['username'] || '';
    const password = r['password'] || '';
    // 没有密码的浏览器行（如信用卡/地址）跳过
    if (!password) { skipped++; continue; }
    const url = r['url'] || '';
    const name = r['name'] || '';
    const title = name || url || username || '未命名';
    const website = url.startsWith('http') ? url : (url ? `https://${url}` : '');
    await createEntry({
      title,
      username,
      password,
      website,
      notes: '',
      icon: '',
      folder_id: null,
      is_favorite: false,
    });
    imported++;
  }
  return { imported, skipped };
}
