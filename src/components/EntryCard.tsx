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
import { setFillTarget } from '@/lib/autofill';
import { openExternalWebsite } from '@/lib/openExternal';

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
  const { setEditingEntry, setIsEntryModalOpen, setDetailOpen, setSelectedEntryId, refreshAll, setConfirmDialog, settings } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = settings?.language === 'en';
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [totp, setTotp] = useState<{ code: string; remaining: number } | null>(null);

  // TOTP 刷新：每秒按真实时间计算剩余秒数，整 30 秒边界自动换新码（无需手动刷新）
  useEffect(() => {
    if (!entry.totp_secret) return;
    let cancelled = false;
    let lastPeriod = -1;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const period = Math.floor(now / 30);
      const remaining = 30 - (now % 30);
      if (period !== lastPeriod) {
        lastPeriod = period;
        getTotpWithRemaining(entry.totp_secret!).then((v) => {
          if (!cancelled) setTotp(v);
        }).catch(() => {});
      } else if (!cancelled) {
        setTotp((prev) => (prev ? { ...prev, remaining } : prev));
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(t); };
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
    // 复制账号或密码时，把该条目设为半自动填充的待填目标
    if (field === 'username' || field === 'password') {
      setFillTarget({ username: entry.username || '', password: entry.password || '' });
    }
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
    setFillTarget({ username: entry.username || '', password: entry.password || '' });
    setEditingEntry(entry);
    setIsEntryModalOpen(true);
  };

  // 点开卡片 → 打开详情页（大 UI）
  const handleOpen = () => {
    setSelectedEntryId(entry.id);
    setDetailOpen(true);
  };

  const handleOpenWebsite = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await openExternalWebsite(entry.website);
    } catch {
      addToast(isEn ? 'Unable to open website' : '无法打开网站链接', 'error');
    }
  };

  const tagNames = entry.tag_names ? entry.tag_names.split(',') : [];
  const tagColors = entry.tag_colors ? entry.tag_colors.split(',') : [];
  const customFieldCount = entry.customFields?.length || 0;

  return (
    <div className="h-full" style={{ animationDelay: `${index * 0.05}s` }}>
      <GlareHover glareColor="rgba(210,210,220, 0.08)" glareSize={250}>
        <ClickSpark sparkColor="#7DD3C0" sparkCount={8}>
          <div
            className="rune-panel rune-card relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-3"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleOpen}
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
            <div className="flex items-start gap-2 pr-8">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all duration-300"
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
                  <button
                    type="button"
                    className="mt-0.5 flex max-w-full items-center gap-1 text-[11px] font-medium text-[var(--moon-dim)] transition-colors hover:text-[var(--mint)]"
                    onClick={handleOpenWebsite}
                    title={isEn ? 'Open website in browser' : '在浏览器中打开网站'}
                  >
                    <span className="truncate">{entry.website}</span>
                    <ExternalLink size={9} className="shrink-0" />
                  </button>
                )}
              </div>
            </div>

            {/* 账号密码 */}
            <div className="mt-2 space-y-0.5">
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

            {/* 2FA 独立显示，验证码可点击复制 */}
            {entry.totp_secret && totp && (
              <div className="mt-1 flex h-5 shrink-0 items-center gap-2">
                <span className="w-9 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[var(--moon-dim)]">2FA</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleCopy(totp.code, 'totp'); }}
                  className="rounded px-1 py-0.5 font-mono text-[11px] tracking-[0.16em] text-[var(--mint)] transition-colors hover:bg-[rgba(210,210,220,0.08)]"
                  title={isEn ? 'Copy code' : '复制验证码'}
                >
                  {totp.code}
                </button>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <div className="relative h-1 w-12 overflow-hidden rounded-full" style={{ background: 'rgba(192,200,216,0.15)' }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-linear"
                      style={{
                        width: `${(totp.remaining / 30) * 100}%`,
                        background: totp.remaining <= 5 ? 'var(--danger, #D47070)' : 'var(--mint)',
                      }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono text-[10px] tabular-nums text-[var(--moon-dim)]">
                    {totp.remaining}s
                  </span>
                </div>
              </div>
            )}

            {/* 紧凑摘要：额外信息保持单行，完整内容在详情页查看 */}
            <div className="relative mt-auto flex h-7 shrink-0 items-center border-t border-[rgba(192,200,216,0.06)] pt-1">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {customFieldCount > 0 && (
                  <span
                    className="shrink-0 rounded-full border border-[rgba(192,200,216,0.1)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--moon-dim)]"
                    title={`${customFieldCount} 个自定义字段，点击卡片查看`}
                  >
                    {customFieldCount} 个字段
                  </span>
                )}

                {tagNames.length > 0 && (
                  <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                    {tagNames.slice(0, 3).map((name: string, i: number) => (
                      <span
                        key={`${name}-${i}`}
                        className="max-w-[68px] shrink-0 truncate rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                        style={{
                          backgroundColor: `${tagColors[i]}18`,
                          color: tagColors[i] || 'var(--moon-dim)',
                          border: `1px solid ${tagColors[i] ? `${tagColors[i]}25` : 'rgba(192,200,216,0.1)'}`,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                    {tagNames.length > 3 && (
                      <span className="shrink-0 text-[9px] text-[var(--moon-faint)]">+{tagNames.length - 3}</span>
                    )}
                  </div>
                )}

                {Number(entry.attach_count) > 0 && (
                  <Paperclip size={12} className="ml-auto shrink-0 text-[var(--moon-faint)]" />
                )}
              </div>

              <div
                className={`absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-lg pl-2 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                style={{ background: 'linear-gradient(90deg, transparent, var(--glass-bg) 28%)' }}
              >
                <button type="button" onClick={handleEdit} className="rounded-lg p-1.5 text-[var(--moon-dim)] transition-all hover:bg-[rgba(210,210,220,0.08)] hover:text-[var(--mint)]" title="编辑">
                  <Edit2 size={13} />
                </button>
                <button type="button" onClick={handleDelete} className="rounded-lg p-1.5 text-[var(--moon-dim)] transition-all hover:bg-[rgba(212,112,112,0.08)] hover:text-[var(--danger)]" title="删除">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 收藏星 */}
            <button type="button" onClick={handleToggleFavorite}
              className={`absolute right-3 top-3 rounded-lg p-1.5 transition-all ${entry.is_favorite ? 'text-[var(--mint)]' : 'text-[var(--moon-dim)] hover:text-[var(--moon)]'}`}>
              <Star size={17} fill={entry.is_favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
        </ClickSpark>
      </GlareHover>
    </div>
  );
}
