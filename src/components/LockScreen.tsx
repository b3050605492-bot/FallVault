import { useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { setupMasterPassword, unlockVault, hasMasterPassword, migratePlaintextToEncrypted } from '@/lib/crypto';

interface LockScreenProps {
  onUnlocked: () => void;
}

/**
 * 锁定/解锁屏：
 *  - 第一次启动（无主密码）→ 设置主密码
 *  - 之后（有主密码）→ 输入主密码解锁
 */
export function LockScreen({ onUnlocked }: LockScreenProps) {
  const { addToast } = useToastStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isSetup, setIsSetup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  // 首次挂载检测状态
  useState(() => {
    hasMasterPassword().then((has) => {
      setIsSetup(!has);
    }).catch(() => setIsSetup(true));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // 设置模式：两次一致校验
    if (isSetup) {
      if (password.length < 4) {
        addToast('主密码至少 4 位，请设置强密码', 'warning');
        return;
      }
      if (password !== confirm) {
        addToast('两次输入的主密码不一致', 'warning');
        return;
      }
      setLoading(true);
      try {
        await setupMasterPassword(password);
        // 迁移已有的明文数据到加密存储
        const n = await migratePlaintextToEncrypted();
        addToast(
          n > 0
            ? `主密码已设置，已加密 ${n} 条数据`
            : '主密码已设置，所有数据将加密存储',
          'success'
        );
        onUnlocked();
      } catch (err) {
        console.error('setup master password failed', err);
        addToast('设置主密码失败，请重试', 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // 解锁模式
    setLoading(true);
    try {
      const ok = await unlockVault(password);
      if (ok) {
        setPassword('');
        onUnlocked();
      } else {
        addToast('主密码错误', 'error');
        setPassword('');
      }
    } catch (err) {
      console.error('unlock failed', err);
      addToast('解锁失败，请重试', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
      {/* 毛玻璃卡片 */}
      <div
        className="glass-card w-full max-w-sm rounded-3xl p-8"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--glass-border, rgba(255,245,245,0.4))',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4"
            style={{ background: 'rgba(125,211,192,0.15)', color: 'var(--mint)' }}
          >
            🔐
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--moon)' }}>
            FallVault
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--moon-faint)' }}>
            {isSetup ? '设置主密码，启用加密存储' : '输入主密码解锁'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs mb-1.5 block" style={{ color: 'var(--moon-dim)' }}>
              {isSetup ? '主密码' : '主密码'}
            </label>
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSetup ? '设置主密码（建议至少 8 位）' : '请输入主密码'}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
            />
          </div>

          {isSetup && (
            <div>
              <label className="text-xs mb-1.5 block" style={{ color: 'var(--moon-dim)' }}>
                确认主密码
              </label>
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入主密码"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
              />
            </div>
          )}

          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--moon-dim)' }}>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showPwd}
                onChange={(e) => setShowPwd(e.target.checked)}
                className="accent-[var(--mint)]"
              />
              显示密码
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40"
            style={{ background: 'rgba(125,211,192,0.2)', color: 'var(--mint)' }}
          >
            {loading ? (isSetup ? '创建中…' : '解锁中…') : (isSetup ? '创建保险库' : '解锁')}
          </button>
        </form>

        {isSetup && (
          <p className="text-[11px] mt-6 leading-relaxed" style={{ color: 'var(--moon-faint)' }}>
            ⚠️ 主密码是解锁数据的唯一钥匙，<b style={{ color: 'var(--moon-dim)' }}>无法找回</b>。
            忘记主密码将导致数据永久无法读取。请务必妥善保管。
          </p>
        )}
      </div>
    </div>
  );
}
