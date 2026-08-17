import { useState } from 'react';
import { X, RefreshCw, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { generatePassword, getPasswordStrength } from '@/lib/passwordUtils';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { translate, LangKey } from '@/lib/i18n';

const strengthColors = ['#D47070', '#D4B070', '#9B8DB5', '#7DB8D3', '#7DD3C0'];
const strengthLabels = ['极弱', '弱', '一般', '强', '极强'];
const strengthLabelsEn = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

export function PasswordGenerator() {
  const { settings, setIsPasswordGeneratorOpen } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = settings.language === 'en';
  const t = (k: LangKey) => translate(settings.language, k);

  const [len, setLen] = useState(16);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [exclude, setExclude] = useState(true);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const strength = password ? getPasswordStrength(password) : null;

  const generate = () => {
    const pwd = generatePassword({ length: len, upper, lower, numbers, symbols, excludeAmbiguous: exclude });
    if (!pwd) {
      addToast(isEn ? 'Select at least one character type' : '请至少勾选一种字符类型', 'warning');
      return;
    }
    setPassword(pwd);
    setCopied(false);
  };

  const copy = async () => {
    if (!password) return;
    await writeText(password);
    setCopied(true);
    addToast(isEn ? 'Password copied' : '密码已复制', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const options = [
    { label: isEn ? 'Upper A-Z' : '大写 A-Z', on: upper, set: setUpper },
    { label: isEn ? 'Lower a-z' : '小写 a-z', on: lower, set: setLower },
    { label: isEn ? 'Digits 0-9' : '数字 0-9', on: numbers, set: setNumbers },
    { label: isEn ? 'Symbols !@#' : '符号 !@#', on: symbols, set: setSymbols },
    { label: isEn ? 'Exclude confusing' : '排除易混淆', on: exclude, set: setExclude },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsPasswordGeneratorOpen(false)} />

      <div
        className="relative z-10 w-full max-w-md p-6"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: '18px',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          boxShadow: '0 0 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(210,210,220,0.05)',
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[var(--moon)]">{t('passwordGenerator')}</h2>
          <button onClick={() => setIsPasswordGeneratorOpen(false)}
            className="p-1.5 rounded-lg text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.08)] transition-all">
            <X size={20} />
          </button>
        </div>

        {/* 生成的密码 */}
        <div className="flex items-center gap-2 mb-5">
          <code className="flex-1 rune-input px-3 py-3 text-sm font-mono text-[var(--mint)] break-all select-all">
            {password || (isEn ? 'Click generate...' : '点击生成...')}
          </code>
          <button onClick={copy} disabled={!password}
            className="rune-btn p-3 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
            title={isEn ? 'Copy' : '复制'}>
            {copied ? <Check size={16} style={{ color: 'var(--mint)' }} /> : <Copy size={16} />}
          </button>
        </div>

        {/* 强度条 */}
        {strength && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[rgba(192,200,216,0.1)]">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(strength.score + 1) * 20}%`, background: strengthColors[strength.score] }} />
            </div>
            <span className="text-xs" style={{ color: strengthColors[strength.score] }}>
              {isEn ? strengthLabelsEn[strength.score] : strengthLabels[strength.score]}
            </span>
          </div>
        )}

        {/* 长度 */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs text-[var(--moon-dim)] whitespace-nowrap">{t('length')}</span>
          <input type="range" min={6} max={32} value={len} onChange={(e) => setLen(Number(e.target.value))}
            className="flex-1 accent-[var(--mint)]" />
          <span className="text-sm font-mono text-[var(--mint)] w-8 text-right">{len}</span>
        </div>

        {/* 选项 */}
        <div className="flex flex-wrap gap-2 mb-5">
          {options.map((opt) => (
            <button key={opt.label} onClick={() => opt.set(!opt.on)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                opt.on
                  ? 'border-transparent text-white'
                  : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-faint)] hover:border-[rgba(192,200,216,0.3)]'
              }`}
              style={opt.on ? { backgroundColor: 'var(--mint)', color: '#12121E' } : {}}>
              {opt.label}
            </button>
          ))}
        </div>

        <button onClick={generate} className="rune-btn rune-btn-primary w-full py-3 text-sm flex items-center justify-center gap-2">
          <RefreshCw size={15} /> {t('generate')}
        </button>
      </div>
    </div>
  );
}