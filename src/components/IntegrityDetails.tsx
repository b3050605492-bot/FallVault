import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, FolderOpen, Loader2, RotateCcw, X } from 'lucide-react';
import { useIntegrityStore } from '@/stores/integrityStore';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { encryptedFieldLabel } from '@/lib/entryEncryption';
import { type IntegrityIssue, verifyIntegrity } from '@/lib/crypto';
import { applyEntryRecoveries, type EntryRecoveryPreview } from '@/lib/vaultBackup';
import {
  findEntryRecoveriesInAutoBackups,
  findEntryRecoveriesInFile,
} from '@/lib/backupManager';
import { open } from '@tauri-apps/plugin-dialog';

const RECOVERABLE_FIELDS = ['username', 'password', 'notes', 'totp_secret', 'custom_fields'];

export function IntegrityWarning() {
  const { report, setOpen } = useIntegrityStore();
  const isEn = useAppStore((s) => s.settings.language === 'en');
  if (!report || report.ok) return null;
  return (
    <button onClick={() => setOpen(true)} className="w-full mb-4 p-3 rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200 text-sm flex items-center gap-2 text-left">
      <AlertTriangle size={18} className="shrink-0" />
      <span className="flex-1">{report.dbError
        ? (isEn ? 'Database integrity check failed' : '数据库完整性检查异常')
        : (isEn ? `${report.corruptEntries} accounts have unreadable data` : `${report.corruptEntries} 个账号存在无法读取的数据`)}</span>
      <span className="shrink-0 underline">{isEn ? 'View details' : '查看详情'}</span>
    </button>
  );
}

