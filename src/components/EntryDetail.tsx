import { useState, useEffect } from 'react';
import { Lock, Star, ExternalLink, Copy, Eye, EyeOff, Edit2, Trash2, Paperclip, X, Wand2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { toggleFavorite, deleteEntry } from '@/lib/db';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getTotpWithRemaining } from '@/lib/totp';
import type { Entry } from '@/types';
import { setFillTarget } from '@/lib/autofill';

function getFaviconUrl(website: string): string | null {
  if (!website) return null;
  try {
    let url = website;
    if (!url.startsWith('http')) url = `https://${url}`;
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return null;
  }
}

export function EntryDetail() {
  const {
    entries, selectedEntryId, isDetailOpen, setDetailOpen,
    setEditingEntry, setIsEntryModalOpen, setConfirmDialog, refreshAll,
  } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = useAppStore((s) => s.settings.language === 'en');

  const entry: Entry | undefined = entries.find((e) => e.id === selectedEntryId);

  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [totp, setTotp] = useState<{ code: string; remaining: number } | null>(null);

  // 打开时重置显示状态
  useEffect(() => {
    if (isDetailOpen) {
      setShowPassword(false);
      setCopied(null);
    }
  }, [isDetailOpen, selectedEntryId]);

  // TOTP 刷新：每秒按真实时间计算剩余秒数，整 30 秒边界自动换新码
  useEffect(() => {
    if (!isDetailOpen || !entry?.totp_secret) return;
    let cancelled = false;
    let lastPeriod = -1;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const period = Math.floor(now / 30);
      const remaining = 30 - (now % 30);
      if (period !== lastPeriod) {
        lastPeriod = period;
        getTotpWithRemaining(entry.totp_secret!).then((v) => { if (!cancelled) setTotp(v); }).catch(() => {});
      } else if (!cancelled) {
        setTotp((p) => (p ? { ...p, remaining } : p));
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isDetailOpen, entry?.totp_secret]);

  if (!isDetailOpen || !entry) return null;

  const faviconUrl = getFaviconUrl(entry.website);
  const hasCustomIcon = entry.icon && entry.icon !== 'Lock' && entry.icon !== '';
  const customIconUrl = hasCustomIcon
    ? (entry.icon.startsWith('http') ? entry.icon : convertFileSrc(entry.icon))
    : null;

  const handleCopy = async (text: string, field: string) => {
    await writeText(text);
    setCopied(field);
    addToast(
      field === 'password' ? (isEn ? 'Password copied' : '密码已复制')
        : field === 'totp' ? (isEn ? 'Code copied' : '验证码已复制')
          : (isEn ? 'Username copied' : '账号已复制'), 'success');
    if (field === 'username' || field === 'password') {
      setFillTarget({ username: entry.username || '', password: entry.password || '' });
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const handleToggleFavorite = async () => {
    await toggleFavorite(entry.id);
    await refreshAll();
    addToast(entry.is_favorite ? (isEn ? 'Unfavorited' : '已取消收藏') : (isEn ? 'Favorited' : '已添加到收藏夹'), 'success');
  };

  const handleDelete = () => {
    setConfirmDialog({
      open: true,
      title: isEn ? 'Delete account' : '删除账号',
      message: `确定要删除 "${entry.title}" 吗？此操作不可恢复，关联的附件和密码历史也将被删除。`,
      onConfirm: async () => {
        await deleteEntry(entry.id);
        await refreshAll();
        addToast(isEn ? 'Account deleted' : '账号已删除', 'success');
        setDetailOpen(false);
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  const handleEdit = () => {
    setFillTarget({ username: entry.username || '', password: entry.password || '' });
    setEditingEntry(entry);
    setIsEntryModalOpen(true);
    setDetailOpen(false);
  };

  const handleAutofill = () => {
    setFillTarget({ username: entry.username || '', password: entry.password || '' });
    setDetailOpen(false);
    addToast(isEn ? 'Fill target set — press the hotkey in your browser' : '已设为待填：去浏览器按热键即可填充', 'success');
  };

  const tagNames = entry.tag_names ? entry.tag_names.split(',') : [];
  const tagColors = entry.tag_colors ? entry.tag_colors.split(',') : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,8,16,0.66)', backdropFilter: 'blur(6px)' }}
      onClick={() => setDetailOpen(false)}
    >
      <div
        className="rune-panel relative w-full max-w-[560px] max-h-[88vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭 */}
        <button
          onClick={() => setDetailOpen(false)}
          className="absolute top-4 right-4 text-[var(--moon-dim)] hover:text-[var(--moon)] p-1.5 rounded-lg hover:bg-[rgba(210,210,220,0.08)] transition-all"
        >
          <X size={18} />
        </button>

        {/* 头部 */}
        <div className="flex items-center gap-3.5 pr-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ background: hasCustomIcon ? 'transparent' : 'var(--mint-dim)', boxShadow: '0 0 16px rgba(210,210,220,0.18)' }}>
            {customIconUrl ? (
              <img src={customIconUrl} alt="" className="w-full h-full object-cover" />
            ) : faviconUrl ? (
              <img src={faviconUrl} alt="" className="w-7 h-7 object-contain" onError={() => {}} />
            ) : (
              <Lock size={22} style={{ color: 'var(--mint)' }} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-[var(--moon)] text-lg leading-tight truncate">{entry.title}</h2>
            {entry.website && (
              <a href={entry.website.startsWith('http') ? entry.website : `https://${entry.website}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-[var(--moon-dim)] hover:text-[var(--mint)] flex items-center gap-1 truncate transition-colors mt-1 font-medium">
                {entry.website}
                <ExternalLink size={10} />
              </a>
            )}
          </div>
          <button onClick={handleToggleFavorite}
            className={`transition-all p-1.5 rounded-lg ${entry.is_favorite ? 'text-[var(--mint)]' : 'text-[var(--moon-dim)] hover:text-[var(--moon)]'}`}>
            <Star size={20} fill={entry.is_favorite ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* 主字段 */}
        <div className="mt-5 space-y-3">
          <FieldRow
            label={isEn ? 'Username' : '账号'} value={entry.username}
            revealed showCopy copied={copied === 'username'}
            onCopy={() => handleCopy(entry.username, 'username')}
          />
          <FieldRow
            label={isEn ? 'Password' : '密码'} value={entry.password}
            revealed={showPassword}
            onToggleReveal={() => setShowPassword((v) => !v)}
            showCopy copied={copied === 'password'}
            onCopy={() => handleCopy(entry.password || '', 'password')}
          />
        </div>

        {/* TOTP */}
        {entry.totp_secret && totp && (
          <div className="mt-3 flex items-center gap-2 group">
            <span className="text-[11px] text-[var(--moon-dim)] w-12 font-semibold uppercase tracking-wider">2FA</span>
            <code className="flex-1 text-base font-mono tracking-[0.3em]" style={{ color: 'var(--mint)' }}>{totp.code}</code>
            <div className="relative w-10 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(192,200,216,0.15)' }}>
              <div className="absolute left-0 top-0 bottom-0 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${(totp.remaining / 30) * 100}%`, background: totp.remaining <= 5 ? 'var(--danger,#D47070)' : 'var(--mint)' }} />
            </div>
            <button onClick={() => handleCopy(totp.code, 'totp')} className="text-[var(--moon-dim)] hover:text-[var(--mint)] p-1" title={isEn ? 'Copy code' : '复制验证码'}>
              <Copy size={14} />
            </button>
          </div>
        )}

        {/* 自定义字段（全部） */}
        {entry.customFields && entry.customFields.length > 0 && (
          <div className="mt-4 space-y-2.5">
            <div className="text-[11px] text-[var(--moon-dim)] font-semibold uppercase tracking-wider">{isEn ? 'Custom Fields' : '自定义字段'}</div>
            {entry.customFields.map((f, i) => (
              <FieldRow key={i} label={f.key} value={f.hidden ? (showPassword ? f.value : '•'.repeat(Math.min((f.value?.length || 8), 24))) : f.value}
                revealed showCopy copied={copied === `cf${i}`} onCopy={() => handleCopy(f.value || '', `cf${i}`)} />
            ))}
          </div>
        )}

        {/* 备注 */}
        {entry.notes && (
          <div className="mt-4">
            <div className="text-[11px] text-[var(--moon-dim)] font-semibold uppercase tracking-wider mb-1.5">{isEn ? 'Notes' : '备注'}</div>
            <div className="text-[13px] text-[var(--moon)] whitespace-pre-wrap leading-relaxed bg-[rgba(18,18,30,0.5)] rounded-xl p-3 border border-[rgba(192,200,216,0.08)]">
              {entry.notes}
            </div>
          </div>
        )}

        {/* 标签 */}
        {tagNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {tagNames.map((name: string, i: number) => (
              <span key={i} className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                style={{ backgroundColor: `${tagColors[i]}18`, color: tagColors[i] || 'var(--moon-dim)', border: `1px solid ${tagColors[i] ? `${tagColors[i]}25` : 'rgba(192,200,216,0.1)'}` }}>
                {name}
              </span>
            ))}
          </div>
        )}

        {/* 附件 */}
        {Number(entry.attach_count) > 0 && (
          <div className="flex items-center gap-2 mt-4 text-[12px] text-[var(--moon-dim)]">
            <Paperclip size={14} />
            {isEn ? `${entry.attach_count} attachment(s)` : `${entry.attach_count} 个附件`}
          </div>
        )}

        {/* 底部操作 */}
        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-[rgba(192,200,216,0.08)]">
          <button onClick={handleAutofill}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-[var(--mint)] text-[#0d0d18] hover:brightness-110 transition-all">
            <Wand2 size={15} /> {isEn ? 'Auto-fill' : '自动填充'}
          </button>
          <button onClick={handleEdit}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-[rgba(210,210,220,0.1)] text-[var(--moon)] hover:bg-[rgba(210,210,220,0.18)] transition-all">
            <Edit2 size={15} /> {isEn ? 'Edit' : '编辑'}
          </button>
          <button onClick={handleDelete}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl text-[var(--danger)] hover:bg-[rgba(212,112,112,0.12)] transition-all ml-auto">
            <Trash2 size={15} /> {isEn ? 'Delete' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 详情页字段行：标签 + 值 + 显示/复制
function FieldRow({ label, value, revealed, onToggleReveal, showCopy, copied, onCopy }: {
  label: string; value: string; revealed?: boolean; onToggleReveal?: () => void;
  showCopy?: boolean; copied?: boolean; onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-[11px] text-[var(--moon-dim)] w-12 font-semibold uppercase tracking-wider flex-shrink-0">{label}</span>
      <code className="flex-1 text-[14px] text-[var(--moon)] truncate font-mono font-semibold break-all">{revealed ? value : '•'.repeat(Math.min((value?.length || 8), 24))}</code>
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
        {onToggleReveal && (
          <button onClick={onToggleReveal} className="text-[var(--moon-faint)] hover:text-[var(--moon)] p-1">
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {showCopy && onCopy && (
          <button onClick={onCopy} className="text-[var(--moon-dim)] hover:text-[var(--mint)] p-1" title="复制">
            <Copy size={14} />
          </button>
        )}
        {copied && <span className="text-[10px] text-[var(--mint)]">{copied}</span>}
      </div>
    </div>
  );
}
