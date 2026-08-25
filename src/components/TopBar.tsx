import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, Moon, Sun, Globe, Download, Upload, FileSpreadsheet, FileText, FileJson, FileCode2, FileInput } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { SpecularButton } from '@/components/SpecularButton';
import { exportToXlsx, exportToCsv, exportToJson, buildTxt, exportAttachments } from '@/lib/exportEntries';
import { importBrowserCsv } from '@/lib/csvImport';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { basename } from '@tauri-apps/api/path';

export function TopBar() {
  const { searchQuery, setSearchQuery, settings, updateSettings } = useAppStore();
  const { addToast } = useToastStore();
  const t = (k: LangKey) => translate(settings.language, k);
  const isEn = settings.language === 'en';
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const toggleLanguage = () => {
    const next: 'zh' | 'en' = settings.language === 'zh' ? 'en' : 'zh';
    updateSettings({ language: next });
    addToast(next === 'zh' ? '已切换为中文' : 'Switched to English', 'success');
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cycleTheme = () => {
    const ids = THEMES.map((th) => th.id);
    const idx = ids.indexOf(settings.theme);
    const nextId = ids[(idx + 1) % ids.length];
    const nextTheme = THEMES.find((th) => th.id === nextId)!;
    updateSettings({ theme: nextId });
    addToast(isEn ? `Theme: ${nextTheme.nameEn}` : `主题：${nextTheme.name}`, 'success');
  };

  const openModal = () => {
    useAppStore.getState().setTemplatePrefill(null);
    useAppStore.getState().setIsEntryModalOpen(true);
  };

  // 导出当前筛选结果
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const exportMenuPanelRef = useRef<HTMLDivElement>(null);

  // 导入菜单定位
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [importMenuPos, setImportMenuPos] = useState<{ top: number; right: number } | null>(null);

  // 用 document 级监听关闭导出菜单（fixed 遮罩会被 backdrop-filter 破坏，改用这个）
  useEffect(() => {
    if (!exportOpen) return;
    // 打开时根据导出按钮位置计算菜单锚点
    if (exportMenuRef.current) {
      const r = exportMenuRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 8, right: 20 });
    }
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const inMenu = exportMenuRef.current && exportMenuRef.current.contains(el);
      const inPanel = exportMenuPanelRef.current && exportMenuPanelRef.current.contains(el);
      if (!inMenu && !inPanel) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [exportOpen]);

  // 导入菜单：定位 + 点击外部关闭
  useEffect(() => {
    if (!importOpen) return;
    if (importMenuRef.current) {
      const r = importMenuRef.current.getBoundingClientRect();
      setImportMenuPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (importMenuRef.current && !importMenuRef.current.contains(el)) setImportOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [importOpen]);

  const handleExport = async (format: 'xlsx' | 'txt' | 'csv' | 'json') => {
    const state = useAppStore.getState();
    const entries = state.entries;
    if (entries.length === 0) {
      addToast(isEn ? 'No entries to export' : '当前没有可导出的账号', 'warning');
      return;
    }

    setExporting(true);
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const defaultName = `FallVault_账号导出_${stamp}.${format}`;

      const filterMap: Record<string, { name: string; extensions: string[] }> = {
        xlsx: { name: 'Excel 工作簿', extensions: ['xlsx'] },
        txt: { name: '文本文件', extensions: ['txt'] },
        csv: { name: 'CSV 文件', extensions: ['csv'] },
        json: { name: 'JSON 文件', extensions: ['json'] },
      };

      const filePath = await save({
        defaultPath: defaultName,
        filters: [filterMap[format]],
      });
      if (!filePath) return; // 用户取消

      if (format === 'xlsx') {
        await exportToXlsx(entries, state.folders, state.tags, filePath);
      } else if (format === 'csv') {
        await exportToCsv(entries, state.folders, state.tags, filePath);
      } else if (format === 'json') {
        await exportToJson(entries, state.folders, state.tags, filePath);
      } else {
        const text = await buildTxt(entries, state.folders, state.tags);
        // 确保父目录存在
        const parent = filePath.substring(0, filePath.lastIndexOf('\\'));
        try { await mkdir(parent, { recursive: true }); } catch { }
        await writeFile(filePath, new TextEncoder().encode(text));
      }

      // 附件：解密并复制真文件到 {文件名}_attachments/ 子目录
      let attMsg = '';
      try {
        const n = await exportAttachments(entries, filePath);
        if (n > 0) {
          const bn = await basename(filePath);
          attMsg = `，附件 ${n} 个已导出到 ${bn.replace(/\.[^.]+$/, '')}_attachments/`;
        }
      } catch { /* 附件失败不影响主文件 */ }

      addToast(isEn ? `Exported ${entries.length} entries${attMsg}` : `已导出 ${entries.length} 个账号${attMsg}`, 'success');
    } catch (e) {
      console.error('Export failed:', e);
      addToast(isEn ? 'Export failed' : '导出失败，请重试', 'error');
    } finally {
      setExporting(false);
      setExportOpen(false);
    }
  };

  return (
    <div className="rune-panel m-3 mb-0 p-3 flex items-center gap-3">
      <div className="relative flex-1 max-w-md group">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--moon-faint)] group-focus-within:text-[var(--mint)] transition-colors" size={17} />
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="rune-input w-full pl-10 pr-9 py-2.5 text-sm"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--moon-faint)] hover:text-[var(--moon)] transition-colors text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={toggleLanguage}
          className="rune-btn p-2.5 rounded-xl text-[var(--moon-dim)] hover:text-[var(--moon)]"
          title={t('switchToEn')}
        >
          <Globe size={17} />
        </button>

        <button
          onClick={cycleTheme}
          className="rune-btn p-2.5 rounded-xl text-[var(--moon-dim)] hover:text-[var(--moon)]"
          title={t('toggleTheme')}
        >
          {settings.theme === 'default' ? <Moon size={17} /> : <Sun size={17} />}
        </button>

        {/* 导入按钮 + 下拉菜单 */}
        <div className="relative" ref={importMenuRef}>
          <button
            onClick={() => setImportOpen(!importOpen)}
            className="rune-btn p-2.5 rounded-xl text-[var(--moon-dim)] hover:text-[var(--moon)]"
            title={isEn ? 'Import entries' : '导入账号'}
          >
            <Upload size={17} />
          </button>
          {importOpen && createPortal(
            <div
              className="fixed z-[90] w-60 p-1.5 rounded-2xl"
              style={{
                position: 'fixed',
                top: importMenuPos?.top ?? 60,
                right: importMenuPos?.right ?? 20,
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            >
              <button
                onClick={() => { setImportOpen(false); import('@tauri-apps/api/event').then((m) => m.emit('fallvault:open-import')).catch(() => {}); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
              >
                <FileText size={15} style={{ color: 'var(--mint)' }} />
                {isEn ? 'Import backup (.fvault)' : '导入备份 (.fvault)'}
              </button>
              <button
                onClick={async () => {
                  setImportOpen(false);
                  try {
                    const { imported, skipped } = await importBrowserCsv();
                    addToast(
                      isEn ? `Imported ${imported} accounts${skipped ? ` (${skipped} skipped)` : ''}` : `已导入 ${imported} 个账号${skipped ? `（跳过 ${skipped} 个）` : ''}`,
                      'success'
                    );
                    useAppStore.getState().refreshAll();
                  } catch (e: any) {
                    addToast(isEn ? 'Import failed' : '导入失败', 'error');
                  }
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
              >
                <FileInput size={15} style={{ color: 'var(--warning)' }} />
                {isEn ? 'From browser CSV (Chrome/Edge)' : '从浏览器 CSV 导入（Chrome/Edge）'}
              </button>
            </div>,
            document.body
          )}
        </div>

        {/* 导出按钮 + 下拉菜单 */}
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={exporting}
            className="rune-btn p-2.5 rounded-xl text-[var(--moon-dim)] hover:text-[var(--moon)] disabled:opacity-40"
            title={isEn ? 'Export entries' : '导出账号'}
          >
            {exporting ? (
              <span className="w-4 h-4 border-2 border-[var(--mint)] border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <Download size={17} />
            )}
          </button>

          {exportOpen && createPortal(
            <div
              ref={exportMenuPanelRef}
              className="fixed z-[90] w-56 p-1.5 rounded-2xl"
              style={{
                position: 'fixed',
                top: menuPos?.top ?? 0,
                right: menuPos?.right ?? 20,
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
              >
                <div className="px-3 py-2 text-[11px] text-[var(--moon-faint)]">
                  {isEn ? `Export ${useAppStore.getState().entries.length} entries` : `导出 ${useAppStore.getState().entries.length} 个账号`}
                </div>
                <button
                  onClick={() => handleExport('xlsx')}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all disabled:opacity-40"
                >
                  <FileSpreadsheet size={15} style={{ color: 'var(--success)' }} />
                  {isEn ? 'Excel (.xlsx)' : 'Excel 表格 (.xlsx)'}
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all disabled:opacity-40"
                >
                  <FileCode2 size={15} style={{ color: 'var(--mint)' }} />
                  {isEn ? 'CSV (.csv)' : 'CSV 表格 (.csv)'}
                </button>
                <button
                  onClick={() => handleExport('json')}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all disabled:opacity-40"
                >
                  <FileJson size={15} style={{ color: 'var(--warning)' }} />
                  {isEn ? 'JSON (.json)' : '结构化 JSON (.json)'}
                </button>
                <button
                  onClick={() => handleExport('txt')}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all disabled:opacity-40"
                >
                  <FileText size={15} style={{ color: 'var(--moon-dim)' }} />
                  {isEn ? 'Text file (.txt)' : '文本文件 (.txt)'}
                </button>
              </div>,
            document.body
          )}
        </div>

        <SpecularButton
          onClick={openModal}
          className="px-4 py-2.5 text-sm font-medium"
        >
          <Plus size={17} />
          <span>{t('newEntry')}</span>
        </SpecularButton>
      </div>

    </div>
  );
}
