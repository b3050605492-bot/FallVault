import { useState, useEffect } from 'react';
import { X, Download, Upload, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { getEntries, createEntry } from '@/lib/db';
import { buildOtpAuthUri, parseOtpAuth, parseGoogleMigration } from '@/lib/totp';
import { translate } from '@/lib/i18n';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

export function TotpMigrationModal() {
  const { setIsTotpMigrationOpen, settings, refreshAll } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = settings.language === 'en';
  const t = (k: any) => translate(settings.language, k);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<{ ok: number; skip: number } | null>(null);

  const close = () => {
    setIsTotpMigrationOpen(false);
    setImportText('');
    setImportResult(null);
  };

  // 导出：收集所有带 TOTP 的账号，生成 otpauth URI 列表
  const exportUris = async (): Promise<string> => {
    const all = await getEntries();
    const lines: string[] = [];
    for (const e of all) {
      if (e.totp_secret && e.totp_secret.trim()) {
        const secret = e.totp_secret.trim();
        lines.push(buildOtpAuthUri(secret, e.title || 'FallVault', e.title || undefined));
      }
    }
    return lines.join('\n');
  };

  const handleCopy = async () => {
    const text = await exportUris();
    if (!text) { addToast(isEn ? 'No TOTP entries found' : '没有带 TOTP 的账号', 'error'); return; }
    try {
      await navigator.clipboard.writeText(text);
      addToast(isEn ? 'TOTP URIs copied' : 'TOTP 密钥已复制', 'success');
    } catch {
      addToast(isEn ? 'Copy failed' : '复制失败', 'error');
    }
  };

  const handleSaveFile = async () => {
    const text = await exportUris();
    if (!text) { addToast(isEn ? 'No TOTP entries found' : '没有带 TOTP 的账号', 'error'); return; }
    const path = await save({ defaultPath: 'fallvault-totp.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (!path) return;
    const encoder = new TextEncoder();
    await writeFile(path, encoder.encode(text));
    addToast(isEn ? 'TOTP exported' : 'TOTP 已导出', 'success');
  };

  // 导入：支持 Google 批量迁移链接(otpauth-migration://)、单行 otpauth://、原始 secret，每行一个
  const handleImport = async () => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const pending: { title: string; secret: string }[] = [];
    let skip = 0;
    for (const line of lines) {
      try {
        if (line.startsWith('otpauth-migration://')) {
          const migrated = parseGoogleMigration(line);
          if (migrated.length === 0) { skip++; continue; }
          for (const m of migrated) {
            const title = m.name || m.issuer || '导入的 TOTP';
            pending.push({ title, secret: m.secret });
          }
          continue;
        }
        const secret = line.startsWith('otpauth://') ? parseOtpAuth(line) : line;
        if (!secret) { skip++; continue; }
        let title = '导入的 TOTP';
        if (line.startsWith('otpauth://')) {
          try {
            const u = new URL(line);
            const p = decodeURIComponent(u.pathname.replace(/^\/totp\//, ''));
            if (p) title = p;
          } catch { /* ignore */ }
        }
        pending.push({ title, secret: secret.toUpperCase() });
      } catch {
        skip++;
      }
    }
    let ok = 0;
    for (const item of pending) {
      try {
        await createEntry({ title: item.title, totp_secret: item.secret, website: '', username: '', password: '', notes: '' }, []);
        ok++;
      } catch {
        skip++;
      }
    }
    setImportResult({ ok, skip });
    if (ok > 0) await refreshAll();
    addToast(isEn ? `Imported ${ok} TOTP` : `已导入 ${ok} 个 TOTP`, 'success');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative rune-panel w-full max-w-xl max-h-[85vh] overflow-y-auto p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-[var(--moon)]">{isEn ? 'TOTP Migration' : 'TOTP 迁移'}</h2>
          <button onClick={close} className="rune-btn p-2 rounded-lg text-[var(--moon-dim)] hover:text-[var(--moon)]">
            <X size={18} />
          </button>
        </div>

        {/* 导出 */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[var(--moon)] mb-2">{isEn ? 'Export TOTP (to another authenticator)' : '导出 TOTP（迁移到其他验证器）'}</h3>
          <p className="text-xs text-[var(--moon-faint)] mb-3">
            {isEn
              ? 'Exports all entries with TOTP as otpauth:// URIs. No data leaves your device.'
              : '把带 TOTP 的账号导出为 otpauth:// URI 列表，可导入 Google/Authy 等验证器。不上传任何数据。'}
          </p>
          <div className="flex gap-2">
            <button onClick={handleCopy} className="rune-btn px-4 py-2 rounded-xl text-sm flex items-center gap-2 text-[var(--moon)]">
              <Copy size={15} /> {isEn ? 'Copy URIs' : '复制 URI'}
            </button>
            <button onClick={handleSaveFile} className="rune-btn px-4 py-2 rounded-xl text-sm flex items-center gap-2 text-[var(--moon)]">
              <Download size={15} /> {isEn ? 'Save .txt' : '保存为文件'}
            </button>
          </div>
        </div>

        <div className="h-px bg-[var(--glass-border)] mb-6" />

        {/* 导入 */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--moon)] mb-2">{isEn ? 'Import TOTP (from another authenticator)' : '导入 TOTP（从其他验证器迁移）'}</h3>
          <p className="text-xs text-[var(--moon-faint)] mb-3">
            {isEn
              ? 'Paste one or more otpauth:// URIs (or raw secrets), each on a new line.'
              : '粘贴一个或多个 otpauth:// URI（或直接粘贴密钥），每行一个，批量导入为新账号。'}
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'otpauth-migration://offline?data=... 或 otpauth://totp/...'}
            className="rune-input w-full px-3 py-2 text-sm font-mono h-32 resize-none"
          />
          <button
            onClick={handleImport}
            disabled={!importText.trim()}
            className="mt-3 rune-btn px-4 py-2 rounded-xl text-sm flex items-center gap-2 text-[var(--moon)] disabled:opacity-40"
          >
            <Upload size={15} /> {isEn ? 'Import' : '导入'}
          </button>
          {importResult && (
            <p className="text-xs text-[var(--moon-faint)] mt-2">
              {isEn ? `Imported ${importResult.ok}, skipped ${importResult.skip}` : `成功 ${importResult.ok} 个，跳过 ${importResult.skip} 个`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
