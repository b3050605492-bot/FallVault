import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, Moon, Sun, Globe, Download, Upload, FileSpreadsheet, FileText, FileJson, FileCode2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { SpecularButton } from '@/components/SpecularButton';
import { exportToXlsx, exportToCsv, exportToJson, buildTxt } from '@/lib/exportEntries';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';

export function TopBar() {
  const { searchQuery, setSearchQuery, settings, updateSettings } = useAppStore();
  const { addToast } = useToastStore();
  const t = (k: LangKey) => translate(settings.language, k);
  const isEn = settings.language === 'en';
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const toggleLanguage = () => {
    const next: 'zh' | 'en' = settings.language === 'zh' ? 'en' : 'zh';
    updateSettings({ language: next });
    addToast(next === 'zh' ? '已切换为中文' : 'Switched to English', 'success');
  };

  const cycleTheme = () => {
    const ids = THEMES.map((th) => th.id);
    const idx = ids.indexOf(settings.theme);
    const nextId = ids[(idx + 1) % ids.length];
    const nextTheme = THEMES.find((th) => th.id === nextId)!;
    updateSettings({ theme: nextId });
    addToast(isEn ? `Theme: ${nextTheme.nameEn}` : `主题：${nextTheme.name}`, 'success');
  };

  const openModal = () => {
    useAppStore.getState().setIsEntryModalOpen(true);
  };

  // 导出当前筛选结果
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const exportMenuPanelRef = useRef<HTMLDivElement>(null);

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
        const text = buildTxt(entries, state.folders, state.tags);
        // 确保父目录存在
        const parent = filePath.substring(0, filePath.lastIndexOf('\\'));
        try { await mkdir(parent, { recursive: true }); } catch {}
        await writeFile(filePath, new TextEncoder().encode(text));
      }
      addToast(isEn ? `Exported ${entries.length} entries` : `已导出 ${entries.length} 个账号`, 'success');
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

        {/* 导入按钮 */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('fallvault:open-import'))}
          className="rune-btn p-2.5 rounded-xl text-[var(--moon-dim)] hover:text-[var(--moon)]"
          title={isEn ? 'Import entries' : '导入账号'}
        >
          <Upload size={17} />
        </button>

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
          className="px-5 py-2.5 text-sm font-medium"
        >
          <Plus size={17} />
          <span>{t('newEntry')}</span>
        </SpecularButton>
      </div>

    </div>
  );
}
