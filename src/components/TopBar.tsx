import { useState } from 'react';
import { Search, Plus, Moon, Sun, Globe, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { SpecularButton } from '@/components/SpecularButton';
import { exportToXlsx, buildTxt } from '@/lib/exportEntries';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';

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
  const handleExport = async (format: 'xlsx' | 'txt') => {
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

      const filePath = await save({
        defaultPath: defaultName,
        filters: format === 'xlsx'
          ? [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          : [{ name: '文本文件', extensions: ['txt'] }],
      });
      if (!filePath) return; // 用户取消

      if (format === 'xlsx') {
        await exportToXlsx(entries, state.folders, state.tags, filePath);
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

        {/* 导出按钮 + 下拉菜单 */}
        <div className="relative">
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

          {exportOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
              <div
                className="absolute right-0 top-full mt-2 z-50 w-52 p-1.5 rounded-2xl"
                style={{
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
                  onClick={() => handleExport('txt')}
                  disabled={exporting}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)] transition-all disabled:opacity-40"
                >
                  <FileText size={15} style={{ color: 'var(--warning)' }} />
                  {isEn ? 'Text file (.txt)' : '文本文件 (.txt)'}
                </button>
              </div>
            </>
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