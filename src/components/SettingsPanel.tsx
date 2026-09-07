import { useAppStore } from '@/stores/appStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { BUILTIN_WALLPAPERS, DEFAULT_BG_TOKEN } from '@/lib/constants';
import { convertFileSrc } from '@tauri-apps/api/core';
import { X, Palette, Languages, GlassWater, Waves, ImagePlus, Film, FolderOpen, FolderCog, ShieldCheck, Lock, Timer, Save, Settings2, Smartphone, Keyboard, Github, HelpCircle, KeyRound } from 'lucide-react';
import { changeMasterPassword, lockVault } from '@/lib/crypto';
import { open } from '@tauri-apps/plugin-dialog';
import { copyFile, removePath } from '@/lib/rustFs';
import { getBackgroundsDir } from '@/lib/mediaPaths';
import { setAutofillHotkey } from '@/lib/autofill';
import { useToastStore } from '@/stores/toastStore';
import { useState, useEffect } from 'react';
import { GITHUB_BACKUP_SCHEDULE_EVENT, getDataDir, getNextGithubBackupAt } from '@/lib/backupManager';
import { clearVaultChangeMarker, getVaultChangeMarker, markVaultChanged, setLastGithubBackupAt } from '@/lib/vaultChange';

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
  const [activeSection, setActiveSection] = useState<'basic' | 'appearance' | 'github'>('appearance');
  const [ghRepos, setGhRepos] = useState<{ full_name: string }[]>([]);
  const [ghBusy, setGhBusy] = useState(false);
  const [ghHelp, setGhHelp] = useState(false);
  const [ghTokens, setGhTokens] = useState<string[]>([]); // 已保存的令牌 label 列表（令牌本身在 Windows 凭据管理器）
  const [ghShowSave, setGhShowSave] = useState(false); // 保存令牌面板开关
  const [ghSelectedTokenLabel, setGhSelectedTokenLabel] = useState(''); // 手动与自动备份共用的令牌 label
  const [ghSelectedRepo, setGhSelectedRepo] = useState(''); // 手动与自动备份共用的仓库
  const [ghSaveName, setGhSaveName] = useState(''); // 保存时的令牌名字
  const [ghSaveToken, setGhSaveToken] = useState(''); // 保存时的令牌值
  const [ghLastBackup, setGhLastBackup] = useState<{ repo: string; time: string } | null>(null);
  const [ghNextBackupAt, setGhNextBackupAt] = useState<number | null>(() => getNextGithubBackupAt());
  const [dataDir, setDataDir] = useState<string>('');
  const [capturing, setCapturing] = useState(false);
  const [capturingQuick, setCapturingQuick] = useState(false); // 快速打开热键捕获

  // 把键盘事件的 code 映射成 Rust 端 rdev 变体名 token（支持任意键）
  const codeToToken = (code: string): string | null => {
    if (code === 'Insert') return 'Ins';
    if (code === 'Escape') return null; // 取消
    const f = /^F(\d{1,2})$/.exec(code);
    if (f) {
      const n = parseInt(f[1], 10);
      if (n >= 1 && n <= 12) return `F${n}`;
    }
    if (/^Key[A-Z]$/.test(code)) return code;          // KeyA -> KeyA
    const d = /^Digit([0-9])$/.exec(code);
    if (d) return `Num${d[1]}`;                          // Digit1 -> Num1（rdev 数字行用 Num*）
    const map: Record<string, string> = {
      Tab: 'Tab', Enter: 'Return', Delete: 'Delete', Backspace: 'Backspace',
      Space: 'Space', Pause: 'Pause', ScrollLock: 'ScrollLock', PrintScreen: 'PrintScreen',
      CapsLock: 'CapsLock', Backquote: 'BackQuote', Minus: 'Minus', Equal: 'Equal',
      BracketLeft: 'LeftBracket', BracketRight: 'RightBracket', Backslash: 'BackSlash',
      Semicolon: 'SemiColon', Quote: 'Quote', Comma: 'Comma', Period: 'Dot', Slash: 'Slash',
      ArrowUp: 'UpArrow', ArrowDown: 'DownArrow', ArrowLeft: 'LeftArrow', ArrowRight: 'RightArrow',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    };
    return map[code] ?? null;
  };

  // token -> 显示标签
  const tokenToLabel = (tok: string): string => {
    if (!tok) return 'Ins';
    if (tok === 'Ins') return 'Ins';
    if (/^Key([A-Z])$/.test(tok)) return tok.slice(3);
    if (/^Num([0-9])$/.test(tok)) return tok.slice(3);
    if (tok === 'Return') return 'Enter';
    if (tok === 'BackSlash') return '\\';
    if (tok === 'ForwardSlash') return '/';
    if (tok === 'LeftBracket') return '[';
    if (tok === 'RightBracket') return ']';
    if (tok === 'SemiColon') return ';';
    if (tok === 'Quote') return "'";
    if (tok === 'BackQuote') return '`';
    if (tok === 'Minus') return '-';
    if (tok === 'Equal') return '=';
    if (tok === 'Comma') return ',';
    if (tok === 'Dot') return '.';
    if (tok === 'Space') return 'Space';
    if (tok === 'Backspace') return 'Backspace';
    if (tok === 'Delete') return 'Delete';
    if (tok === 'ScrollLock') return 'ScrollLock';
    if (tok === 'PrintScreen') return 'PrintScreen';
    if (tok === 'CapsLock') return 'CapsLock';
    if (tok === 'UpArrow') return '↑';
    if (tok === 'DownArrow') return '↓';
    if (tok === 'LeftArrow') return '←';
    if (tok === 'RightArrow') return '→';
    return tok;
  };

  // 捕获热键：监听下一次真实按键（支持任意键，Esc 取消）
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const token = codeToToken(e.code);
      setCapturing(false);
      if (token) {
        updateSettings({ autofillHotkey: token });
        setAutofillHotkey(token).catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  // 捕获快速打开热键：支持「单键」或「组合键」（Ctrl/Alt/Shift + 主键），Esc 取消
  useEffect(() => {
    if (!capturingQuick) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setCapturingQuick(false); return; }
      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      // 主键（排除纯修饰键），并转成 Tauri global-shortcut 接受的格式（KeyQ->Q, Num1->1, Return->Enter）
      const raw = codeToToken(e.code);
      if (!raw) return; // 只按修饰键，等主键
      let alone = raw;
      if (/^Key([A-Z])$/.test(raw)) alone = raw.slice(3);
      else if (/^Num([0-9])$/.test(raw)) alone = raw.slice(3);
      else if (raw === 'Return') alone = 'Enter';
      else if (raw === 'BackQuote') alone = '`';
      else if (raw === 'Space') alone = 'Space';
      const combo = [...mods, alone].join('+');
      setCapturingQuick(false);
      updateSettings({ quickOpenHotkey: combo });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturingQuick]);

  // 用系统文件管理器打开文件夹（Rust 命令）
  const openFolder = async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path });
    } catch (e) {
      console.error('open folder failed', e);
      addToast(isEn ? 'Unable to open folder; check whether the path exists' : '无法打开文件夹，请检查路径是否存在', 'error');
    }
  };

  // 进入设置时刷新一次数据文件夹路径
  useEffect(() => {
    setDataDir(useAppStore.getState().settings.dataDir || '');
  }, []);
  // 进入设置时加载已保存的令牌 label / 仓库记忆 / 上次备份时间
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const raw = await invoke<string>('github_load_index');
        const idx = JSON.parse(raw || '{}');
        if (Array.isArray(idx.tokens)) setGhTokens(idx.tokens);
        if (idx.lastBackup) setGhLastBackup(idx.lastBackup);
      } catch { /* 忽略：首次无索引 */ }
    })();
    const cfg = useAppStore.getState().settings.githubAutoBackup;
    setGhSelectedTokenLabel(cfg.tokenLabel || '');
    setGhSelectedRepo(cfg.repo || '');
  }, []);
  useEffect(() => {
    const updateNextBackup = (event: Event) => {
      const nextAt = (event as CustomEvent<number | null>).detail;
      setGhNextBackupAt(typeof nextAt === 'number' ? nextAt : null);
    };
    setGhNextBackupAt(getNextGithubBackupAt());
    window.addEventListener(GITHUB_BACKUP_SCHEDULE_EVENT, updateNextBackup);
    return () => window.removeEventListener(GITHUB_BACKUP_SCHEDULE_EVENT, updateNextBackup);
  }, []);
  // 持久化索引到本地（不含令牌本身）
  const persistGhIndex = async (
    nextTokens = ghTokens,
    nextLastBackup: { repo: string; time: string } | null = ghLastBackup,
  ) => {
    const idx = JSON.stringify({ tokens: nextTokens, lastBackup: nextLastBackup });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('github_save_index', { json: idx });
    } catch { /* 忽略 */ }
  };
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
      // 触发应用锁定：通过 Tauri 事件总线通知 App（listen 接收）
      import('@tauri-apps/api/event').then((m) => m.emit('fallvault:lock')).catch(() => {});
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
            ['github', isEn ? 'GitHub Backup' : 'GitHub 备份', Github],
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
                ? 'All files (wallpapers, icons, attachments) are stored here. Set it first to enable background import.'
                : '所有文件（壁纸、图标、附件）都存放在此文件夹。请先设置，否则背景导入将禁用。'}
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
              {dataDir || (isEn ? 'Not set — background import disabled' : '未设置 — 背景导入已禁用')}
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
                  title={isEn ? 'Clear (disable background import)' : '清除（将禁用背景导入）'}
                >
                  {isEn ? 'Clear' : '清除'}
                </button>
              )}
            </div>
          </div>

          {/* TOTP 时间偏移校正 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{isEn ? 'TOTP Time Offset' : 'TOTP 时间偏移校正'}</h3>
            </div>
            <p className="text-xs text-[var(--moon-faint)] mb-3">
              {isEn
                ? 'If FallVault 2FA codes differ from your authenticator app (e.g. Google Authenticator), your PC clock may be off. Enter the difference in seconds so codes align. Positive = your PC is behind, negative = ahead.'
                : '若 FallVault 的 2FA 验证码与验证器 App（如谷歌验证器）不一致，多半是本机时间与验证器设备时间有偏差。填入差值（秒）即可对齐：正数为本机偏慢、负数为本机偏快。'}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={settings.totpOffsetSec ?? 0}
                onChange={(e) => updateSettings({ totpOffsetSec: parseInt(e.target.value || '0', 10) || 0 })}
                className="w-32 px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.06)] border border-[rgba(210,210,220,0.12)] text-[var(--moon)] text-sm focus:outline-none focus:border-[var(--mint)]"
                placeholder="0"
              />
              <span className="text-xs text-[var(--moon-faint)]">{isEn ? 'seconds' : '秒'}</span>
              <button
                onClick={() => updateSettings({ totpOffsetSec: 0 })}
                className="text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.08)] text-[var(--moon-faint)] hover:bg-[rgba(210,210,220,0.16)] transition-all"
              >
                {isEn ? 'Reset' : '归零'}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{isEn ? 'Auto-fill Hotkey' : '半自动填充热键'}</h3>
            </div>
            <p className="text-xs text-[var(--moon-faint)] mb-3">
              {isEn
                ? 'Select an entry (or copy its account/password), then focus the login field in your browser and press the hotkey: it fills username, presses Tab to jump to password, then fills password. Clipboard is cleared after filling. (No auto Enter — you log in yourself.)'
                : '选中某条账号（或复制其账号/密码）后，在浏览器里点进登录框，按此热键：先填账号、Tab 跳到密码框、再填密码（填完自动清空剪贴板，不自动回车，由你自己登录）。'}
            </p>
            <div className="flex items-center gap-2">
              {capturing ? (
                <button
                  className="px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.18)] border border-[var(--mint)] text-[var(--mint)] text-sm animate-pulse"
                  onClick={() => setCapturing(false)}
                >
                  {isEn ? 'Press any key… (Esc to cancel)' : '请按下任意按键…（Esc 取消）'}
                </button>
              ) : (
                <button
                  onClick={() => setCapturing(true)}
                  className="px-3 py-2 rounded-xl bg-[rgba(18,18,30,0.6)] border border-[rgba(192,200,216,0.12)] text-[var(--moon)] text-sm hover:border-[var(--mint)] transition-all min-w-[120px] text-left"
                >
                  {tokenToLabel(settings.autofillHotkey)}
                </button>
              )}
              <span className="text-xs text-[var(--moon-faint)]">
                {isEn ? 'Click then press any key (Esc to cancel)' : '点击后按一下任意按键即可（Esc 取消）'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--moon-dim)] cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={!!settings.autofillResetAfterUse}
                onChange={(e) => updateSettings({ autofillResetAfterUse: e.target.checked })}
                className="accent-[var(--mint)] w-4 h-4"
              />
              {isEn ? 'Reset fill target after each fill (re-select account next time)' : '每次填充后重置账号（开启后填一次即清除，下次需重新选择）'}
            </label>
          </div>

          {/* 快速打开热键 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">{isEn ? 'Quick Open Hotkey' : '快速打开热键'}</h3>
            </div>
            <p className="text-xs text-[var(--moon-faint)] mb-3">
              {isEn
                ? 'A global shortcut to bring FallVault to front (from tray / minimized / background) while the app is running. Press single key or a combo (Ctrl/Alt/Shift + key). Set empty to disable.'
                : '软件在跑时，按此全局快捷键一键唤起窗口（从托盘 / 最小化 / 后台均可）。支持单键或组合键（Ctrl/Alt/Shift + 主键）。设为空可关闭。'}
            </p>
            <div className="flex items-center gap-2">
              {capturingQuick ? (
                <button
                  className="px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.18)] border border-[var(--mint)] text-[var(--mint)] text-sm animate-pulse"
                  onClick={() => setCapturingQuick(false)}
                >
                  {isEn ? 'Press combo… (Esc to cancel)' : '按下按键（组合键可加 Ctrl/Alt/Shift）…（Esc 取消）'}
                </button>
              ) : (
                <button
                  onClick={() => setCapturingQuick(true)}
                  className="px-3 py-2 rounded-xl bg-[rgba(18,18,30,0.6)] border border-[rgba(192,200,216,0.12)] text-[var(--moon)] text-sm hover:border-[var(--mint)] transition-all min-w-[120px] text-left"
                >
                  {settings.quickOpenHotkey ? tokenToLabel(settings.quickOpenHotkey) : (isEn ? 'Disabled' : '已关闭')}
                </button>
              )}
              {settings.quickOpenHotkey && (
                <button
                  onClick={() => updateSettings({ quickOpenHotkey: '' })}
                  className="text-xs text-[var(--moon-faint)] hover:text-[var(--mint)] transition-colors"
                >
                  {isEn ? 'Clear' : '清除'}
                </button>
              )}
              <span className="text-xs text-[var(--moon-faint)]">
                {isEn ? 'Click then press key/combo (Esc to cancel)' : '点击后按一下按键或组合键（Esc 取消）'}
              </span>
            </div>
          </div>



          {/* 解锁宽限（免验证时长） */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Timer size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Unlock Grace (Password-free Duration)' : '免验证时长'}
              </h3>
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--moon-dim)] cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={settings.unlockGraceEnabled}
                onChange={(e) => updateSettings({ unlockGraceEnabled: e.target.checked })}
                className="accent-[var(--mint)] w-4 h-4"
              />
              {isEn ? 'Keep unlocked for a while after sign-in (no re-enter within duration)' : '登录后一段时间内免验证（时长内重新打开/托盘唤起不要求输密码）'}
            </label>
            {settings.unlockGraceEnabled && (
              <div className="flex gap-1.5 flex-wrap">
                {[1, 5, 15, 30, 60].map((m) => (
                  <button
                    key={m}
                    onClick={() => updateSettings({ unlockGraceMin: m })}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      settings.unlockGraceMin === m
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
                ? 'Manual "Lock" always clears the session immediately. After the duration expires, password is required again. Closing the app always requires re-entry.'
                : '手动「锁定」始终立即失效；超期后需重输；完全关闭软件下次必重输。'}
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

        {/* GitHub 备份 Tab（与 外观/基础 同级） */}
        {activeSection === 'github' && (<>
          <div className="flex items-center gap-2 mb-3">
            <Github size={15} style={{ color: 'var(--mint)' }} />
            <h3 className="text-sm font-semibold text-[var(--moon)]">{isEn ? 'GitHub Backup' : 'GitHub 备份'}</h3>
            <button
              onClick={() => setGhHelp(true)}
              className="ml-auto text-[var(--moon-dim)] hover:text-[var(--mint)] transition-colors p-1 rounded-lg hover:bg-[rgba(210,210,220,0.08)]"
              title={isEn ? 'How to use' : '使用教程'}
            >
              <HelpCircle size={16} />
            </button>
          </div>

          <p className="text-[11px] text-[var(--moon-faint)] mb-4 leading-relaxed">
            {isEn
              ? 'Sync your encrypted .fvault backup to a private GitHub repo. Your master password is NEVER uploaded — only the encrypted file.'
              : '把本地加密的 .fvault 备份同步到你的 GitHub 私有仓库。主密码绝不会上传，只同步已加密的文件。'}
          </p>

          {/* GitHub 连接配置：自动备份与手动操作共用 */}
          <div className="mb-4 p-3 rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={14} className="text-[var(--mint)]" />
              <span className="text-xs font-medium text-[var(--moon)]">{isEn ? 'GitHub connection' : 'GitHub 连接配置'}</span>
            </div>

            <button
              onClick={() => { setGhShowSave((value) => !value); setGhSaveName(''); setGhSaveToken(''); }}
              className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all mb-2"
            >
              {isEn ? '+ Add token' : '+ 添加令牌'}
            </button>
            {ghShowSave && (
              <div className="mb-2 p-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] space-y-2">
                <input
                  type="text"
                  value={ghSaveName}
                  onChange={(e) => setGhSaveName(e.target.value)}
                  placeholder={isEn ? 'Token name (e.g. my-pat)' : '令牌名字（如 我的令牌）'}
                  className="rune-input w-full px-3 py-2 text-sm bg-transparent"
                />
                <input
                  type="password"
                  value={ghSaveToken}
                  onChange={(e) => setGhSaveToken(e.target.value)}
                  placeholder={isEn ? 'Paste token here' : '把令牌粘贴到这里'}
                  className="rune-input w-full px-3 py-2 text-sm bg-transparent"
                />
                <button
                  onClick={async () => {
                    if (!ghSaveToken.trim()) { addToast(isEn ? 'Enter a token' : '请填写令牌', 'warning'); return; }
                    const label = ghSaveName.trim() || 'github-token';
                    try {
                      const { invoke } = await import('@tauri-apps/api/core');
                      await invoke('github_cred_save', { label, token: ghSaveToken.trim() });
                      const nextTokens = ghTokens.includes(label) ? ghTokens : [...ghTokens, label];
                      setGhTokens(nextTokens);
                      await persistGhIndex(nextTokens);
                      setGhSelectedTokenLabel(label);
                      setGhSelectedRepo('');
                      setGhRepos([]);
                      setGhSaveName('');
                      setGhSaveToken('');
                      setGhShowSave(false);
                      addToast(isEn ? `Saved token "${label}"` : `已保存令牌「${label}」（存于系统凭据管理器）`, 'success');
                    } catch (e: any) {
                      addToast(isEn ? `Save failed: ${String(e)}` : `保存失败：${String(e)}`, 'error');
                    }
                  }}
                  className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(125,211,192,0.15)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.25)] transition-all"
                >
                  {isEn ? 'Save token' : '保存令牌'}
                </button>
              </div>
            )}

            <div className="flex gap-2 mb-2">
              <select
                value={ghSelectedTokenLabel}
                onChange={(e) => {
                  const label = e.target.value;
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  setGhSelectedTokenLabel(label);
                  setGhRepos([]);
                  setGhSelectedRepo(label === cfg.tokenLabel ? cfg.repo : '');
                }}
                className="rune-input flex-1 min-w-0 px-3 py-2 text-sm bg-transparent"
              >
                <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '— select a saved token —' : '— 选择已保存令牌 —'}</option>
                {ghSelectedTokenLabel && !ghTokens.includes(ghSelectedTokenLabel) && (
                  <option value={ghSelectedTokenLabel} style={{ background: '#1A1A2E' }}>{ghSelectedTokenLabel}</option>
                )}
                {ghTokens.map((tokenLabel) => (
                  <option key={tokenLabel} value={tokenLabel} style={{ background: '#1A1A2E' }}>{tokenLabel}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!ghSelectedTokenLabel) return;
                  const label = ghSelectedTokenLabel;
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    await invoke('github_cred_delete', { label });
                    const nextTokens = ghTokens.filter((item) => item !== label);
                    setGhTokens(nextTokens);
                    await persistGhIndex(nextTokens);
                    setGhSelectedTokenLabel('');
                    setGhSelectedRepo('');
                    setGhRepos([]);
                    const cfg = useAppStore.getState().settings.githubAutoBackup;
                    if (cfg.tokenLabel === label) {
                      updateSettings({ githubAutoBackup: { ...cfg, enabled: false, tokenLabel: '', repo: '' } });
                    }
                    addToast(isEn ? `Deleted token "${label}"` : `已删除令牌「${label}」`, 'info');
                  } catch (e: any) {
                    addToast(isEn ? `Delete failed: ${String(e)}` : `删除失败：${String(e)}`, 'error');
                  }
                }}
                disabled={!ghSelectedTokenLabel}
                className="shrink-0 px-3 py-2 rounded-xl bg-[rgba(255,90,90,0.08)] text-[var(--danger)] hover:bg-[rgba(255,90,90,0.15)] transition-all disabled:opacity-30"
                title={isEn ? 'Delete selected token' : '删除所选令牌'}
              >
                <X size={15} />
              </button>
            </div>

            <button
              onClick={async () => {
                if (!ghSelectedTokenLabel) { addToast(isEn ? 'Select or add a token first' : '请先选择或添加令牌', 'warning'); return; }
                setGhBusy(true);
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const token = await invoke<string>('github_cred_get', { label: ghSelectedTokenLabel });
                  const repos = await invoke<{ full_name: string }[]>('github_list_repos', { token });
                  setGhRepos(repos);
                  setGhSelectedRepo((current) => repos.some((repo) => repo.full_name === current) ? current : '');
                  addToast(isEn ? `Found ${repos.length} repos` : `找到 ${repos.length} 个仓库`, 'success');
                } catch (e: any) {
                  addToast(isEn ? `Failed: ${String(e)}` : `失败：${String(e)}`, 'error');
                } finally {
                  setGhBusy(false);
                }
              }}
              disabled={ghBusy || !ghSelectedTokenLabel}
              className="w-full text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.1)] text-[var(--moon-dim)] hover:bg-[rgba(210,210,220,0.18)] transition-all disabled:opacity-40 mb-2"
            >
              {ghBusy ? (isEn ? 'Loading…' : '获取中…') : (isEn ? 'List my repositories' : '获取我的仓库')}
            </button>

            {(ghRepos.length > 0 || ghSelectedRepo) && (
              <select
                value={ghSelectedRepo}
                onChange={(e) => {
                  const repo = e.target.value;
                  setGhSelectedRepo(repo);
                  if (!repo || !ghSelectedTokenLabel) return;
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  updateSettings({ githubAutoBackup: { ...cfg, tokenLabel: ghSelectedTokenLabel, repo } });
                  markVaultChanged(); // 新连接需要先同步一次现有保险库
                  addToast(isEn ? 'GitHub connection saved' : 'GitHub 连接配置已保存', 'success');
                }}
                className="rune-input w-full px-3 py-2.5 text-sm bg-transparent mb-2"
              >
                <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '— choose repository —' : '— 选择仓库（选择后自动保存）—'}</option>
                {ghSelectedRepo && !ghRepos.some((repo) => repo.full_name === ghSelectedRepo) && (
                  <option value={ghSelectedRepo} style={{ background: '#1A1A2E' }}>{ghSelectedRepo}</option>
                )}
                {ghRepos.map((repo) => (
                  <option key={repo.full_name} value={repo.full_name} style={{ background: '#1A1A2E' }}>{repo.full_name}</option>
                ))}
              </select>
            )}

            {settings.githubAutoBackup.repo && settings.githubAutoBackup.tokenLabel ? (
              <div className="text-[11px] text-[var(--mint)]">
                {isEn
                  ? `Connected: ${settings.githubAutoBackup.tokenLabel} → ${settings.githubAutoBackup.repo}`
                  : `当前连接：${settings.githubAutoBackup.tokenLabel} → ${settings.githubAutoBackup.repo}`}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--moon-faint)]">
                {isEn ? 'Add a token, list repositories, then select one.' : '添加令牌并获取仓库后，选择一个仓库即可完成配置。'}
              </div>
            )}
          </div>

          {/* GitHub 自动备份 */}
          <div className="mb-4 p-3 rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Timer size={14} className="text-[var(--mint)]" />
                <span className="text-xs font-medium text-[var(--moon)]">{isEn ? 'Auto backup' : '自动备份'}</span>
              </div>
              <button
                onClick={() => {
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  if (!cfg.enabled && (!cfg.tokenLabel || !cfg.repo)) {
                    addToast(isEn ? 'Configure the GitHub connection first' : '请先完成 GitHub 连接配置', 'warning');
                    return;
                  }
                  const enabled = !cfg.enabled;
                  updateSettings({ githubAutoBackup: { ...cfg, enabled } });
                  if (enabled) markVaultChanged(); // 开启后安排首次同步
                }}
                className={`relative w-11 h-6 rounded-full transition-all ${settings.githubAutoBackup.enabled ? 'bg-[var(--mint)]' : 'bg-[rgba(255,255,255,0.12)]'}`}
                title={isEn ? 'Toggle auto backup' : '开关自动备份'}
              >
                <span className={`absolute top-0.5 ${settings.githubAutoBackup.enabled ? 'left-[22px]' : 'left-0.5'} w-5 h-5 rounded-full bg-white transition-all`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--moon-faint)]">{isEn ? 'Interval' : '备份间隔'}</span>
              <select
                value={settings.githubAutoBackup.intervalMin}
                onChange={(e) => {
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  updateSettings({ githubAutoBackup: { ...cfg, intervalMin: Number(e.target.value) } });
                }}
                className="rune-input flex-1 px-3 py-2 text-sm bg-transparent"
              >
                <option value={30} style={{ background: '#1A1A2E' }}>{isEn ? '30 minutes' : '30 分钟'}</option>
                <option value={60} style={{ background: '#1A1A2E' }}>{isEn ? '1 hour' : '1 小时'}</option>
                <option value={180} style={{ background: '#1A1A2E' }}>{isEn ? '3 hours' : '3 小时'}</option>
                <option value={360} style={{ background: '#1A1A2E' }}>{isEn ? '6 hours' : '6 小时'}</option>
                <option value={720} style={{ background: '#1A1A2E' }}>{isEn ? '12 hours' : '12 小时'}</option>
                <option value={1440} style={{ background: '#1A1A2E' }}>{isEn ? '24 hours' : '24 小时'}</option>
              </select>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-[var(--moon-faint)]">{isEn ? 'Keep' : '保留份数'}</span>
              <select
                value={settings.githubAutoBackup.maxBackups}
                onChange={(e) => {
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  updateSettings({ githubAutoBackup: { ...cfg, maxBackups: Number(e.target.value) } });
                }}
                className="rune-input flex-1 px-3 py-2 text-sm bg-transparent"
              >
                {[5, 10, 20, 30, 50].map((count) => (
                  <option key={count} value={count} style={{ background: '#1A1A2E' }}>
                    {isEn ? `${count} backups` : `${count} 份`}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 text-[11px] text-[var(--moon-dim)]">
              {isEn
                ? `Changes settle for 3 minutes. Uploads are at least one selected interval apart; unchanged vaults are skipped. The latest ${settings.githubAutoBackup.maxBackups} backups are kept.`
                : `修改后等待 3 分钟；两次上传至少间隔所选时长，无变化会跳过。GitHub 保留最近 ${settings.githubAutoBackup.maxBackups} 份。`}
            </div>
            <div className="mt-2 rounded-xl bg-[rgba(125,211,192,0.07)] px-3 py-2 text-xs text-[var(--moon-dim)]">
              <span>{isEn ? 'Next backup: ' : '下次备份：'}</span>
              <span className="font-medium text-[var(--moon)]">
                {!settings.githubAutoBackup.enabled
                  ? (isEn ? 'Auto backup is off' : '自动备份未开启')
                  : ghNextBackupAt
                    ? new Date(ghNextBackupAt).toLocaleString(isEn ? 'en-US' : 'zh-CN')
                    : (isEn ? 'Waiting for vault changes' : '等待数据变化')}
              </span>
            </div>
          </div>

          {/* 手动备份与恢复 */}
          <div className="p-3 rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center gap-2 mb-3">
              <Save size={14} className="text-[var(--mint)]" />
              <span className="text-xs font-medium text-[var(--moon)]">{isEn ? 'Manual operations' : '手动操作'}</span>
            </div>

            {ghLastBackup && (
              <div className="mb-3 text-xs font-medium text-[var(--moon-dim)]">
                {isEn
                  ? `Last backup: ${ghLastBackup.repo} @ ${ghLastBackup.time}`
                  : `上次备份：${ghLastBackup.repo} · ${ghLastBackup.time}`}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  if (!cfg.tokenLabel || !cfg.repo) { addToast(isEn ? 'Configure the GitHub connection first' : '请先完成 GitHub 连接配置', 'warning'); return; }
                  if (!dataDir) { addToast(isEn ? 'Set data folder first' : '请先设置数据文件夹', 'warning'); return; }
                  const changeMarker = getVaultChangeMarker();
                  setGhBusy(true);
                  try {
                    // 先直接基于当前保险库生成一份加密备份（不依赖本地已有文件）
                    const { createBackup } = await import('@/lib/backupManager');
                    const made = await createBackup();
                    if (!made) { addToast(isEn ? 'Failed to build backup (unlocked?)' : '生成备份失败（请确认已解锁）', 'warning'); return; }
                    const { invoke } = await import('@tauri-apps/api/core');
                    const token = await invoke<string>('github_cred_get', { label: cfg.tokenLabel });
                    const msg = await invoke<string>('github_upload_backup', {
                      token,
                      repo: cfg.repo,
                      dataDir,
                      maxBackups: cfg.maxBackups,
                    });
                    const nextLastBackup = { repo: cfg.repo, time: new Date().toLocaleString() };
                    setGhLastBackup(nextLastBackup);
                    await persistGhIndex(ghTokens, nextLastBackup);
                    setLastGithubBackupAt(cfg.repo);
                    clearVaultChangeMarker(changeMarker);
                    addToast(msg, 'success');
                  } catch (e: any) {
                    addToast(isEn ? `Backup failed: ${String(e)}` : `备份失败：${String(e)}`, 'error');
                  } finally { setGhBusy(false); }
                }}
                disabled={ghBusy || !settings.githubAutoBackup.tokenLabel || !settings.githubAutoBackup.repo}
                className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Save size={13} /> {isEn ? 'Back up now' : '立即备份'}
              </button>
              <button
                onClick={async () => {
                  const cfg = useAppStore.getState().settings.githubAutoBackup;
                  if (!cfg.tokenLabel || !cfg.repo) { addToast(isEn ? 'Configure the GitHub connection first' : '请先完成 GitHub 连接配置', 'warning'); return; }
                  setGhBusy(true);
                  try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const token = await invoke<string>('github_cred_get', { label: cfg.tokenLabel });
                    const { open } = await import('@tauri-apps/plugin-dialog');
                    const res = await invoke<{ files: { filename: string; content: string }[] }>('github_download_backup', { token, repo: cfg.repo });
                    if (!res.files || res.files.length === 0) { addToast(isEn ? 'No backups found' : '仓库里没有备份', 'warning'); return; }
                    // 让用户选一个文件夹，把所有备份写进去
                    const dir = await open({ directory: true, title: isEn ? 'Select folder to save all backups' : '选择保存所有备份的文件夹' });
                    if (!dir || typeof dir !== 'string') { addToast(isEn ? 'Cancelled' : '已取消保存', 'info'); return; }
                    const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
                    const { join } = await import('@tauri-apps/api/path');
                    await mkdir(dir, { recursive: true });
                    let ok = 0;
                    for (const file of res.files) {
                      // Windows 文件名不允许冒号，落地时把 : 换成 -
                      const safeName = file.filename.replace(/:/g, '-');
                      const bin = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
                      await writeFile(await join(dir, safeName), bin);
                      ok++;
                    }
                    addToast((isEn ? `Saved ${ok} backups to ` : `已保存 ${ok} 个备份到 `) + dir, 'success');
                  } catch (e: any) {
                    addToast(isEn ? `Download failed: ${String(e)}` : `下载失败：${String(e)}`, 'error');
                  } finally { setGhBusy(false); }
                }}
                disabled={ghBusy || !settings.githubAutoBackup.tokenLabel || !settings.githubAutoBackup.repo}
                className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Github size={13} /> {isEn ? 'Download backups' : '下载备份'}
              </button>
            </div>
          </div>
        </>)}

      </div>

      {/* GitHub 备份使用教程弹窗 */}
      {ghHelp && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(8,8,16,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setGhHelp(false)}
        >
          <div
            className="rune-panel w-full max-w-md rounded-3xl p-6 max-h-[86vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--moon)]">{isEn ? 'GitHub Backup Guide' : 'GitHub 备份教程'}</h2>
              <button onClick={() => setGhHelp(false)} className="text-[var(--moon-dim)] hover:text-[var(--moon)] p-1.5 rounded-lg hover:bg-[rgba(210,210,220,0.08)]">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 text-[13px] text-[var(--moon-dim)] leading-relaxed">
              <section>
                <h3 className="text-sm font-semibold text-[var(--moon)] mb-2">{isEn ? 'Step 1 · Create a private repo' : '第一步 · 新建私有仓库'}</h3>
                <ol className="space-y-1.5 list-decimal pl-5">
                  <li>{isEn ? 'Open github.com and log in to your account.' : '打开 github.com 登录你的账号。'}</li>
                  <li>{isEn ? 'Click the "＋" at top-right → "New repository".' : '点右上角「＋」→「New repository（新建仓库）」。'}</li>
                  <li>{isEn ? 'Repository name: e.g. fallvault-backup (any name).' : '仓库名：例如 fallvault-backup（随便起）。'}</li>
                  <li>{isEn ? 'Visibility: choose **Private** (so only you can see the backup).' : '可见性：选 **Private（私有）**，只有你能看到备份。'}</li>
                  <li>{isEn ? 'Leave everything else default → click "Create repository".' : '其他都不用动 → 点「Create repository（创建仓库）」。'}</li>
                </ol>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-[var(--moon)] mb-2">{isEn ? 'Step 2 · Create a Personal Access Token (PAT)' : '第二步 · 获取个人访问令牌（PAT）'}</h3>
                <ol className="space-y-1.5 list-decimal pl-5">
                  <li>{isEn ? 'Click avatar (top-right) → Settings → Developer settings → Personal access tokens → "Fine-grained tokens" → "Generate new token".' : '点头像（右上角）→ Settings → Developer settings → Personal access tokens →「Fine-grained tokens」→「Generate new token」。'}</li>
                  <li>{isEn ? 'Token name: any (e.g. fallvault). Expiration: pick a date.' : 'Token name：随便填（如 fallvault）。Expiration：选个到期日。'}</li>
                  <li>{isEn ? 'Resource owner: select your account.' : 'Resource owner：选你自己的账号。'}</li>
                  <li>{isEn ? 'Repository access: "Only select repositories" → choose the backup repo you just created.' : 'Repository access：选「Only select repositories」→ 勾上刚才建的备份仓库。'}</li>
                  <li>{isEn ? 'Permissions → Repository permissions → Contents → set to "Read and write" (upload needs write).' : 'Permissions → Repository permissions → 找到 Contents → 设为「Read and write（读写）」（上传需要写权限）。'}</li>
                  <li>{isEn ? 'Click "Generate token", then copy the github_pat_xxx string immediately (shown only once!).' : '点「Generate token」，立刻复制那串 github_pat_xxx（只显示这一次！）。'}</li>
                </ol>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-[var(--moon)] mb-2">{isEn ? 'Step 3 · Use in FallVault' : '第三步 · 在 FallVault 里用'}</h3>
                <ol className="space-y-1.5 list-decimal pl-5">
                  <li>{isEn ? 'Under "GitHub connection", click "+ Add token", enter a name and paste the PAT, then save it. The token stays in Windows Credential Manager.' : '在「GitHub 连接配置」中点「+ 添加令牌」，输入名称并粘贴 PAT 后保存。令牌只存入 Windows 凭据管理器。'}</li>
                  <li>{isEn ? 'Select the saved token, list your repositories, then select the private backup repo. The selection is saved automatically and shared by auto and manual backups.' : '选择已保存令牌，点「获取我的仓库」，再选择私有备份仓库。选择后会自动保存，自动和手动备份共用此配置。'}</li>
                  <li>{isEn ? 'Set an interval and enable auto backup, or use "Back up now" and "Download backups" under Manual operations.' : '设置间隔后开启自动备份，或在「手动操作」中使用「立即备份」和「下载备份」。'}</li>
                </ol>
              </section>
            </div>
            <div className="mt-4 p-3 rounded-xl text-[11px] leading-relaxed" style={{ background: 'rgba(212,112,112,0.1)', color: '#D47070' }}>
              {isEn
                ? 'Your token is stored only in the Windows Credential Manager on this PC and is NEVER uploaded. The master password is also NEVER uploaded — only the already-encrypted .fvault file syncs.'
                : '令牌只存在本机的 Windows 凭据管理器里，绝不上传；主密码也绝不上传，同步的只是已经加密好的 .fvault 文件。'}
            </div>
          </div>
        </div>
      )}

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
                    ? 'Tip: .fvault backups are encrypted with your master (lock) password. Enter that password to restore.'
                    : '提示：.fvault 备份是用你的主密码（即软件锁定密码）加密的，请输入该密码来恢复。'}
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
