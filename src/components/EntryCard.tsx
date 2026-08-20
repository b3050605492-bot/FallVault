import { useState, useEffect } from 'react';
import { Lock, Star, ExternalLink, Copy, Eye, EyeOff, Edit2, Trash2, Paperclip } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { toggleFavorite, deleteEntry } from '@/lib/db';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { convertFileSrc } from '@tauri-apps/api/core';
import { GlareHover } from '@/components/GlareHover';
import { getTotpWithRemaining } from '@/lib/totp';
import { ClickSpark } from '@/components/ClickSpark';
import type { Entry } from '@/types';

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

// 检测图片加载失败的 Hook
function useImgError() {
  const [error, setError] = useState(false);
  const onError = () => setError(true);
  return { error, onError };
}

export function EntryCard({ entry, index = 0 }: { entry: Entry; index?: number }) {
  const { setEditingEntry, setIsEntryModalOpen, refreshAll, setConfirmDialog, settings } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = settings?.language === 'en';
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [totp, setTotp] = useState<{ code: string; remaining: number } | null>(null);

  // TOTP 定时刷新（30 秒一次 + 每 1 秒更新剩余倒计时）
  useEffect(() => {
    if (!entry.totp_secret) return;
    let cancelled = false;
    const refresh = () => {
      getTotpWithRemaining(entry.totp_secret!).then((v) => {
        if (!cancelled) setTotp(v);
      }).catch(() => {});
    };
    refresh();
    const t1 = setInterval(refresh, 30000);
    const t2 = setInterval(() => {
      setTotp((prev) => prev ? { ...prev, remaining: Math.max(0, prev.remaining - 1) } : prev);
    }, 1000);
    return () => { cancelled = true; clearInterval(t1); clearInterval(t2); };
  }, [entry.totp_secret]);

  const faviconUrl = getFaviconUrl(entry.website);
  const hasCustomIcon = entry.icon && entry.icon !== 'Lock' && entry.icon !== '';
  const customIconUrl = hasCustomIcon
    ? (entry.icon.startsWith('http') ? entry.icon : convertFileSrc(entry.icon))
    : null;

  const faviconError = useImgError();
  const customError = useImgError();

  const handleCopy = async (text: string, field: string) => {
    await writeText(text);
    setCopiedField(field);
    addToast(
      field === 'password' ? (isEn ? 'Password copied' : '密码已复制')
      : field === 'totp' ? (isEn ? 'Code copied' : '验证码已复制')
      : (isEn ? 'Username copied' : '账号已复制'), 'success'
    );
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleFavorite(entry.id);
    await refreshAll();
    addToast(entry.is_favorite ? '已取消收藏' : '已添加到收藏夹', 'success');
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDialog({
      open: true,
      title: '删除账号',
      message: `确定要删除 "${entry.title}" 吗？此操作不可恢复，关联的附件和密码历史也将被删除。`,
      onConfirm: async () => {
        await deleteEntry(entry.id);
        await refreshAll();
        addToast('账号已删除', 'success');
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEntry(entry);
    setIsEntryModalOpen(true);
  };

  const tagNames = entry.tag_names ? entry.tag_names.split(',') : [];
  const tagColors = entry.tag_colors ? entry.tag_colors.split(',') : [];

  return (
    <div style={{ animationDelay: `${index * 0.05}s` }}>
      <GlareHover glareColor="rgba(210,210,220, 0.08)" glareSize={250}>
        <ClickSpark sparkColor="#7DD3C0" sparkCount={8}>
          <div
            className="rune-panel rune-card p-4 relative overflow-hidden"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* 顶部发光条 */}
            <div className="absolute top-0 left-6 right-6 h-[1.5px] rounded-full transition-all duration-500"
              style={{
                background: entry.is_favorite
                  ? 'linear-gradient(90deg, transparent, var(--mint), transparent)'
                  : isHovered ? 'linear-gradient(90deg, transparent, rgba(210,210,220,0.3), transparent)' : 'transparent',
                opacity: isHovered || entry.is_favorite ? 1 : 0,
              }}
            />

            {/* 头部 */}
            <div className="flex items-start gap-2.5 pr-9">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden transition-all duration-300"
                style={{
                  background: hasCustomIcon ? 'transparent' : 'var(--mint-dim)',
                  boxShadow: isHovered ? '0 0 12px rgba(210,210,220, 0.2)' : 'none',
                }}
              >
                {customIconUrl && !customError.error ? (
                  <img src={customIconUrl} alt="" className="w-full h-full object-cover" onError={customError.onError} />
                ) : faviconUrl && !faviconError.error ? (
                  <img src={faviconUrl} alt="" className="w-5 h-5 object-contain" onError={faviconError.onError} />
                ) : (
                  <Lock size={15} style={{ color: 'var(--mint)' }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-[var(--moon)] truncate text-[14px] leading-tight">{entry.title}</h3>
                {entry.website && (
                  <a href={entry.website.startsWith('http') ? entry.website : `https://${entry.website}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-[var(--moon-dim)] hover:text-[var(--mint)] flex items-center gap-1 truncate transition-colors mt-0.5 font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {entry.website}
                    <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>

            {/* 账号密码 */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2 group">
                <span className="text-[10px] text-[var(--moon-dim)] w-9 font-semibold uppercase tracking-wider">账号</span>
                <code className="flex-1 text-[13px] text-[var(--moon)] truncate font-mono font-semibold">{entry.username}</code>
                <button onClick={(e) => { e.stopPropagation(); handleCopy(entry.username, 'username'); }}
                  className="opacity-0 group-hover:opacity-100 text-[var(--moon-dim)] hover:text-[var(--mint)] transition-all p-1">
                  <Copy size={12} />
                </button>
                {copiedField === 'username' && <span className="text-[10px] text-[var(--mint)]">已复制</span>}
              </div>

              <div className="flex items-center gap-2 group">
                <span className="text-[10px] text-[var(--moon-dim)] w-9 font-semibold uppercase tracking-wider">密码</span>
                <code className="flex-1 text-[13px] text-[var(--moon)] truncate font-mono font-semibold">
                  {showPassword ? entry.password : '•'.repeat(Math.min(entry.password?.length || 8, 16))}
                </code>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); setShowPassword(!showPassword); }} className="text-[var(--moon-faint)] hover:text-[var(--moon)] p-1">
                    {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleCopy(entry.password || '', 'password'); }} className="text-[var(--moon-faint)] hover:text-[var(--mint)] p-1">
                    <Copy size={12} />
                  </button>
                </div>
                {copiedField === 'password' && <span className="text-[10px] text-[var(--mint)]">已复制</span>}
              </div>
            </div>

            {/* TOTP 验证码 */}
            {entry.totp_secret && totp && (
              <div className="flex items-center gap-2 mt-2 group">
                <span className="text-[11px] text-[var(--moon-dim)] w-10 font-semibold uppercase tracking-wider">2FA</span>
                <code className="flex-1 text-sm font-mono tracking-[0.25em]" style={{ color: 'var(--mint)' }}>
                  {totp.code}
                </code>
                {/* 倒计时条 */}
                <div className="relative w-8 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(192,200,216,0.15)' }}>
                  <div
                    className="absolute left-0 top-0 bottom-0 rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${(totp.remaining / 30) * 100}%`,
                      background: totp.remaining <= 5 ? 'var(--danger, #D47070)' : 'var(--mint)',
                    }}
                  />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopy(totp.code, 'totp'); }}
                  className="opacity-0 group-hover:opacity-100 text-[var(--moon-dim)] hover:text-[var(--mint)] transition-all p-1"
                  title={isEn ? 'Copy code' : '复制验证码'}
                >
                  <Copy size={13} />
                </button>
                {copiedField === 'totp' && <span className="text-[10px] text-[var(--mint)]">已复制</span>}
              </div>
            )}

            {/* 自定义字段（固定高度占位，保证有/无字段卡片高度一致） */}
            <div className="mt-2.5 min-h-[34px]">
              {entry.customFields && entry.customFields.length > 0 && (
                <div className="space-y-2">
                  {entry.customFields.slice(0, 2).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <span className="text-[11px] text-[var(--moon-dim)] w-16 truncate font-semibold">{f.key}</span>
                      <code className="flex-1 text-sm text-[var(--moon)] truncate font-mono font-semibold">
                        {f.hidden ? '•'.repeat(Math.min((f.value?.length || 8), 16)) : f.value}
                      </code>
                      <button onClick={(e) => { e.stopPropagation(); handleCopy(f.value || '', 'custom'); }}
                        className="opacity-0 group-hover:opacity-100 text-[var(--moon-dim)] hover:text-[var(--mint)] transition-all p-1" title="复制">
                        <Copy size={13} />
                      </button>
                    </div>
                  ))}
                  {entry.customFields.length > 2 && (
                    <div className="text-[11px] text-[var(--moon-faint)]">+{entry.customFields.length - 2} 个自定义字段</div>
                  )}
                </div>
              )}
            </div>

            {/* 标签 */}
            {tagNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3.5">
                {tagNames.map((name: string, i: number) => (
                  <span key={i} className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                    style={{
                      backgroundColor: `${tagColors[i]}18`,
                      color: tagColors[i] || 'var(--moon-dim)',
                      border: `1px solid ${tagColors[i] ? `${tagColors[i]}25` : 'rgba(192,200,216,0.1)'}`,
                    }}>
                    {name}
                  </span>
                ))}
              </div>
            )}

            {/* 底部操作 */}
            <div className={`flex items-center gap-1 mt-3 pt-2.5 border-t border-[rgba(192,200,216,0.06)] transition-all duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
              <button onClick={handleEdit} className="flex items-center gap-1.5 text-xs text-[var(--moon-dim)] hover:text-[var(--mint)] px-2 py-1 rounded-lg hover:bg-[rgba(210,210,220,0.08)] transition-all font-semibold">
                <Edit2 size={13} /> 编辑
              </button>
              <button onClick={handleDelete} className="flex items-center gap-1.5 text-xs text-[var(--moon-dim)] hover:text-[var(--danger)] ml-auto px-2 py-1 rounded-lg hover:bg-[rgba(212,112,112,0.08)] transition-all font-semibold">
                <Trash2 size={13} /> 删除
              </button>
            </div>

            {/* 收藏星 */}
            <button onClick={handleToggleFavorite}
              className={`absolute top-4 right-4 transition-all p-1.5 rounded-lg ${entry.is_favorite ? 'text-[var(--mint)]' : 'text-[var(--moon-dim)] hover:text-[var(--moon)]'}`}>
              <Star size={17} fill={entry.is_favorite ? 'currentColor' : 'none'} />
            </button>

            {/* 附件 */}
            {Number(entry.attach_count) > 0 && (
              <div className="absolute bottom-4 left-5 text-[var(--moon-faint)]">
                <Paperclip size={13} />
              </div>
            )}
          </div>
        </ClickSpark>
      </GlareHover>
    </div>
  );
}
