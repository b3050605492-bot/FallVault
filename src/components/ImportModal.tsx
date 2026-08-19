import { useEffect, useState } from 'react';
import { X, Upload, FileSpreadsheet, FileText, FileJson, AlertTriangle } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { parseImportFile, importEntries, ParsedRow, ConflictMode, ImportResult } from '@/lib/importEntries';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '@/stores/appStore';
import { translate, LangKey } from '@/lib/i18n';

interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const { settings } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = settings.language === 'en';
  const t = (k: LangKey) => translate(settings.language, k);

  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [duplicates, setDuplicates] = useState(0);
  const [mode, setMode] = useState<ConflictMode>('ask');
  const [importing, setImporting] = useState(false);

  const pickFile = async () => {
    const file = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: isEn ? 'Import files' : '支持的文件', extensions: ['xlsx', 'xls', 'csv', 'txt', 'json'] },
      ],
    });
    if (!file || typeof file !== 'string') return;
    setFileName(file.split(/[\\/]/).pop() || file);
    try {
      setRows(null);
      const parsed = await parseImportFile(file);
      if (parsed.length === 0) {
        addToast(isEn ? 'No valid entries found in file' : '文件中没有识别到有效账号', 'warning');
        return;
      }
      setRows(parsed);
      // 读取现有条目判定重复数量
      const getExisting = (await import('@/lib/db')).getEntries;
      const existing = await getExisting();
      const existingKeys = new Set(existing.map((e) => `${(e.website || '').toLowerCase()}|${(e.username || '').toLowerCase()}`));
      const dupCount = parsed.filter((r) => {
        const k = `${(r.website || '').trim().toLowerCase()}|${(r.username || '').trim().toLowerCase()}`;
        return k && existingKeys.has(k);
      }).length;
      setDuplicates(dupCount);
      addToast(
        isEn
          ? `Parsed ${parsed.length} entries${dupCount ? `, ${dupCount} duplicates` : ''}`
          : `解析到 ${parsed.length} 条${dupCount ? `，${dupCount} 条重复` : ''}`,
        'success'
      );
    } catch (e) {
      console.error('parse import failed', e);
      addToast(isEn ? 'Failed to parse file' : '解析文件失败', 'error');
    }
  };

  const doImport = async () => {
    if (!rows) return;
    setImporting(true);
    try {
      const result: ImportResult = await importEntries(rows, mode);
      addToast(
        isEn
          ? `Imported ${result.imported}${result.skipped ? `, skipped ${result.skipped}` : ''}`
          : `已导入 ${result.imported} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`,
        result.errors.length === 0 ? 'success' : 'warning'
      );
      if (result.errors.length > 0) {
        console.warn('import errors', result.errors);
      }
      onImported();
      onClose();
    } catch (e) {
      console.error('import failed', e);
      addToast(isEn ? 'Import failed' : '导入失败', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: 'rgba(8,8,16,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-lg rounded-3xl p-6"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--glass-border, rgba(255,245,245,0.4))',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-[var(--moon)] flex items-center gap-2">
            <Upload size={16} style={{ color: 'var(--mint)' }} />
            {isEn ? 'Import Entries' : '导入账号'}
          </h3>
          <button onClick={onClose} className="text-[var(--moon-faint)] hover:text-[var(--moon)]">
            <X size={16} />
          </button>
        </div>

        {/* 选择文件 */}
        {!rows && (
          <>
            <button
              onClick={pickFile}
              className="w-full py-8 rounded-2xl border-2 border-dashed border-[rgba(192,200,216,0.3)] hover:border-[var(--mint)] transition-all flex flex-col items-center gap-3 text-[var(--moon-dim)] hover:text-[var(--mint)]"
            >
              <FileSpreadsheet size={32} style={{ color: 'var(--mint)' }} />
              <span className="text-sm">{isEn ? 'Choose xlsx / csv / txt / json file' : '选择 xlsx / csv / txt / json 文件'}</span>
              <span className="text-[11px] text-[var(--moon-faint)]">
                {isEn ? 'Auto-detects columns by header' : '自动识别表头对应字段'}
              </span>
            </button>
            {fileName && <p className="mt-2 text-xs text-[var(--moon-dim)] truncate">📄 {fileName}</p>}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="px-4 py-2 rounded-xl text-sm bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all"
              >
                {isEn ? 'Cancel' : '取消'}
              </button>
            </div>
          </>
        )}

        {/* 解析预览 */}
        {rows && (
          <>
            <div className="flex items-center justify-between text-xs text-[var(--moon-dim)] mb-3">
              <span>📄 {fileName}</span>
              <span className="text-[var(--mint)]">{isEn ? `${rows.length} entries` : `${rows.length} 条`}</span>
            </div>

            <div
              className="max-h-60 overflow-y-auto rounded-xl border border-[rgba(192,200,216,0.12)]"
            >
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: 'rgba(18,18,30,0.9)' }}>
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--moon-faint)]">#</th>
                    <th className="px-3 py-2 text-left text-[var(--moon-faint)]">{isEn ? 'Title' : '标题'}</th>
                    <th className="px-3 py-2 text-left text-[var(--moon-faint)]">{isEn ? 'Username' : '账号'}</th>
                    <th className="px-3 py-2 text-left text-[var(--moon-faint)]">{isEn ? 'Website' : '网站'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-[rgba(192,200,216,0.06)]">
                      <td className="px-3 py-1.5 text-[var(--moon-faint)]">{i + 1}</td>
                      <td className="px-3 py-1.5 text-[var(--moon)] truncate max-w-28">{r.title || '—'}</td>
                      <td className="px-3 py-1.5 text-[var(--moon)] truncate max-w-28">{r.username || '—'}</td>
                      <td className="px-3 py-1.5 text-[var(--moon-faint)] truncate max-w-32">{r.website || '—'}</td>
                    </tr>
                  ))}
                  {rows.length > 50 && (
                    <tr><td colSpan={4} className="px-3 py-2 text-center text-[var(--moon-faint)]">
                      {isEn ? `... and ${rows.length - 50} more` : `... 还有 ${rows.length - 50} 条`}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 重复处理 */}
            {duplicates > 0 && (
              <div className="mt-4 p-3 rounded-xl" style={{ background: 'rgba(212,112,112,0.08)' }}>
                <div className="flex items-center gap-2 text-xs font-semibold mb-2" style={{ color: '#D47070' }}>
                  <AlertTriangle size={13} />
                  {isEn ? `${duplicates} duplicates found` : `发现 ${duplicates} 条重复账号`}
                </div>
                <div className="flex gap-2">
                  {([
                    ['ask', isEn ? 'Ask (recommended)' : '逐条询问（推荐）'],
                    ['all_skip', isEn ? 'Skip all' : '全部跳过'],
                    ['all_replace', isEn ? 'Replace all' : '全部覆盖'],
                    ['all_both', isEn ? 'Keep both' : '两者都保留'],
                  ] as [ConflictMode, string][]).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setMode(v)}
                      className={`flex-1 text-[11px] px-2 py-1.5 rounded-lg border transition-all ${
                        mode === v
                          ? 'border-[var(--mint)] text-[var(--mint)] bg-[rgba(125,211,192,0.1)]'
                          : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-dim)] hover:border-[rgba(192,200,216,0.3)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                disabled={importing}
                className="px-4 py-2.5 rounded-xl text-sm bg-[rgba(212,112,112,0.1)] text-[#D47070] hover:bg-[rgba(212,112,112,0.2)] transition-all disabled:opacity-40"
              >
                {isEn ? 'Cancel' : '取消'}
              </button>
              <button
                onClick={() => setRows(null)}
                disabled={importing}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all disabled:opacity-40"
              >
                {isEn ? 'Back' : '重新选择'}
              </button>
              <button
                onClick={doImport}
                disabled={importing}
                className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40"
                style={{ background: 'rgba(125,211,192,0.2)', color: 'var(--mint)' }}
              >
                {importing ? (isEn ? 'Importing...' : '导入中…') : (isEn ? `Import ${rows.length}` : `导入 ${rows.length} 条`)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
