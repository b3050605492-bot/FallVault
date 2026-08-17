import { useAppStore } from '@/stores/appStore';
import { AlertTriangle, X } from 'lucide-react';

export function ConfirmDialog() {
  const { confirmDialog, setConfirmDialog } = useAppStore();

  if (!confirmDialog.open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDialog({ open: false })} />

      <div
        className="relative z-10 w-full max-w-sm p-6"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: '18px',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          boxShadow: '0 0 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(210,210,220,0.05)',
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(212, 112, 112, 0.1)' }}
          >
            <AlertTriangle size={20} style={{ color: '#D47070' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--moon)]">
              {confirmDialog.title || '确认操作'}
            </h3>
            <p className="text-sm text-[var(--moon-dim)] mt-1.5 leading-relaxed">
              {confirmDialog.message || '确定要执行此操作吗？'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => {
              confirmDialog.onCancel?.();
              setConfirmDialog({ open: false });
            }}
            className="rune-btn px-5 py-2.5 text-sm"
          >
            {confirmDialog.cancelText || '取消'}
          </button>
          <button
            onClick={() => {
              confirmDialog.onConfirm?.();
              setConfirmDialog({ open: false });
            }}
            className="rune-btn px-5 py-2.5 text-sm font-medium"
            style={{
              background: 'rgba(212, 112, 112, 0.15)',
              color: '#D47070',
              borderColor: 'rgba(212, 112, 112, 0.3)',
            }}
          >
            {confirmDialog.confirmText || '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
