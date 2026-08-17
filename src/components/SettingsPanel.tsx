import { useAppStore } from '@/stores/appStore';
import { THEMES } from '@/types';
import { translate, LangKey } from '@/lib/i18n';
import { X, Palette, Languages, GlassWater, Waves, Sparkles, ImagePlus, Film, FolderOpen, FolderCog, RotateCcw, Puzzle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { copyFile, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { getBackgroundsDir } from '@/lib/mediaPaths';
import { useToastStore } from '@/stores/toastStore';
import { useState, useEffect } from 'react';
import { detectWallpaperFolder, VIDEO_EXTS } from '@/lib/wallpaper';

export function SettingsPanel() {
  const { settings, updateSettings, setIsSettingsOpen } = useAppStore();
  const { addToast } = useToastStore();
  const t = (k: LangKey) => translate(settings.language, k);
  const isEn = settings.language === 'en';
  const [uploading, setUploading] = useState(false);
  const [bridgeCode, setBridgeCode] = useState('');
  const [bridgeLoading, setBridgeLoading] = useState(false);

  // 加载浏览器扩展配对码
  const loadBridgeCode = async () => {
    setBridgeLoading(true);
    try {
      const code = await invoke<string>('get_bridge_token_command');
      setBridgeCode(code || '');
    } catch (e) {
      console.error('load bridge code failed', e);
      setBridgeCode('');
    } finally {
      setBridgeLoading(false);
    }
  };

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
          source: meta.fullPath,
          name: meta.title || meta.file,
        },
      });
      addToast(
        isEn
          ? `Imported: ${meta.file} (${type === 'video' ? 'video' : 'image'})`
          : `已导入：${meta.file}（${type === 'video' ? '视频' : '图片'}）`,
        'success'
      );
    } catch (e) {
      console.error('Import folder failed:', e);
      addToast(isEn ? 'Import failed' : '导入失败，请重试', 'error');
    } finally {
      setUploading(false);
    }
  };

  // 上传单个图片/视频文件
// 选择自定义数据目录
// 打开面板时加载配对码
  useEffect(() => {
    loadBridgeCode();
  }, []);

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

          {/* 浏览器扩展配对 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Puzzle size={15} style={{ color: 'var(--mint)' }} />
              <h3 className="text-sm font-semibold text-[var(--moon)]">
                {isEn ? 'Browser Extension' : '浏览器扩展'}
              </h3>
            </div>
            <p className="text-[11px] text-[var(--moon-faint)] mb-2">
              {isEn
                ? 'Install the FallVault extension in your browser, then enter this code to pair'
                : '在浏览器安装 FallVault 扩展后，输入下方配对码即可连接自动填充'}
            </p>
            <div
              className="rounded-xl px-4 py-3 text-lg font-mono tracking-widest text-center mb-2 border select-all cursor-pointer"
              style={{
                background: 'rgba(18,18,30,0.4)',
                borderColor: 'rgba(125,211,192,0.3)',
                color: 'var(--mint)',
              }}
              onClick={() => {
                if (bridgeCode) {
                  navigator.clipboard.writeText(bridgeCode).then(() =>
                    addToast(isEn ? 'Pairing code copied' : '配对码已复制', 'success')
                  );
                }
              }}
              title={isEn ? 'Click to copy' : '点击复制'}
            >
              {bridgeLoading ? '...' : (bridgeCode || (isEn ? 'Not loaded' : '未加载'))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadBridgeCode}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(125,211,192,0.12)] text-[var(--mint)] hover:bg-[rgba(125,211,192,0.2)] transition-all flex items-center justify-center gap-1.5"
                disabled={bridgeLoading}
              >
                <RotateCcw size={13} /> {isEn ? 'Refresh' : '刷新配对码'}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(bridgeCode || '').then(() =>
                  addToast(isEn ? 'Pairing code copied' : '配对码已复制', 'success')
                )}
                disabled={!bridgeCode}
                className="flex-1 text-xs px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)] hover:bg-[rgba(192,200,216,0.15)] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Puzzle size={13} /> {isEn ? 'Copy' : '复制'}
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
        </div>
      </div>
    </div>
  );
}