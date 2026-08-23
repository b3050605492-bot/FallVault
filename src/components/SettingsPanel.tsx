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
import { getDataDir } from '@/lib/backupManager';

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
  const [ghToken, setGhToken] = useState('');
  const [ghRepos, setGhRepos] = useState<{ full_name: string }[]>([]);
  const [ghRepo, setGhRepo] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghHelp, setGhHelp] = useState(false);
  const [ghTokens, setGhTokens] = useState<string[]>([]); // 已保存的令牌 label 列表（令牌本身在 Windows 凭据管理器）
  const [ghShowSave, setGhShowSave] = useState(false); // 保存令牌面板开关
  const [ghTokenOpen, setGhTokenOpen] = useState(false); // 已保存令牌下拉展开
  const [ghAutoOpen, setGhAutoOpen] = useState(false); // 自动备份配置面板
  const [ghAutoTokenLabel, setGhAutoTokenLabel] = useState(''); // 自动备份用的令牌 label
  const [ghAutoRepo, setGhAutoRepo] = useState(''); // 自动备份用的仓库
  const [ghSaveName, setGhSaveName] = useState(''); // 保存时的令牌名字
  const [ghSaveToken, setGhSaveToken] = useState(''); // 保存时的令牌值
  const [ghLastBackup, setGhLastBackup] = useState<{ repo: string; time: string } | null>(null);
  const [dataDir, setDataDir] = useState<string>('');
  const [capturing, setCapturing] = useState(false);

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

  // 用系统文件管理器打开文件夹（Rust 命令）
  const openFolder = async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder', { path });
    } catch (e) {
      console.error('open folder failed', e);
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
  }, []);
  // 持久化索引到本地（不含令牌本身）
  const persistGhIndex = async () => {
    const idx = JSON.stringify({ tokens: ghTokens, lastBackup: ghLastBackup });
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

          {/* GitHub 自动备份 */}
          <div className="mb-4 p-3 rounded-2xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--moon)]">{isEn ? 'Auto backup to GitHub' : 'GitHub 自动备份'}</span>
              <button
                onClick={() => {
                  const cur = useAppStore.getState().settings.githubAutoBackup;
                  useAppStore.getState().updateSettings({ githubAutoBackup: { ...cur, enabled: !cur.enabled } });
                }}
                className={`relative w-11 h-6 rounded-full transition-all ${useAppStore.getState().settings.githubAutoBackup.enabled ? 'bg-[var(--mint)]' : 'bg-[rgba(255,255,255,0.12)]'}`}
                title={isEn ? 'Toggle auto backup' : '开关自动备份'}
              >
                <span className={`absolute top-0.5 ${useAppStore.getState().settings.githubAutoBackup.enabled ? 'left-[22px]' : 'left-0.5'} w-5 h-5 rounded-full bg-white transition-all`} />
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-[var(--moon-faint)]">{isEn ? 'Interval' : '备份间隔'}</span>
              <select
                value={useAppStore.getState().settings.githubAutoBackup.intervalMin}
                onChange={(e) => {
                  const cur = useAppStore.getState().settings.githubAutoBackup;
                  useAppStore.getState().updateSettings({ githubAutoBackup: { ...cur, intervalMin: Number(e.target.value) } });
                }}
                className="rune-input flex-1 px-3 py-2 text-sm bg-transparent"
              >
                <option value={1} style={{ background: '#1A1A2E' }}>{isEn ? '1 minute (test)' : '1 分钟（测试）'}</option>
                <option value={720} style={{ background: '#1A1A2E' }}>{isEn ? '12 hours' : '12 小时'}</option>
                <option value={1440} style={{ background: '#1A1A2E' }}>{isEn ? '24 hours' : '24 小时'}</option>
                <option value={2880} style={{ background: '#1A1A2E' }}>{isEn ? '48 hours' : '48 小时'}</option>
                <option value={5760} style={{ background: '#1A1A2E' }}>{isEn ? '96 hours' : '96 小时'}</option>
              </select>
            </div>
            <button
              onClick={() => setGhAutoOpen((v) => !v)}
              className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all mb-2"
            >
              {isEn ? 'Configure token & repo' : '配置令牌与仓库'}
            </button>
            {(() => {
              const cfg = useAppStore.getState().settings.githubAutoBackup;
              return cfg.repo
                ? <div className="text-[11px] text-[var(--moon-dim)] mb-1">{isEn ? `Target repo: ${cfg.repo}` : `目标仓库：${cfg.repo}`}</div>
                : <div className="text-[11px] text-[var(--moon-faint)] mb-1">{isEn ? 'Not configured yet' : '尚未配置仓库'}</div>;
            })()}
            {ghAutoOpen && (
              <div className="mt-2 p-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] space-y-2">
                {/* 选已保存令牌 */}
                <div>
                  <label className="text-[11px] text-[var(--moon-faint)] mb-1 block">{isEn ? 'Token (pick a saved one)' : '令牌（选一个已保存的）'}</label>
                  {ghTokens.length === 0 ? (
                    <div className="text-[11px] text-[var(--moon-faint)]">{isEn ? 'Save a token first via "+ Save token" above' : '请先点上方「+ 保存令牌」保存一个令牌'}</div>
                  ) : (
                    <select
                      value={ghAutoTokenLabel}
                      onChange={(e) => setGhAutoTokenLabel(e.target.value)}
                      className="rune-input w-full px-3 py-2 text-sm bg-transparent"
                    >
                      <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '— select token —' : '— 选择令牌 —'}</option>
                      {ghTokens.map((t) => <option key={t} value={t} style={{ background: '#1A1A2E' }}>{t}</option>)}
                    </select>
                  )}
                </div>
                {/* 获取仓库 */}
                <button
                  onClick={async () => {
                    if (!ghAutoTokenLabel) { addToast(isEn ? 'Pick a token first' : '请先选令牌', 'warning'); return; }
                    try {
                      const { invoke } = await import('@tauri-apps/api/core');
                      const tok = await invoke<string>('github_cred_get', { label: ghAutoTokenLabel });
                      const repos = await invoke<{ full_name: string }[]>('github_list_repos', { token: tok });
                      setGhRepos(repos);
                      addToast(isEn ? `Found ${repos.length} repos` : `找到 ${repos.length} 个仓库`, 'success');
                    } catch (e: any) { addToast(isEn ? `Failed: ${String(e)}` : `失败：${String(e)}`, 'error'); }
                  }}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.1)] text-[var(--moon-dim)] hover:bg-[rgba(210,210,220,0.18)] transition-all"
                >
                  {isEn ? 'List my repositories' : '获取我的仓库'}
                </button>
                {ghRepos.length > 0 && (
                  <select
                    value={ghAutoRepo}
                    onChange={(e) => setGhAutoRepo(e.target.value)}
                    className="rune-input w-full px-3 py-2 text-sm bg-transparent"
                  >
                    <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '— choose repo —' : '— 请选择仓库 —'}</option>
                    {ghRepos.map((r) => <option key={r.full_name} value={r.full_name} style={{ background: '#1A1A2E' }}>{r.full_name}</option>)}
                  </select>
                )}
                {ghAutoRepo && (
                  <div className="text-[11px] text-[var(--mint)]">{isEn ? `Selected: ${ghAutoRepo}` : `已选仓库：${ghAutoRepo}`}</div>
                )}
                <button
                  onClick={() => {
                    if (!ghAutoTokenLabel || !ghAutoRepo) { addToast(isEn ? 'Pick token and repo' : '请选令牌和仓库', 'warning'); return; }
                    const cur = useAppStore.getState().settings.githubAutoBackup;
                    useAppStore.getState().updateSettings({ githubAutoBackup: { ...cur, tokenLabel: ghAutoTokenLabel, repo: ghAutoRepo } });
                    setGhAutoOpen(false);
                    addToast(isEn ? 'Auto backup configured' : '已配置自动备份', 'success');
                  }}
                  className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(125,211,192,0.15)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.25)] transition-all"
                >
                  {isEn ? 'Save config' : '保存配置'}
                </button>
              </div>
            )}
          </div>

          {/* 已保存令牌：仅在下拉里显示，点开才列出（每条带 × 删除） */}
          <label className="text-xs text-[var(--moon-faint)] mb-1.5 block">{isEn ? 'GitHub Token (PAT)' : 'GitHub 令牌（PAT）'}</label>
          <input
            type="password"
            value={ghToken}
            onChange={(e) => setGhToken(e.target.value)}
            placeholder={isEn ? 'ghp_xxx or github_pat_xxx' : 'ghp_xxx 或 github_pat_xxx'}
            className="rune-input w-full px-3 py-2.5 text-sm bg-transparent mb-2"
          />
          {ghTokens.length > 0 && (
            <div className="relative mb-2">
              <button
                onClick={() => setGhTokenOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-xs text-[var(--moon-dim)] hover:border-[rgba(255,255,255,0.15)] transition-all"
              >
                <span>{isEn ? 'Saved tokens' : '已保存的令牌'}</span>
                <span className="text-[var(--moon-faint)]">{ghTokenOpen ? '▲' : '▼'}</span>
              </button>
              {ghTokenOpen && (
                <div className="absolute z-20 left-0 right-0 mt-1 p-1.5 rounded-xl bg-[#16162a] border border-[rgba(255,255,255,0.1)] shadow-xl space-y-1 max-h-52 overflow-auto">
                  {ghTokens.map((t) => (
                    <div
                      key={t}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
                    >
                      <button
                        onClick={async () => {
                          try {
                            const { invoke } = await import('@tauri-apps/api/core');
                            const tok = await invoke<string>('github_cred_get', { label: t });
                            setGhToken(tok);
                            setGhTokenOpen(false);
                            addToast(isEn ? `Loaded token "${t}"` : `已载入令牌「${t}」`, 'success');
                          } catch (err: any) {
                            addToast(isEn ? `Load failed: ${String(err)}` : `载入失败：${String(err)}`, 'error');
                          }
                        }}
                        className="flex-1 text-left text-sm text-[var(--moon-dim)] truncate hover:text-[var(--moon)]"
                        title={t}
                      >
                        {t}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const { invoke } = await import('@tauri-apps/api/core');
                            await invoke('github_cred_delete', { label: t });
                            setGhTokens((prev) => prev.filter((x) => x !== t));
                            await persistGhIndex();
                            addToast(isEn ? `Deleted token "${t}"` : `已删除令牌「${t}」`, 'info');
                          } catch (err: any) {
                            addToast(isEn ? `Delete failed: ${String(err)}` : `删除失败：${String(err)}`, 'error');
                          }
                        }}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-[var(--moon-faint)] hover:text-[var(--danger)] hover:bg-[rgba(255,90,90,0.12)] transition-all"
                        title={isEn ? 'Delete this token' : '删除该令牌'}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 保存令牌：点开一个小面板，输入名字+令牌后保存 */}
          <div className="mb-3">
            <button
              onClick={() => { setGhShowSave((v) => !v); setGhSaveName(''); setGhSaveToken(''); }}
              className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all"
            >
              {isEn ? '+ Save token' : '+ 保存令牌'}
            </button>
            {ghShowSave && (
              <div className="mt-2 p-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] space-y-2">
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
                      setGhTokens((prev) => (prev.includes(label) ? prev : [...prev, label]));
                      await persistGhIndex();
                      setGhToken(ghSaveToken.trim());
                      setGhSaveName(''); setGhSaveToken(''); setGhShowSave(false);
                      addToast(isEn ? `Saved token "${label}"` : `已保存令牌「${label}」（存于系统凭据管理器）`, 'success');
                    } catch (err: any) {
                      addToast(isEn ? `Save failed: ${String(err)}` : `保存失败：${String(err)}`, 'error');
                    }
                  }}
                  className="w-full text-xs px-3 py-2.5 rounded-xl bg-[rgba(125,211,192,0.15)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.25)] transition-all"
                >
                  {isEn ? 'Save' : '保存'}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={async () => {
              if (!ghToken.trim()) { addToast(isEn ? 'Enter a token first' : '请先填写令牌', 'warning'); return; }
              setGhBusy(true);
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const repos = await invoke<{ full_name: string }[]>('github_list_repos', { token: ghToken.trim() });
                setGhRepos(repos);
                addToast(isEn ? `Found ${repos.length} repos` : `找到 ${repos.length} 个仓库`, 'success');
              } catch (e: any) {
                addToast(isEn ? `Failed: ${String(e)}` : `失败：${String(e)}`, 'error');
              } finally { setGhBusy(false); }
            }}
            disabled={ghBusy}
            className="w-full text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all disabled:opacity-50 mb-3"
          >
            {ghBusy ? (isEn ? 'Loading…' : '获取中…') : (isEn ? 'List my repositories' : '获取我的仓库')}
          </button>

          {ghRepos.length > 0 && (
            <div className="mb-3">
              <label className="text-xs text-[var(--moon-faint)] mb-1.5 block">{isEn ? 'Select repository' : '选择仓库'}</label>
              <select
                value={ghRepo}
                onChange={(e) => setGhRepo(e.target.value)}
                className="rune-input w-full px-3 py-2.5 text-sm bg-transparent"
              >
                <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '— choose —' : '— 请选择 —'}</option>
                {ghRepos.map((r) => <option key={r.full_name} value={r.full_name} style={{ background: '#1A1A2E' }}>{r.full_name}</option>)}
              </select>
            </div>
          )}

          {/* 上次备份时间 */}
          {ghLastBackup && (
            <div className="mb-3 text-[11px] text-[var(--moon-faint)]">
              {isEn
                ? `Last backup: ${ghLastBackup.repo} @ ${ghLastBackup.time}`
                : `上次备份：${ghLastBackup.repo} · ${ghLastBackup.time}`}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!ghToken.trim() || !ghRepo) { addToast(isEn ? 'Token and repo required' : '请先填令牌并选仓库', 'warning'); return; }
                if (!dataDir) { addToast(isEn ? 'Set data folder first' : '请先设置数据文件夹', 'warning'); return; }
                setGhBusy(true);
                try {
                  // 先直接基于当前保险库生成一份加密备份（不依赖本地已有文件）
                  const { createBackup } = await import('@/lib/backupManager');
                  const made = await createBackup();
                  if (!made) { addToast(isEn ? 'Failed to build backup (unlocked?)' : '生成备份失败（请确认已解锁）', 'warning'); setGhBusy(false); return; }
                  const { invoke } = await import('@tauri-apps/api/core');
                  const msg = await invoke<string>('github_upload_backup', { token: ghToken.trim(), repo: ghRepo, dataDir });
                  setGhLastBackup({ repo: ghRepo, time: new Date().toLocaleString() });
                  await persistGhIndex();
                  addToast(msg, 'success');
                } catch (e: any) {
                  addToast(isEn ? `Backup failed: ${String(e)}` : `备份失败：${String(e)}`, 'error');
                } finally { setGhBusy(false); }
              }}
              disabled={ghBusy}
              className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Save size={13} /> {isEn ? 'Backup to repo' : '备份文件'}
            </button>
            <button
              onClick={async () => {
                if (!ghToken.trim() || !ghRepo) { addToast(isEn ? 'Token and repo required' : '请先填令牌并选仓库', 'warning'); return; }
                setGhBusy(true);
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const { open } = await import('@tauri-apps/plugin-dialog');
                  const res = await invoke<{ files: { filename: string; content: string }[] }>('github_download_backup', { token: ghToken.trim(), repo: ghRepo });
                  if (!res.files || res.files.length === 0) { addToast(isEn ? 'No backups found' : '仓库里没有备份', 'warning'); setGhBusy(false); return; }
                  // 让用户选一个文件夹，把所有备份写进去
                  const dir = await open({ directory: true, title: isEn ? 'Select folder to save all backups' : '选择保存所有备份的文件夹' });
                  if (!dir || typeof dir !== 'string') { addToast(isEn ? 'Cancelled' : '已取消保存', 'info'); setGhBusy(false); return; }
                  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
                  const { join } = await import('@tauri-apps/api/path');
                  await mkdir(dir, { recursive: true });
                  let ok = 0;
                  for (const f of res.files) {
                    // Windows 文件名不允许冒号，落地时把 : 换成 -
                    const safeName = f.filename.replace(/:/g, '-');
                    const bin = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
                    await writeFile(await join(dir, safeName), bin);
                    ok++;
                  }
                  addToast((isEn ? `Saved ${ok} backups to ` : `已保存 ${ok} 个备份到 `) + dir, 'success');
                } catch (e: any) {
                  addToast(isEn ? `Download failed: ${String(e)}` : `下载失败：${String(e)}`, 'error');
                } finally { setGhBusy(false); }
              }}
              disabled={ghBusy}
              className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Github size={13} /> {isEn ? 'Download' : '下载备份'}
            </button>
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
                  <li>{isEn ? 'Click "+ Save token", enter a name + paste the token, then "Save" (stored in Windows Credential Manager, not uploaded). Pick a saved token from the dropdown above to autofill.' : '点「+ 保存令牌」，输入名字并把令牌粘贴进去，再点「保存」（存在 Windows 凭据管理器，不会上传）。上方下拉选已保存令牌可自动填充。'}</li>
                  <li>{isEn ? 'Click "List my repositories", then pick your private repo from the dropdown.' : '点「获取我的仓库」，在下拉里选你的私有仓库。'}</li>
                  <li>{isEn ? 'Click "Backup to repo" to create an encrypted .fvault from your current vault and push it (timestamped filename). "Download" pulls the latest one back.' : '点「备份文件」会基于当前保险库直接生成加密 .fvault 并上传（文件名带时间）；「下载备份」拉回最新一份。'}</li>
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