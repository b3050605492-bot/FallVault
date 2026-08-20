import { useState, useMemo } from 'react';
import { X, ShieldAlert, ShieldCheck, Copy, AlertTriangle, Eye } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { runSecurityAudit } from '@/lib/securityAudit';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { getPasswordStrength } from '@/lib/passwordUtils';

export function SecurityAuditModal() {
  const { entries, setIsSecurityAuditOpen, setEditingEntry, setIsEntryModalOpen, refreshAll } = useAppStore();
  const { addToast } = useToastStore();
  const [showPwd, setShowPwd] = useState<number | null>(null);

  const audit = useMemo(() => runSecurityAudit(entries), [entries]);
  const isEn = useAppStore((s) => s.settings.language === 'en');

  const handleCopy = async (text: string) => {
    await writeText(text);
    addToast(isEn ? 'Password copied' : '密码已复制', 'success');
  };

  const openEntry = (id: number) => {
    const e = entries.find((x) => x.id === id);
    if (e) {
      setEditingEntry(e);
      setIsEntryModalOpen(true);
      setIsSecurityAuditOpen(false);
    }
  };

  const strengthLabel = (score: number) => {
    const map = isEn
      ? ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
      : ['极弱', '弱', '一般', '强', '极强'];
    return map[score] || map[0];
  };
  const strengthColor = ['#D47070', '#D47070', '#D4B070', '#7DB8D3', '#7DD3C0'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsSecurityAuditOpen(false)} />

      <div className="relative z-10 w-full max-w-2xl max-h-[88vh] overflow-y-auto p-6"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: '18px',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          boxShadow: '0 0 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(210,210,220,0.05)',
        }}>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${audit.issuesCount > 0 ? 'bg-[rgba(212,112,112,0.15)]' : 'bg-[rgba(125,211,192,0.15)]'}`}>
              {audit.issuesCount > 0
                ? <ShieldAlert size={20} style={{ color: '#D47070' }} />
                : <ShieldCheck size={20} style={{ color: 'var(--mint)' }} />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--moon)]">{isEn ? 'Security Audit' : '安全审计'}</h2>
              <p className="text-xs text-[var(--moon-faint)] mt-0.5">
                {isEn
                  ? `Checked ${audit.total} accounts · ${audit.issuesCount} need attention`
                  : `已检查 ${audit.total} 个账号 · ${audit.issuesCount} 个需要关注`}
              </p>
            </div>
          </div>
          <button onClick={() => setIsSecurityAuditOpen(false)}
            className="text-[var(--moon-faint)] hover:text-[var(--moon)] transition-colors p-1 rounded-lg hover:bg-[rgba(192,200,216,0.08)]">
            <X size={22} />
          </button>
        </div>

        {audit.issuesCount === 0 ? (
          <div className="py-10 text-center">
            <ShieldCheck size={48} style={{ color: 'var(--mint)' }} className="mx-auto mb-3" />
            <p className="text-[var(--moon-dim)]">{isEn ? 'All good! No weak, reused or breached passwords found.' : '全部安全！未发现弱密码、重复密码或泄露密码。'}</p>
          </div>
        ) : (
          <div className="space-y-5">

            <p className="text-xs text-[var(--moon-faint)]">
              {isEn
                ? `${audit.issuesCount} accounts need attention · each account is listed once`
                : `${audit.issuesCount} 个账号需要关注 · 每个账号只列出一次`}
            </p>

            {/* 全部问题账号（去重，每个账号一行，标注命中类别） */}
            <Section icon={<AlertTriangle size={15} />} color="#D47070" title={isEn ? `Problem accounts (${audit.deduped.length})` : `问题账号 (${audit.deduped.length})`} desc={isEn ? 'Click a row to view / edit' : '点击某行可查看或编辑'}>
              {audit.deduped.map(({ entry, reasons }) => (
                <Row key={entry.id} entry={entry} reasons={reasons}
                  showPwd={showPwd === entry.id} onToggle={() => setShowPwd(showPwd === entry.id ? null : entry.id)}
                  onCopy={() => handleCopy(entry.password)} onOpen={() => openEntry(entry.id)} isEn={isEn} />
              ))}
            </Section>

            <p className="text-[11px] text-[var(--moon-faint)] pt-1">
              {isEn
                ? 'Offline check only — no data leaves your device. Breach list covers the most common leaked passwords.'
                : '仅本地检测，无任何数据上传。泄露库覆盖最常见的高频泄露密码。'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon, color, title, desc, children }: { icon: React.ReactNode; color: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(18,18,30,0.5)', border: `1px solid ${color}30` }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-sm font-semibold" style={{ color }}>{title}</span>
      </div>
      <p className="text-[11px] text-[var(--moon-faint)] mb-2.5 ml-6">{desc}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ entry, reasons, showPwd, onToggle, onCopy, onOpen, isEn }: {
  entry: any; reasons: { breached: boolean; weak: boolean; reused: boolean; score: number }; showPwd: boolean;
  onToggle: () => void; onCopy: () => void; onOpen: () => void; isEn: boolean;
}) {
  const cats: { label: string; color: string }[] = [];
  if (reasons.breached) cats.push({ label: isEn ? 'Breached' : '泄露', color: '#D47070' });
  if (reasons.weak) cats.push({ label: isEn ? 'Weak' : '弱', color: '#D4B070' });
  if (reasons.reused) cats.push({ label: isEn ? 'Reused' : '重复', color: '#9B8DB5' });
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[rgba(192,200,216,0.04)] cursor-pointer hover:bg-[rgba(192,200,216,0.09)]" onClick={onOpen}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-[var(--moon)] font-semibold truncate">{entry.title}</span>
          {cats.map((c, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${c.color}22`, color: c.color, border: `1px solid ${c.color}40` }}>{c.label}</span>
          ))}
        </div>
        <div className="text-[11px] text-[var(--moon-faint)] truncate">
          {entry.username || '—'} · {isEn ? 'Password' : '密码'}: <span className="font-mono">{entry.password}</span>
        </div>
        {showPwd && (
          <code className="block text-xs font-mono text-[var(--moon-dim)] mt-1 truncate">{entry.password}</code>
        )}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="p-1.5 rounded text-[var(--moon-faint)] hover:text-[var(--moon)]" title={isEn ? 'Show/Hide' : '显示/隐藏'}>
        <Eye size={13} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onCopy(); }} className="p-1.5 rounded text-[var(--moon-faint)] hover:text-[var(--mint)]" title={isEn ? 'Copy' : '复制'}>
        <Copy size={13} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="px-2 py-1 rounded text-xs text-[var(--moon-faint)] hover:text-[var(--mint)] whitespace-nowrap" title={isEn ? 'Edit' : '编辑'}>
        {isEn ? 'Edit' : '编辑'}
      </button>
    </div>
  );
}