export function IntegrityDetails() {
  const { report, isOpen, setOpen } = useIntegrityStore();
  const isEn = useAppStore((s) => s.settings.language === 'en');
  const addToast = useToastStore((s) => s.addToast);
  const [recoveryIssues, setRecoveryIssues] = useState<IntegrityIssue[]>([]);
  const [oldPassword, setOldPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [previews, setPreviews] = useState<EntryRecoveryPreview[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  const resetRecovery = () => {
    setRecoveryIssues([]);
    setOldPassword('');
    setShowOldPassword(false);
    setPreviews([]);
    setRecoveryBusy(false);
    setRecoveryError('');
  };

  useEffect(() => {
    if (!isOpen) resetRecovery();
  }, [isOpen]);

  const startRecovery = (issues: IntegrityIssue[]) => {
    setRecoveryIssues(issues);
    setPreviews([]);
    setOldPassword('');
    setShowOldPassword(false);
    setRecoveryError('');
  };

  const searchRecovery = async (chooseFile: boolean) => {
    if (!recoveryIssues.length || !oldPassword || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      let found: EntryRecoveryPreview[];
      if (chooseFile) {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'FallVault Backup', extensions: ['fvault'] }],
        });
        if (!selected || typeof selected !== 'string') return;
        found = await findEntryRecoveriesInFile(selected, oldPassword, recoveryIssues);
      } else {
        found = await findEntryRecoveriesInAutoBackups(oldPassword, recoveryIssues);
      }
      setPreviews(found);
      setOldPassword('');
      setShowOldPassword(false);
    } catch (error: any) {
      setRecoveryError(String(error?.message || error));
    } finally {
      setRecoveryBusy(false);
    }
  };

  const applyRecovery = async () => {
    if (!previews.length || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const accountCount = previews.length;
      const count = await applyEntryRecoveries(previews);
      await useAppStore.getState().refreshAll();
      const nextReport = await verifyIntegrity();
      useIntegrityStore.getState().setReport(nextReport);
      resetRecovery();
      addToast(
        isEn
          ? `${count} field${count === 1 ? '' : 's'} recovered across ${accountCount} account${accountCount === 1 ? '' : 's'}`
          : `已恢复 ${accountCount} 个账号的 ${count} 个异常字段`,
        'success',
      );
      if (nextReport.ok) setOpen(false);
    } catch (error: any) {
      setRecoveryError(String(error?.message || error));
      setRecoveryBusy(false);
    }
  };

  if (!isOpen || !report) return null;
  const recoverableIssues = report.issues.filter((issue) =>
    issue.fields.some((field) => RECOVERABLE_FIELDS.includes(field))
  );
  const isBatchRecovery = recoveryIssues.length > 1;
  const previewFieldCount = previews.reduce((sum, preview) => sum + preview.fields.length, 0);
  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-6" onClick={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="integrity-title" className="w-full max-w-2xl max-h-[85vh] rounded-2xl border border-white/15 bg-[var(--void)] text-[var(--moon)] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
      }}>
        <header className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 id="integrity-title" className="font-semibold">{isEn ? 'Data integrity details' : '数据异常详情'}</h2>
          <button autoFocus aria-label={isEn ? 'Close' : '关闭'} onClick={() => setOpen(false)} className="p-1"><X size={20} /></button>
        </header>
        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-sm">{isEn
            ? `Checked ${report.checkedEntries} accounts, including Trash. ${report.corruptEntries} accounts have unreadable data.`
            : `已检查 ${report.checkedEntries} 个账号（包含回收站），${report.corruptEntries} 个账号存在无法读取的数据。`}</p>
          {report.dbError && <p className="text-sm text-red-300 break-words">{report.dbError}</p>}
          {recoverableIssues.length > 1 && (
            <button
              onClick={() => startRecovery(recoverableIssues)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-xs"
            >
              <RotateCcw size={14} />
              {isEn ? `Recover all ${recoverableIssues.length} accounts` : `批量恢复 ${recoverableIssues.length} 个账号`}
            </button>
          )}
          {report.issues.map((issue) => (
            <article key={issue.entryId} className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 space-y-2">
              <div className="font-medium break-words">{issue.title || (isEn ? 'Untitled' : '未命名账号')} <span className="text-xs text-[var(--moon-dim)]">ID: {issue.entryId}{issue.deleted ? (isEn ? ' · Trash' : ' · 回收站') : ''}</span></div>
              {issue.website && <p className="text-xs text-[var(--moon-dim)] break-all">{issue.website}</p>}
              <p className="text-sm text-amber-200">{isEn ? 'Affected fields: ' : '异常字段：'}{issue.fields.map((field) => encryptedFieldLabel(field, isEn)).join('、')}</p>
              {issue.historyIds.length > 0 && <p className="text-xs">{isEn ? 'History IDs: ' : '密码历史 ID：'}{issue.historyIds.join(', ')}</p>}
              {issue.attachments.map((file) => <p key={file.id} className="text-xs break-words">{isEn ? 'Attachment: ' : '附件：'}{file.name} (ID: {file.id})</p>)}
              {issue.fields.some((field) => RECOVERABLE_FIELDS.includes(field)) && (
                <button
                  onClick={() => startRecovery([issue])}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300/30 bg-amber-300/10 text-amber-100 text-xs hover:bg-amber-300/20"
                >
                  <RotateCcw size={14} />{isEn ? 'Recover only these fields' : '单独恢复异常字段'}
                </button>
              )}
            </article>
          ))}
          {recoveryIssues.length > 0 && (
            <section className="rounded-xl border border-[var(--mint)]/25 bg-white/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{isBatchRecovery
                    ? (isEn ? 'Batch recover from earlier backups' : '从改密前备份批量恢复')
                    : (isEn ? 'Recover from an earlier backup' : '从改密前备份恢复')}</h3>
                  <p className="mt-1 text-xs text-[var(--moon-dim)]">
                    {isBatchRecovery
                      ? (isEn
                        ? `${recoveryIssues.length} accounts · ${recoveryIssues.reduce((sum, issue) => sum + issue.fields.filter((field) => RECOVERABLE_FIELDS.includes(field)).length, 0)} affected fields`
                        : `${recoveryIssues.length} 个账号 · ${recoveryIssues.reduce((sum, issue) => sum + issue.fields.filter((field) => RECOVERABLE_FIELDS.includes(field)).length, 0)} 个异常字段`)
                      : `${recoveryIssues[0].title} · ${recoveryIssues[0].fields.map((field) => encryptedFieldLabel(field, isEn)).join('、')}`}
                  </p>
                </div>
                <button onClick={resetRecovery} aria-label={isEn ? 'Cancel recovery' : '取消恢复'}><X size={16} /></button>
              </div>
              {!previews.length ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--moon-dim)]">{isEn
                    ? 'Enter the master password used before the password change. It stays on this device. FallVault will scan encrypted backups and will not import other accounts.'
                    : '输入修改前使用的原主密码。密码只在本机用于解密备份；程序不会导入其他账号。'}</p>
                  <div className="relative">
                    <input
                      type={showOldPassword ? 'text' : 'password'}
                      value={oldPassword}
                      disabled={recoveryBusy}
                      onChange={(event) => setOldPassword(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') searchRecovery(false); }}
                      placeholder={isEn ? 'Previous master password' : '原主密码'}
                      className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-black/20 border border-white/15 text-sm outline-none focus:border-[var(--mint)]"
                    />
                    <button
                      type="button"
                      disabled={recoveryBusy}
                      onClick={() => setShowOldPassword((shown) => !shown)}
                      aria-label={showOldPassword ? (isEn ? 'Hide password' : '隐藏密码') : (isEn ? 'Show password' : '显示密码')}
                      title={showOldPassword ? (isEn ? 'Hide password' : '隐藏密码') : (isEn ? 'Show password' : '显示密码')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--moon-faint)] hover:text-[var(--moon)] disabled:opacity-40"
                    >
                      {showOldPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={!oldPassword || recoveryBusy}
                      onClick={() => searchRecovery(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-xs disabled:opacity-40"
                    >
                      {recoveryBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      {isEn ? 'Find automatically' : '自动查找并预览'}
                    </button>
                    <button
                      disabled={!oldPassword || recoveryBusy}
                      onClick={() => searchRecovery(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--mint)]/20 text-[var(--mint)] text-xs disabled:opacity-40"
                    >
                      <FolderOpen size={14} />{isEn ? 'Choose another backup' : '选择其他备份'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-lg bg-[var(--mint)]/10 border border-[var(--mint)]/20 p-3 text-xs space-y-1">
                    <p>{isEn
                      ? `${previews.length} account${previews.length === 1 ? '' : 's'} and ${previewFieldCount} field${previewFieldCount === 1 ? '' : 's'} ready`
                      : `已找到 ${previews.length} 个账号、${previewFieldCount} 个可恢复字段`}</p>
                    {previews.map((preview) => (
                      <div key={preview.entryId} className="pt-1">
                        <p className="text-[var(--moon)]">{preview.title} · {preview.fields.map((field) => encryptedFieldLabel(field, isEn)).join('、')}</p>
                        <p className="text-[var(--moon-dim)]">{isEn ? 'Backup: ' : '备份：'}{preview.backupTime}</p>
                      </div>
                    ))}
                    <p className="text-[var(--moon-dim)]">{isEn
                      ? 'Only the fields listed above will be replaced. The whole batch rolls back if any account changed.'
                      : '确认后只替换上述异常字段；任一账号发生变化时，整批恢复都会回滚。'}</p>
                  </div>
                  <button
                    disabled={recoveryBusy}
                    onClick={applyRecovery}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-xs disabled:opacity-40"
                  >
                    {recoveryBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                    {isBatchRecovery
                      ? (isEn ? 'Confirm batch recovery' : '确认批量恢复')
                      : (isEn ? 'Recover selected fields' : '确认恢复这些字段')}
                  </button>
                </>
              )}
              {recoveryError && <p className="text-xs text-red-300 break-words">{recoveryError}</p>}
            </section>
          )}
          {!report.ok && <p className="text-xs leading-relaxed text-[var(--moon-dim)]">{isEn
            ? 'After a master password change, unreadable fields may still use the previous key. Missing or damaged attachments also appear here. Keep a copy of the current vault and look for a backup from before the change. Changing the password back does not restore the previous key because each change generates a new salt.'
            : '如果在修改主密码后出现，相关字段可能仍使用旧密钥；附件缺失或损坏也会在这里列出。请保留当前保险库副本，并查找修改前的备份。直接把密码改回去不能恢复旧密钥，因为每次修改都会生成新的盐值。'}</p>}
        </div>
      </section>
    </div>
  );
}
