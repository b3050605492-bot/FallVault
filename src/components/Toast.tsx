import { useEffect } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors = {
  success: '#7DD3C0',
  error: '#D47070',
  warning: '#D4B070',
  info: '#7DB8D3',
};

export function Toast() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none items-end">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onClose }: { toast: { id: string; message: string; type: keyof typeof icons }; onClose: () => void }) {
  const Icon = icons[toast.type];
  const color = colors[toast.type];

  useEffect(() => {
    const timer = setTimeout(onClose, 2000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl text-sm min-w-[200px] max-w-[360px]"
      style={{
        background: 'var(--glass-bg)',
        border: `1px solid ${color}30`,
        backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${color}15`,
        animation: 'toastIn 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards',
      }}
    >
      <Icon size={18} style={{ color, flexShrink: 0 }} />
      <span className="text-[var(--moon)] flex-1">{toast.message}</span>
      <button onClick={onClose} className="text-[var(--moon-faint)] hover:text-[var(--moon)] transition-colors p-0.5">
        <X size={14} />
      </button>
    </div>
  );
}
