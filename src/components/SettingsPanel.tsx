import { useAppStore } from '@/stores/appStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { BUILTIN_WALLPAPERS, DEFAULT_BG_TOKEN } from '@/lib/constants';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resourceDir } from '@tauri-apps/api/path';
import { X, Palette, Languages, GlassWater, Waves, ImagePlus, Film, FolderOpen, FolderCog, RotateCcw, ShieldCheck, Lock, Timer, Save, Settings2, Smartphone } from 'lucide-react';
import { changeMasterPassword, lockVault } from '@/lib/crypto';
import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, removePath } from '@/lib/rustFs';
import { getBackgroundsDir } from '@/lib/mediaPaths';
import { useToastStore } from '@/stores/toastStore';
import { useState, useEffect } from 'react';
import { createBackup, listBackups, getBackupDir, getDataDir, BackupInfo } from '@/lib/backupManager';

export function SettingsPanel() {
  const { settings, updateSettings, setIsSettingsOpen, setIsTotpMigrationOpen } = useAppStore();
  const { addToast } = useToastStore();
  const t = (k: LangKey) => translate(settings.language, k);
  const isEn = settings.language === 'en';
  const [uploading, setUploading] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupAction, setBackupAction] = useState<'export' | 'import' | null>(null);
  const [restoreFilePath, setRestoreFilePath] = useState<string | null>(null);
  const [backupPwd, setBackupPwd] = useState('');
  const [backupPwd2, setBackupPwd2] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [integrityChecking, setIntegrityChecking] = useState(false);
  const [activeSection, setActiveSection] = useState<'basic' | 'appearance'>('appearance');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupDir, setBackupDir] = useState<string>('');
  const [dataDir, setDataDir] = useState<string>('');

  // 用系统文件管理器打开文件夹（Rust 命令）
  const openFolder = async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path });
    } catch (e) {
      console.error('open folder failed', e);
    }
  };

  const refreshBackups = async () => {
    setBackups(await listBackups());
  };
  const refreshBackupDir = async () => setBackupDir(await getBackupDir());
  // 进入设置时刷新一次备份列表、备份路径、数据文件夹路径
  useEffect(() => {
    refreshBackups();
    refreshBackupDir();
    setDataDir(useAppStore.getState().settings.dataDir || '');
  }, []);
  // 数据文件夹改动时同步显示
  useEffect(() => {
    setDataDir(settings.dataDir || '');
  }, [settings.dataDir]);

  // 应用内置壁纸
  const applyBuiltin = (wp: typeof BUILTIN_WALLPAPERS[number]) => {
    updateSettings({
      background: {
        ...settings.background,
        type: wp.type,
        source: wp.source,
        name: wp.name,
        darkOverlay: settings.background.darkOverlay || 0.45,
      },
    });
  };

  // 内置壁纸预览缩略图（支持 @resource: 标记，运行时经 Rust resolve_resource 解析）
  const BuiltinThumb = ({ preview }: { preview: string }) => {
    const [url, setUrl] = useState('');
    useEffect(() => {
      let mounted = true;
      if (!preview || !preview.startsWith('@resource:')) {
        if (mounted) setUrl(preview ? convertFileSrc(preview) : '');
        return;
      }
      const name = preview.slice('@resource:'.length);
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke<string>('resolve_resource', { name })
      ).then((path) => {
        if (mounted) setUrl(path ? convertFileSrc(path) : '');
      }).catch(() => {});
      return () => { mounted = false; };
    }, [preview]);
    return <div className="h-20 w-full bg-cover bg-center" style={{ backgroundImage: url ? `url("${url}")` : undefined }} />;
  };

  // 修改主密码
  const handleChangePassword = async () => {
    if (newPwd.length < 4) {
      addToast(isEn ? 'Password too short (min 4)' : '主密码至少 4 位', 'warning');
      return;
    }
    if (newPwd !== confirmPwd) {
      addToast(isEn ? 'Passwords do not match' : '两次输入不一致', 'warning');
      return;
    }
    setPwdLoading(true);
    try {
      await changeMasterPassword(newPwd);
      setShowPwdModal(false);
      setNewPwd('');
      setConfirmPwd('');
      addToast(isEn ? 'Master password updated' : '主密码已更新', 'success');
    } catch (e) {
      console.error('change master password failed', e);
      addToast(isEn ? 'Update failed' : '更新失败', 'error');
    } finally {
      setPwdLoading(false);
    }
  };

  // 数据完整性手动检查
  const handleIntegrityCheck = async () => {
    setIntegrityChecking(true);
    try {
      const { verifyIntegrity } = await import('@/lib/crypto');
      const report = await verifyIntegrity();
      if (report.ok) {
        addToast(
          isEn
            ? `Database OK (${report.checkedEntries} entries checked)`
            : `数据库完好（已检查 ${report.checkedEntries} 个账号）`,
          'success'
        );
      } else if (report.dbError) {
        addToast(isEn ? `Database error: ${report.dbError}` : `数据库异常：${report.dbError}`, 'error');
      } else {
        addToast(
          isEn
            ? `${report.corruptEntries} entries cannot be decrypted`
            : `${report.corruptEntries} 条数据无法解密（可能被篡改）`,
          'warning'
        );
      }
    } catch (e: any) {
      addToast(isEn ? 'Check failed' : '检查失败', 'error');
    } finally {
      setIntegrityChecking(false);
    }
  };

  // 加密备份导出/恢复
  const handleBackup = async () => {
    if (backupAction === 'export') {
      if (backupPwd.length < 4) {
        addToast(isEn ? 'Backup password too short (min 4)' : '备份密码至少 4 位', 'warning');
        return;
      }
      if (backupPwd !== backupPwd2) {
        addToast(isEn ? 'Passwords do not match' : '两次输入的密码不一致', 'warning');
        return;
      }
    } else {
      if (!backupPwd) {
        addToast(isEn ? 'Enter backup password' : '请输入备份密码', 'warning');
        return;
      }
    }
    setBackupBusy(true);
    try {
      if (backupAction === 'export') {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { exportVault, backupStamp } = await import('@/lib/vaultBackup');
        const filePath = await save({
          defaultPath: `FallVault_备份_${backupStamp()}.fvault`,
          filters: [{ name: 'FallVault 备份', extensions: ['fvault'] }],
        });
        if (!filePath) return;
        const res = await exportVault(backupPwd, filePath);
        addToast(
          isEn
            ? `Backup saved (${res.exported} entries${res.attachments ? `, ${res.attachments} attachments` : ''})`
            : `备份成功（${res.exported} 个账号${res.attachments ? `，${res.attachments} 个附件` : ''}）`,
          'success'
        );
      } else {
        if (!backupPwd) {
          addToast(isEn ? 'Enter backup password' : '请输入备份密码', 'warning');
          return;
        }
        const { restoreVault } = await import('@/lib/vaultBackup');
        // 优先使用自动备份下拉选中的文件；否则弹出文件选择
        let filePath = restoreFilePath;
        if (!filePath) {
          const { open } = await import('@tauri-apps/plugin-dialog');
          filePath = await open({
            multiple: false,
            filters: [{ name: 'FallVault 备份', extensions: ['fvault'] }],
          });
          if (!filePath || typeof filePath !== 'string') return;
        }
        const res = await restoreVault(backupPwd, filePath);
        addToast(
          isEn
            ? `Restored ${res.newEntries} entries (skipped ${res.skippedEntries} duplicates)`
            : `恢复完成：新增 ${res.newEntries} 个账号（跳过 ${res.skippedEntries} 个重复）`,
          'success'
        );
        useAppStore.getState().refreshAll();
        setRestoreFilePath(null);
      }
      setShowBackupModal(false);
      setBackupPwd('');
      setBackupPwd2('');
    } catch (e: any) {
      console.error('backup failed', e);
      addToast(e?.message || (isEn ? 'Operation failed' : '操作失败'), 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  // 锁定应用
  const handleLock = async () => {
    try {
      await lockVault();
      setIsSettingsOpen(false);
      // 触发应用锁定：通过 window 事件通知 App
      window.dispatchEvent(new Event('fallvault:lock'));
      addToast(isEn ? 'Vault locked' : '已锁定', 'success');
    } catch (e) {
      console.error('lock failed', e);
    }
  };

  const handleUpload = async (mediaType: 'image' | 'video') => {
    if (!dataDir) {
      addToast(isEn ? 'Set the data folder first to upload backgrounds' : '请先设置数据文件夹才能上传背景', 'error');
      return;
    }
    try {
      const file = await open({
        multiple: false,
        directory: false,
        filters: mediaType === 'image'
          ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
          : [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }],
      });
      if (!file || typeof file !== 'string') return;

      setUploading(true);
      const bgDir = await getBackgroundsDir();

      // 原文件名，避免路径特殊字符
      const name = file.split(/[\\/]/).pop() || 'bg';
      const ext = name.split('.').pop()?.toLowerCase() || (mediaType === 'image' ? 'png' : 'mp4');
      const destName = `bg_${Date.now()}.${ext}`;
      const destPath = `${bgDir}/${destName}`;
      await copyFile(file, destPath);

      // 加入自定义背景清单并应用
      const id = `custom_${Date.now()}`;
      const custom = { id, type: mediaType, source: destPath, name };
      updateSettings({
        background: { ...settings.background, type: mediaType, source: destPath, name },
        customBackgrounds: [...settings.customBackgrounds, custom],
      });
      addToast(isEn ? 'Background saved' : '背景已保存', 'success');
    } catch (e) {
      console.error('Upload bg failed:', e);
      addToast(isEn ? 'Upload failed' : '上传失败，请重试', 'error');
    } finally {
      setUploading(false);
    }
  };

  // 删除一个自定义背景（从清单移除 + 删除磁盘文件；若正在使用则回退默认）
  const handleDeleteCustom = async (id: string) => {
    const list = settings.customBackgrounds;
    const item = list.find((c) => c.id === id);
    if (!item) return;
    const newList = list.filter((c) => c.id !== id);
    const isUsing = settings.background.type === item.type && settings.background.source === item.source;
    const next: any = { customBackgrounds: newList };
    if (isUsing) {
      // 回退到内置默认壁纸（白凪 shiro）
      const def = BUILTIN_WALLPAPERS[0];
      next.background = { ...settings.background, type: def.type, source: def.source, name: def.name };
    }
    updateSettings(next);
    // 删除磁盘文件（忽略错误，例如文件已不存在）
    try { await removePath(item.source); } catch { /* noop */ }
    addToast(isEn ? 'Removed' : '已删除', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSettingsOpen(false)} />

      <div
        className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(26,26,46,0.92), rgba(18,18,30,0.97))',
          border: '1px solid rgba(192, 200, 216, 0.12)',
          borderRadius: '18px',
          backdropFilter: 'blur(28px)',
          boxShadow: '0 0 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(210,210,220,0.05)',
        }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--moon)]">{t('settings')}</h2>
          <button onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.08)] transition-all">
            <X size={20} />
          </button>
        </div>

        {/* 分类 Tab：外观 / 基础 */}
        <div className="flex gap-2 mb-5 p-1 rounded-2xl" style={{ background: 'rgba(192,200,216,0.06)' }}>
          {([
            ['appearance', isEn ? 'Appearance' : '外观', Palette],
            ['basic', isEn ? 'Basics' : '基础', Settings2],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === id
                  ? 'text-[#12121E] shadow-lg'
                  : 'text-[var(--moon-dim)] hover:text-[var(--moon)]'
              }`}
              style={activeSection === id ? { background: 'var(--mint)' } : {}}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {activeSection === 'appearance' && (<>
          {/* 主题 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Palette size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{t('theme')}</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {THEMES.map((th) => {
                const active = settings.theme === th.id;
                return (
                  <button key={th.id}
                    onClick={() => {
                      updateSettings({ theme: th.id });
                    }}
                    className={`rounded-xl p-3 border transition-all text-left ${
                      active
                        ? 'border-transparent shadow-[0_0_20px_rgba(210,210,220,0.15)]'
                        : 'border-[rgba(192,200,216,0.1)] hover:border-[rgba(192,200,216,0.25)]'
                    }`}
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, rgba(210,210,220,0.12), rgba(210,210,220,0.04))'
                        : 'rgba(18,18,30,0.5)',
                    }}>
                    {/* 主题色预览条 */}
                    <div className="h-8 rounded-lg mb-2 overflow-hidden flex">
                      <div style={{ background: th.cssVars['--void'] }} className="flex-1" />
                      <div style={{ background: th.cssVars['--mint'] }} className="flex-1" />
                      <div style={{ background: th.waves.wave }} className="flex-1" />
                      <div style={{ background: th.waves.crest }} className="flex-1" />
                    </div>
                    <div className="text-xs font-medium text-[var(--moon)]">
                      {isEn ? th.nameEn : th.name}
                    </div>
                    <div className="text-[10px] text-[var(--moon-faint)] mt-0.5">{th.id}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 背景 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Waves size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Background' : '背景'}
              </h3>
            </div>

            {/* 内置壁纸网格 */}
            <div className="grid grid-cols-2 gap-3">
              {BUILTIN_WALLPAPERS.map((wp) => {
                const active = settings.background.type === wp.type && settings.background.source === wp.source;
                return (
                  <button
                    key={wp.id}
                    onClick={() => applyBuiltin(wp)}
                    className={`relative rounded-xl overflow-hidden border transition-all text-left ${
                      active
                        ? 'border-transparent shadow-[0_0_20px_rgba(210,210,220,0.25)]'
                        : 'border-[rgba(192,200,216,0.12)] hover:border-[rgba(192,200,216,0.3)]'
                    }`}
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, rgba(210,210,220,0.14), rgba(210,210,220,0.05))'
                        : 'rgba(18,18,30,0.5)',
                    }}
                  >
                    <BuiltinThumb preview={wp.preview} />
                    {active && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--mint)' }}>
                        <span className="text-[10px]" style={{ color: '#12121E' }}>✓</span>
                      </div>
                    )}
                    <div className="p-2.5">
                      <div className="text-xs font-medium text-[var(--moon)] truncate">{wp.name}</div>
                      <div className="text-[10px] text-[var(--moon-faint)] mt-0.5">
                        {wp.type === 'video' ? (isEn ? 'Video' : '视频') : (isEn ? 'Image' : '图片')}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 自定义上传（图片/视频） */}
            <div className="mt-3 flex gap-1.5">
              <button
                onClick={() => handleUpload('image')}
                disabled={uploading}
                className="flex-1 text-[10px] px-2 py-1.5 rounded-lg bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all disabled:opacity-40 flex items-center justify-center gap-1"
                title={isEn ? 'Upload image' : '上传图片'}>
                <ImagePlus size={11} /> {isEn ? 'Image' : '图片'}
              </button>
              <button
                onClick={() => handleUpload('video')}
                disabled={uploading}
                className="flex-1 text-[10px] px-2 py-1.5 rounded-lg bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all disabled:opacity-40 flex items-center justify-center gap-1"
                title={isEn ? 'Upload video' : '上传视频'}>
                <Film size={11} /> {isEn ? 'Video' : '视频'}
              </button>
            </div>

            {/* 自定义背景清单（可滚动，缩略图 + 选择 + 删除） */}
            {settings.customBackgrounds.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1 custom-scroll">
                {settings.customBackgrounds.map((c) => {
                  const active = settings.background.type === c.type && settings.background.source === c.source;
                  return (
                    <div
                      key={c.id}
                      className={`relative group rounded-lg overflow-hidden border cursor-pointer transition-all ${active ? 'border-[var(--mint)] shadow-[0_0_12px_rgba(210,210,220,0.3)]' : 'border-[rgba(192,200,216,0.12)] hover:border-[rgba(192,200,216,0.3)]'}`}
                      onClick={() => updateSettings({ background: { ...settings.background, type: c.type, source: c.source, name: c.name } })}
                      title={c.name}
                    >
                      <div className="h-16 w-full bg-cover bg-center" style={{ backgroundImage: `url("${convertFileSrc(c.source)}")` }} />
                      {c.type === 'video' && (
                        <div className="absolute top-1 left-1 w-4 h-4 rounded bg-black/50 flex items-center justify-center">
                          <Film size={9} className="text-white" />
                        </div>
                      )}
                      {active && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--mint)' }}>
                          <span className="text-[8px]" style={{ color: '#12121E' }}>✓</span>
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCustom(c.id); }}
                        className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/55 hover:bg-red-500/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                        title={isEn ? 'Delete' : '删除'}>
                        <span className="text-[10px] text-white">✕</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {settings.customBackgrounds.length === 0 && (
              <div className="mt-3 text-[10px] text-[var(--moon-faint)] text-center py-2">
                {isEn ? 'No custom backgrounds yet' : '还没有自定义背景'}
              </div>
            )}
          </div>

          {/* 语言 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Languages size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{t('language')}</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={() => updateSettings({ language: 'zh' })}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm transition-all border ${
                  settings.language === 'zh'
                    ? 'border-transparent text-white'
                    : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-dim)] hover:border-[rgba(192,200,216,0.3)]'
                }`}
                style={settings.language === 'zh' ? { backgroundColor: 'var(--mint)', color: '#12121E' } : {}}>
                中文
              </button>
              <button onClick={() => updateSettings({ language: 'en' })}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm transition-all border ${
                  settings.language === 'en'
                    ? 'border-transparent text-white'
                    : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-dim)] hover:border-[rgba(192,200,216,0.3)]'
                }`}
                style={settings.language === 'en' ? { backgroundColor: 'var(--mint)', color: '#12121E' } : {}}>
                English
              </button>
            </div>
          </div>

          {/* 毛玻璃透明度 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <GlassWater size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{t('glassOpacity')}</h3>
              <span className="ml-auto text-xs font-mono text-[var(--mint)]">
                {Math.round(settings.glassOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={settings.glassOpacity}
              onChange={(e) => updateSettings({ glassOpacity: Number(e.target.value) })}
              onPointerUp={(e) => {
                // 松手后强制应用一次（防止拖动中卡顿丢失最后值）
                updateSettings({ glassOpacity: Number((e.target as HTMLInputElement).value) });
              }}
              className="w-full accent-[var(--mint)]"
            />
            <p className="text-[11px] text-[var(--moon-faint)] mt-1.5">{t('glassOpacityDesc')}</p>
          </div>
          </>)}

          {activeSection === 'basic' && (<>
          {/* 数据文件夹 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FolderCog size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Data Folder' : '数据文件夹'}
              </h3>
            </div>
            <p className="text-[11px] text-[var(--moon-faint)] mb-2">
              {isEn
                ? 'All files (backups, wallpapers, icons, attachments) are stored here. Set it first to enable auto-backup and background upload.'
                : '所有文件（自动备份、壁纸、图标、附件）都存放在此文件夹。请先设置，否则自动备份与背景导入将禁用。'}
            </p>
            <div
              className="rounded-xl px-3 py-2.5 text-[11px] font-mono truncate mb-2 border"
              style={{
                background: 'rgba(18,18,30,0.4)',
                borderColor: 'rgba(192,200,216,0.1)',
                color: dataDir ? 'var(--moon-dim)' : 'var(--danger, #ff6b6b)',
              }}
              title={dataDir || undefined}
            >
              {dataDir || (isEn ? 'Not set — auto backup & background disabled' : '未设置 — 自动备份与背景导入已禁用')}
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const dir = await open({ multiple: false, directory: true });
                  if (!dir || typeof dir !== 'string') return;
                  updateSettings({ dataDir: dir });
                }}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all flex items-center justify-center gap-1.5"
              >
                <FolderCog size={13} /> {isEn ? 'Choose folder' : '选择文件夹'}
              </button>
              <button
                onClick={() => dataDir && openFolder(dataDir)}
                disabled={!dataDir}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FolderOpen size={13} /> {isEn ? 'Open folder' : '打开文件夹'}
              </button>
              {dataDir && (
                <button
                  onClick={() => updateSettings({ dataDir: '' })}
                  className="text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.08)] text-[var(--moon-faint)] hover:bg-[rgba(210,210,220,0.16)] transition-all"
                  title={isEn ? 'Clear (disable auto backup)' : '清除（将禁用自动备份）'}
                >
                  {isEn ? 'Clear' : '清除'}
                </button>
              )}
            </div>
          </div>

          {/* 自动备份 + 版本历史 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Save size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Auto Backup & History' : '自动备份与版本历史'}
              </h3>
            </div>
            <label className={`flex items-center gap-2 text-sm text-[var(--moon-dim)] cursor-pointer mb-3 ${!dataDir ? 'opacity-40' : ''}`}>
              <input
                type="checkbox"
                checked={settings.autoBackupEnabled}
                disabled={!dataDir}
                onChange={(e) => updateSettings({ autoBackupEnabled: e.target.checked })}
                className="accent-[var(--mint)]"
              />
              {isEn ? 'Enable automatic backup' : '开启自动备份'}
            </label>
            {!dataDir && (
              <p className="text-[11px] text-[var(--danger, #ff6b6b)] mb-3">
                {isEn ? 'Set the data folder first to enable auto backup.' : '请先设置数据文件夹以启用自动备份。'}
              </p>
            )}
            {settings.autoBackupEnabled && dataDir && (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-[var(--moon-faint)] whitespace-nowrap">{isEn ? 'Interval' : '备份间隔'}</span>
                  <select
                    value={settings.autoBackupIntervalMin}
                    onChange={(e) => updateSettings({ autoBackupIntervalMin: Number(e.target.value) })}
                    className="rune-input px-2 py-1.5 text-xs bg-transparent flex-1"
                  >
                    <option value={30} style={{ background: '#1A1A2E' }}>30 {isEn ? 'min' : '分钟'}</option>
                    <option value={60} style={{ background: '#1A1A2E' }}>1 {isEn ? 'hour' : '小时'}</option>
                    <option value={360} style={{ background: '#1A1A2E' }}>6 {isEn ? 'hours' : '小时'}</option>
                    <option value={1440} style={{ background: '#1A1A2E' }}>24 {isEn ? 'hours' : '小时'}</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-[var(--moon-faint)] whitespace-nowrap">{isEn ? 'Keep' : '保留份数'}</span>
                  <select
                    value={settings.autoBackupMax}
                    onChange={(e) => updateSettings({ autoBackupMax: Number(e.target.value) })}
                    className="rune-input px-2 py-1.5 text-xs bg-transparent flex-1"
                  >
                    <option value={1} style={{ background: '#1A1A2E' }}>1 {isEn ? 'copy' : '份'}</option>
                    <option value={5} style={{ background: '#1A1A2E' }}>5 {isEn ? 'copies' : '份'}</option>
                  </select>
                </div>
                {/* 备份位置：固定为 数据文件夹/backups，仅展示 + 打开 */}
                <div className="mb-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs text-[var(--moon-faint)]">{isEn ? 'Backup location' : '备份位置'}</span>
                    <button
                      onClick={() => backupDir && openFolder(backupDir)}
                      className="text-[11px] px-2 py-1 rounded-lg bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all flex items-center gap-1"
                      title={isEn ? 'Open backup folder' : '打开备份文件夹'}
                    >
                      <FolderOpen size={11} /> {isEn ? 'Open' : '打开'}
                    </button>
                  </div>
                  <div className="text-[11px] text-[var(--moon-faint)] break-all rounded-lg bg-[rgba(192,200,216,0.05)] px-2.5 py-1.5">
                    {backupDir || '—'}
                  </div>
                </div>
              </>
            )}
            <div className="flex gap-2 mb-3">
              <button
                onClick={async () => {
                  const ok = await createBackup();
                  addToast(ok ? (isEn ? 'Backup created' : '已创建备份') : (isEn ? 'Backup failed' : '备份失败'), ok ? 'success' : 'error');
                  refreshBackups();
                }}
                disabled={!dataDir}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Save size={13} /> {isEn ? 'Backup now' : '立即备份'}
              </button>
              <button
                onClick={refreshBackups}
                className="px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all flex items-center justify-center"
                title={isEn ? 'Refresh list' : '刷新列表'}
              >
                <RotateCcw size={13} />
              </button>
            </div>
            {backups.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className="rune-input px-2 py-1.5 text-xs bg-transparent flex-1"
                  defaultValue=""
                  onChange={async (e) => {
                    const path = e.target.value;
                    if (!path) return;
                    // 与"恢复备份"完全相同的流程：打开恢复弹窗，输入密码解密
                    setRestoreFilePath(path);
                    setBackupAction('import');
                    setShowBackupModal(true);
                    e.target.value = '';
                  }}
                >
                  <option value="" style={{ background: '#1A1A2E' }}>{isEn ? 'Select a backup to restore…' : '选择要恢复的备份…'}</option>
                  {backups.map((b) => (
                    <option key={b.name} value={b.path} style={{ background: '#1A1A2E' }}>
                      {b.time} · {b.size}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[11px] text-[var(--moon-faint)] mt-2">
              {isEn
                ? 'Backups are stored in the data folder by default, or a custom folder you choose. Restore reloads the app.'
                : '备份默认保存在数据文件夹中，也可自选存放目录；恢复会重启应用以重新加载。'}
            </p>
          </div>

          {/* 自动锁定 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Timer size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Auto Lock' : '自动锁定'}
              </h3>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--moon-dim)] cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={settings.autoLockEnabled}
                onChange={(e) => updateSettings({ autoLockEnabled: e.target.checked })}
                className="accent-[var(--mint)]"
              />
              {isEn ? 'Lock after inactivity' : '闲置一段时间后自动锁定'}
            </label>
            {settings.autoLockEnabled && (
              <div className="flex gap-1.5 flex-wrap">
                {[5, 10, 15, 30].map((m) => (
                  <button
                    key={m}
                    onClick={() => updateSettings({ autoLockMinutes: m })}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      settings.autoLockMinutes === m
                        ? 'border-[var(--mint)] text-[var(--mint)] bg-[rgba(125,211,192,0.1)]'
                        : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-dim)] hover:border-[rgba(192,200,216,0.3)]'
                    }`}
                  >
                    {m} {isEn ? 'min' : '分钟'}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[var(--moon-faint)] mt-2">
              {isEn
                ? 'Locking instantly when minimized is always on'
                : '最小化窗口时会立即锁定（始终生效）'}
            </p>
          </div>

          {/* 安全 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Security' : '安全'}
              </h3>
            </div>
            <p className="text-[11px] text-[var(--moon-faint)] mb-2">
              {isEn
                ? 'Data is encrypted with AES-256-GCM using your master password'
                : '数据已用主密码 + AES-256-GCM 加密存储'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPwdModal(true)}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all flex items-center justify-center gap-1.5"
              >
                <ShieldCheck size={13} /> {isEn ? 'Change Password' : '修改主密码'}
              </button>
              <button
                onClick={handleLock}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(212,112,112,0.12)] text-[#D47070] hover:bg-[rgba(212,112,112,0.22)] transition-all flex items-center justify-center gap-1.5"
              >
                <Lock size={13} /> {isEn ? 'Lock' : '锁定应用'}
              </button>
            </div>

            {/* 加密备份 / 恢复 */}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { setBackupAction('export'); setShowBackupModal(true); }}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all flex items-center justify-center gap-1.5"
              >
                <Save size={13} /> {isEn ? 'Backup (.fvault)' : '加密备份 (.fvault)'}
              </button>
              <button
                onClick={() => { setBackupAction('import'); setShowBackupModal(true); }}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all flex items-center justify-center gap-1.5"
              >
                <FolderCog size={13} /> {isEn ? 'Restore' : '恢复备份'}
              </button>
            </div>
            <p className="text-[11px] text-[var(--moon-faint)] mt-2 leading-relaxed">
              {isEn
                ? 'Backup encrypts all entries + attachments into one .fvault file with a password. Restore merges it back.'
                : '备份会把全部账号和附件加密为一个 .fvault 文件（需设置备份密码）。恢复时合并回保险库。'}
            </p>
            <button
              onClick={handleIntegrityCheck}
              disabled={integrityChecking}
              className="mt-2 w-full text-xs px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.05)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.12)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {integrityChecking ? (
                <span className="w-3.5 h-3.5 border-2 border-[var(--mint)] border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <GlassWater size={13} />
              )}
              {integrityChecking
                ? (isEn ? 'Checking...' : '检查中…')
                : (isEn ? 'Check Database Integrity' : '数据完整性检查')}
            </button>
            <button
              onClick={() => setIsTotpMigrationOpen(true)}
              className="mt-2 w-full text-xs px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.05)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.12)] transition-all flex items-center justify-center gap-1.5"
            >
              <Smartphone size={13} />
              {isEn ? 'TOTP Migration' : 'TOTP 迁移（批量导出/导入）'}
            </button>
          </div>
          </>)}
        </div>
      </div>

      {/* 修改主密码弹窗 */}
      {showPwdModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: 'rgba(8,8,16,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowPwdModal(false)}
        >
          <div
            className="glass-card w-full max-w-sm rounded-3xl p-6"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--glass-border, rgba(255,245,245,0.4))',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-[var(--moon)]">
                {isEn ? 'Change Master Password' : '修改主密码'}
              </h3>
              <button onClick={() => setShowPwdModal(false)} className="text-[var(--moon-faint)] hover:text-[var(--moon)]">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder={isEn ? 'New master password' : '新主密码（至少 4 位）'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
              />
              <input
                type={showNewPwd ? 'text' : 'password'}
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder={isEn ? 'Confirm new password' : '再次输入新主密码'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
              />
              <label className="flex items-center gap-1.5 text-xs text-[var(--moon-dim)] cursor-pointer">
                <input type="checkbox" checked={showNewPwd} onChange={(e) => setShowNewPwd(e.target.checked)} className="accent-[var(--mint)]" />
                {isEn ? 'Show' : '显示密码'}
              </label>
              <button
                onClick={handleChangePassword}
                disabled={pwdLoading || !newPwd || !confirmPwd}
                className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40"
                style={{ background: 'rgba(125,211,192,0.2)', color: 'var(--mint)' }}
              >
                {pwdLoading ? (isEn ? 'Saving...' : '保存中…') : (isEn ? 'Save' : '确认修改')}
              </button>
              <p className="text-[11px] text-[var(--moon-faint)] leading-relaxed">
                {isEn
                  ? 'Changing the password re-encrypts the key. Existing data stays encrypted.'
                  : '修改主密码会重新派生密钥，已加密的数据保持不变，无需迁移。'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 加密备份 / 恢复 弹窗 */}
      {showBackupModal && backupAction && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(8,8,16,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => { if (!backupBusy) setShowBackupModal(false); }}
        >
          <div
            className="glass-card w-full max-w-sm rounded-3xl p-6"
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--glass-border, rgba(255,245,245,0.4))',
              boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-[var(--moon)] flex items-center gap-2">
                <Save size={16} style={{ color: 'var(--mint)' }} />
                {backupAction === 'export'
                  ? (isEn ? 'Encrypted Backup' : '加密备份')
                  : (isEn ? 'Restore Backup' : '恢复备份')}
              </h3>
              <button onClick={() => { if (!backupBusy) setShowBackupModal(false); }} className="text-[var(--moon-faint)] hover:text-[var(--moon)]">
                <X size={16} />
              </button>
            </div>

            {backupAction === 'export' ? (
              <p className="text-xs text-[var(--moon-faint)] mb-4 leading-relaxed">
                {isEn
                  ? 'Create an encrypted .fvault backup with a password. It contains all entries, folders, tags and attachments.'
                  : '用备份密码生成加密 .fvault 文件，包含所有账号、分类、标签和附件。整个文件只有用密码才能解开。'}
              </p>
            ) : (
              <p className="text-xs text-[var(--moon-faint)] mb-4 leading-relaxed">
                {isEn
                  ? 'Choose a .fvault backup file and enter its password to merge it back. Duplicate entries are skipped.'
                  : '选择 .fvault 备份文件并输入它的密码，合并回保险库。重复的账号会自动跳过。'}
              </p>
            )}

            <div className="space-y-3">
              {backupAction === 'import' && (
                <div className="text-[11px] rounded-lg px-2.5 py-2 bg-[rgba(125,211,192,0.08)] text-[var(--mint)] leading-relaxed">
                  {isEn
                    ? 'Tip: auto backups are encrypted with your master (lock) password. Enter that password to restore.'
                    : '提示：自动备份是用你的主密码（即软件锁定密码）加密的，请输入该密码来恢复。'}
                </div>
              )}
              <input
                type="password"
                value={backupPwd}
                onChange={(e) => setBackupPwd(e.target.value)}
                placeholder={isEn ? 'Backup password' : '备份密码（主密码）'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
              />
              {backupAction === 'export' && (
                <input
                  type="password"
                  value={backupPwd2}
                  onChange={(e) => setBackupPwd2(e.target.value)}
                  placeholder={isEn ? 'Confirm backup password' : '再次输入备份密码'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none transition-all focus:border-[var(--mint)] text-[var(--moon)] placeholder:text-[var(--moon-faint)]"
                />
              )}
              <button
                onClick={handleBackup}
                disabled={backupBusy || !backupPwd}
                className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40"
                style={{ background: 'rgba(125,211,192,0.2)', color: 'var(--mint)' }}
              >
                {backupBusy
                  ? (isEn ? 'Working...' : '处理中…')
                  : (backupAction === 'export' ? (isEn ? 'Create Backup' : '生成备份文件') : (isEn ? 'Restore' : '开始恢复'))}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}