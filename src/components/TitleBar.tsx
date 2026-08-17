import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, Lock, LockKeyhole } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { translate, LangKey } from '@/lib/i18n';

export function TitleBar({ onLock }: { onLock?: () => void }) {
  const { settings } = useAppStore();
  const isEn = settings.language === 'en';
  const t = (k: LangKey) => translate(settings.language, k);

  const minimize = () => getCurrentWindow().minimize();
  const toggleMax = () => getCurrentWindow().toggleMaximize();
  const close = () => getCurrentWindow().close();

  return (
    <div
      className="h-9 flex items-center select-none flex-shrink-0"
      style={{
        background: 'var(--glass-bg)',
        borderBottom: '1px solid var(--glass-border)',
        backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
      }}
      data-tauri-drag-region
    >
      {/* 左侧 Logo + 标题 */}
      <div className="flex items-center gap-2 pl-4" data-tauri-drag-region>
        <Lock size={13} style={{ color: 'var(--mint)' }} />
        <span className="text-xs font-semibold text-[var(--moon)] tracking-wide">
          {t('appName')}
        </span>
      </div>

      {/* 窗口控制按钮 */}
      <div className="ml-auto flex items-center h-full" data-tauri-drag-region={false}>
        {onLock && (
          <button
            onClick={onLock}
            className="w-10 h-full flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(125,211,192,0.12)] transition-colors"
            title={isEn ? 'Lock' : '锁定'}
          >
            <LockKeyhole size={14} />
          </button>
        )}
        <button
          onClick={minimize}
          className="w-10 h-full flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.1)] transition-colors"
          title={isEn ? 'Minimize' : '最小化'}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={toggleMax}
          className="w-10 h-full flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.1)] transition-colors"
          title={isEn ? 'Maximize' : '最大化'}
        >
          <Square size={12} />
        </button>
        <button
          onClick={close}
          className="w-11 h-full flex items-center justify-center text-[var(--moon-faint)] hover:text-white hover:bg-[rgba(212,112,112,0.7)] transition-colors"
          title={isEn ? 'Close' : '关闭'}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}