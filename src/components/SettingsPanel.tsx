import { useAppStore } from '@/stores/appStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { X, Palette, Languages, GlassWater, Waves, Sparkles, ImagePlus, Film, FolderOpen, FolderCog, RotateCcw, ShieldCheck, Lock } from 'lucide-react';
import { changeMasterPassword, lockVault } from '@/lib/crypto';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { copyFile, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { getBackgroundsDir } from '@/lib/mediaPaths';
import { useToastStore } from '@/stores/toastStore';
import { useState } from 'react';
import { detectWallpaperFolder, VIDEO_EXTS } from '@/lib/wallpaper';

export function SettingsPanel() {
  const { settings, updateSettings, setIsSettingsOpen } = useAppStore();
  const { addToast } = useToastStore();
  const t = (k: LangKey) => translate(settings.language, k);
  const isEn = settings.language === 'en';
  const [uploading, setUploading] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  const setBackground = (type: 'linewaves' | 'particles') => {
    updateSettings({ background: { ...settings.background, type } });
  };

  // 导入 Wallpaper Engine 壁纸文件夹（自动识别主媒体文件）
  const handleImportFolder = async () => {
    try {
      const folder = await open({
        multiple: false,
        directory: true,
      });
      if (!folder || typeof folder !== 'string') return;

      setUploading(true);
      const fsAdapter = {
        readDir: async (path: string) => {
          const entries: any[] = await readDir(path);
          return entries.map((e) => ({ name: e.name, isDir: !!e.isDirectory }));
        },
        readTextFile,
      };
      const meta = await detectWallpaperFolder(folder, fsAdapter);
      if (!meta) {
        addToast(isEn ? 'No video/image found in this folder' : '该文件夹没有找到可用的视频或图片', 'warning');
        return;
      }

      // 引用原路径（不复制大视频，加载更快）
      const ext = meta.file.split('.').pop()?.toLowerCase() || '';
      const type = VIDEO_EXTS.includes(`.${ext}`) ? 'video' : 'image';
      updateSettings({
        background: {
          ...settings.background,
          type,
          source: meta.file,
          darkOverlay: type === 'video' ? 0 : settings.background.darkOverlay,
        },
      });
      addToast(
        isEn
          ? `Imported: ${meta.file.split(/[\\/]/).pop()} (${type === 'video' ? 'video' : 'image'})`
          : `已导入: ${meta.file.split(/[\\/]/).pop()} (${type === 'video' ? '视频' : '图片'})`,
        'success'
      );
    } catch (e) {
      console.error('Import folder failed:', e);
      addToast(isEn ? 'Import failed' : '导入失败', 'error');
    } finally {
      setUploading(false);
    }
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

  // 选择自定义数据目录
  const handlePickDataPath = async () => {
    try {
      const dir = await open({ multiple: false, directory: true });
      if (!dir || typeof dir !== 'string') return;
      updateSettings({ dataPath: dir });
      addToast(isEn ? 'Data folder updated' : '数据文件夹已更新', 'success');
    } catch (e) {
      console.error('Pick data path failed:', e);
      addToast(isEn ? 'Failed to update data folder' : '数据文件夹更新失败', 'error');
    }
  };

  // 恢复默认数据目录
  const handleResetDataPath = async () => {
    updateSettings({ dataPath: '' });
    addToast(isEn ? 'Data folder reset to default' : '已恢复默认数据文件夹', 'success');
  };

  const handleUpload = async (mediaType: 'image' | 'video') => {
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

      updateSettings({ background: { ...settings.background, type: mediaType, source: destPath } });
      addToast(isEn ? 'Background saved' : '背景已保存', 'success');
    } catch (e) {
      console.error('Upload bg failed:', e);
      addToast(isEn ? 'Upload failed' : '上传失败，请重试', 'error');
    } finally {
      setUploading(false);
    }
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
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-[var(--moon)]">{t('settings')}</h2>
          <button onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.08)] transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
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

            {/* 三个预设背景 */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setBackground('linewaves')}
                className={`rounded-xl p-3 border transition-all text-left ${
                  settings.background.type === 'linewaves'
                    ? 'border-transparent shadow-[0_0_20px_rgba(210,210,220,0.15)]'
                    : 'border-[rgba(192,200,216,0.1)] hover:border-[rgba(192,200,216,0.25)]'
                }`}
                style={{
                  background: settings.background.type === 'linewaves'
                    ? 'linear-gradient(135deg, rgba(210,210,220,0.12), rgba(210,210,220,0.04))'
                    : 'rgba(18,18,30,0.5)',
                }}>
                <Waves size={18} style={{ color: 'var(--mint)' }} />
                <div className="text-xs font-medium text-[var(--moon)] mt-2">
                  {isEn ? 'Line Waves' : '线浪'}
                </div>
                <div className="text-[10px] text-[var(--moon-faint)] mt-0.5">
                  {isEn ? 'Flowing lines' : '流动线条'}
                </div>
              </button>
              <button
                onClick={() => setBackground('particles')}
                className={`rounded-xl p-3 border transition-all text-left ${
                  settings.background.type === 'particles'
                    ? 'border-transparent shadow-[0_0_20px_rgba(210,210,220,0.15)]'
                    : 'border-[rgba(192,200,216,0.1)] hover:border-[rgba(192,200,216,0.25)]'
                }`}
                style={{
                  background: settings.background.type === 'particles'
                    ? 'linear-gradient(135deg, rgba(210,210,220,0.12), rgba(210,210,220,0.04))'
                    : 'rgba(18,18,30,0.5)',
                }}>
                <Sparkles size={18} style={{ color: 'var(--mint)' }} />
                <div className="text-xs font-medium text-[var(--moon)] mt-2">
                  {isEn ? 'Particles' : '粒子'}
                </div>
                <div className="text-[10px] text-[var(--moon-faint)] mt-0.5">
                  {isEn ? 'Floating dots' : '漂浮粒子'}
                </div>
              </button>

              {/* 自定义上传（图片/视频） */}
              <div
                className={`rounded-xl p-3 border transition-all ${
                  settings.background.type === 'image' || settings.background.type === 'video'
                    ? 'border-transparent shadow-[0_0_20px_rgba(210,210,220,0.15)]'
                    : 'border-[rgba(192,200,216,0.1)] hover:border-[rgba(192,200,216,0.25)]'
                }`}
                style={{
                  background: settings.background.type === 'image' || settings.background.type === 'video'
                    ? 'linear-gradient(135deg, rgba(210,210,220,0.12), rgba(210,210,220,0.04))'
                    : 'rgba(18,18,30,0.5)',
                }}>
                <ImagePlus size={18} style={{ color: 'var(--mint)' }} />
                <div className="text-xs font-medium text-[var(--moon)] mt-2">
                  {isEn ? 'Custom' : '自定义'}
                </div>
                <div className="text-[10px] text-[var(--moon-faint)] mt-0.5">
                  {isEn ? 'Upload image or video' : '上传图片或视频'}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={() => handleUpload('image')}
                    disabled={uploading}
                    className="flex-1 text-[10px] px-2 py-1 rounded-lg bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all disabled:opacity-40 flex items-center justify-center gap-1"
                    title={isEn ? 'Upload image' : '上传图片'}>
                    <ImagePlus size={10} /> {isEn ? 'Image' : '图片'}
                  </button>
                  <button
                    onClick={() => handleUpload('video')}
                    disabled={uploading}
                    className="flex-1 text-[10px] px-2 py-1 rounded-lg bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all disabled:opacity-40 flex items-center justify-center gap-1"
                    title={isEn ? 'Upload video' : '上传视频'}>
                    <Film size={10} /> {isEn ? 'Video' : '视频'}
                  </button>
                </div>
              </div>
            </div>

            {/* 导入 Wallpaper Engine 壁纸文件夹 - 独立卡片 */}
            <div
              className={`mt-3 rounded-xl border transition-all overflow-hidden ${
                settings.background.type === 'image' || settings.background.type === 'video'
                  ? 'border-transparent shadow-[0_0_20px_rgba(155,141,181,0.15)]'
                  : 'border-[rgba(155,141,181,0.2)] hover:border-[rgba(155,141,181,0.4)]'
              }`}
              style={{
                background: settings.background.type === 'image' || settings.background.type === 'video'
                  ? 'linear-gradient(135deg, rgba(155,141,181,0.14), rgba(155,141,181,0.05))'
                  : 'rgba(18,18,30,0.5)',
              }}
            >
              <button
                onClick={handleImportFolder}
                disabled={uploading}
                className="w-full flex items-center gap-3 p-3.5 text-left transition-all hover:bg-[rgba(155,141,181,0.08)] disabled:opacity-50"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(155, 141, 181, 0.15)' }}
                >
                  {uploading ? (
                    <span className="w-4 h-4 border-2 border-[var(--amethyst)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <FolderOpen size={18} style={{ color: 'var(--amethyst)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--moon)]">
                    {isEn ? 'Import Wallpaper Folder' : '导入壁纸文件夹'}
                  </div>
                  <div className="text-[11px] text-[var(--moon-faint)] mt-0.5 truncate">
                    {isEn
                      ? 'Wallpaper Engine: pick a wallpaper folder'
                      : 'Wallpaper Engine：选择壁纸文件夹，自动识别视频/图片'}
                  </div>
                  {settings.background.name && (settings.background.type === 'image' || settings.background.type === 'video') && (
                    <div className="text-[11px] text-[var(--amethyst)] mt-1 truncate flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] flex-shrink-0" />
                      {isEn ? 'Current: ' : '当前：'}
                      {settings.background.name}
                    </div>
                  )}
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(155, 141, 181, 0.15)', color: 'var(--amethyst)' }}>
                  {isEn ? 'Import' : '导入'}
                </span>
              </button>
            </div>
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
                ? 'Icons and backgrounds are stored here (icons/ and backgrounds/ subfolders)'
                : '图标和背景统一存放在此文件夹（内含 icons/ 与 backgrounds/ 子目录）'}
            </p>
            <div
              className="rounded-xl px-3 py-2.5 text-[11px] font-mono truncate mb-2.5 border"
              style={{
                background: 'rgba(18,18,30,0.4)',
                borderColor: 'rgba(192,200,216,0.1)',
                color: 'var(--moon-dim)',
              }}
              title={settings.dataPath || (isEn ? 'Default (AppData/media)' : '默认（AppData/media）')}
            >
              {settings.dataPath || (isEn ? 'Default location' : '默认位置')}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePickDataPath}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(210,210,220,0.12)] text-[var(--mint)] hover:bg-[rgba(210,210,220,0.2)] transition-all flex items-center justify-center gap-1.5"
              >
                <FolderOpen size={13} /> {isEn ? 'Choose folder' : '选择文件夹'}
              </button>
              <button
                onClick={handleResetDataPath}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all flex items-center justify-center gap-1.5"
              >
                <RotateCcw size={13} /> {isEn ? 'Reset' : '恢复默认'}
              </button>
            </div>
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
          </div>
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
    </div>
  );
}