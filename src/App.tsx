import { useEffect, useState } from 'react';
import { useDatabase } from '@/hooks/useDatabase';
import { setTotpOffset } from '@/lib/totp';
import { Background } from '@/components/Background';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { EntryList } from '@/components/EntryList';
import { EntryModal } from '@/components/EntryModal';
import { EntryDetail } from '@/components/EntryDetail';
import { Toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsPanel } from '@/components/SettingsPanel';
import { PasswordGenerator } from '@/components/PasswordGenerator';
import { SecurityAuditModal } from '@/components/SecurityAuditModal';
import { TotpMigrationModal } from '@/components/TotpMigrationModal';
import { TitleBar } from '@/components/TitleBar';
import { setAutofillHotkey, setAutofillOptions } from '@/lib/autofill';
import { LockScreen } from '@/components/LockScreen';
import { ImportModal } from '@/components/ImportModal';
import { useAppStore } from '@/stores/appStore';
import { THEMES, applyTheme } from '@/types';
import { lockVault, setUnlockGraceConfig, isUnlockGraceValid, hasGraceSession } from '@/lib/crypto';
import { setQuickOpenHotkey } from '@/lib/quickOpen';
import { stopAutoBackup, startGithubAutoBackup, stopGithubAutoBackup } from '@/lib/backupManager';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mkdirAll } from '@/lib/rustFs';

function App() {
  useDatabase();
  const { isEntryModalOpen, isSettingsOpen, isPasswordGeneratorOpen, isSecurityAuditOpen, isTotpMigrationOpen, isDetailOpen, settings } = useAppStore();
  const [locked, setLocked] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  // 启动时应用主题 + 毛玻璃透明度
  useEffect(() => {
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    applyTheme(theme);
    const alpha = settings.glassOpacity;
    document.documentElement.style.setProperty('--glass-opacity', String(alpha));
    const glassAlpha = 0.12 + ((alpha - 0.2) / 0.75) * 0.6;
    document.documentElement.style.setProperty('--glass-alpha', Math.min(0.75, Math.max(0.1, glassAlpha)).toFixed(2));
    document.documentElement.style.setProperty('data-theme', theme.id);
  }, []);

  // TOTP 时间偏移校正：启动注入 + 设置变更时实时更新
  useEffect(() => {
    setTotpOffset(settings.totpOffsetSec || 0);
  }, [settings.totpOffsetSec]);

  // 启动时等待 LockScreen 初始化（内部检测是否有主密码）
  // locked 初始 true → 显示解锁屏；解锁后 false 显示主界面

  // 监听设置面板 / Rust 端发出的"锁定"事件（关闭到托盘）——先 checkpoint 落盘 WAL，再清空内存密钥
  // 注意：必须用 Tauri 的 listen() 接收 Rust app.emit 的事件（window.addEventListener 收不到 Tauri 事件总线）
  useEffect(() => {
    const handler = () => {
      import('@/lib/db').then((m) => m.checkpointDatabase()).catch(() => {});
      lockVault().then(() => setLocked(true)).catch(() => setLocked(true));
    };
    const un = listen('fallvault:lock', handler);
    return () => { un.then((fn) => fn()).catch(() => {}); };
  }, []);

  // 恢复备份后 reload：重置锁定状态，让 LockScreen 重新检测是否已有主密码
  useEffect(() => {
    const un = listen('fallvault:reload', () => setLocked(true));
    return () => { un.then((fn) => fn()).catch(() => {}); };
  }, []);

  // 监听打开导入弹窗事件
  useEffect(() => {
    const un = listen('fallvault:open-import', () => setImportOpen(true));
    return () => { un.then((fn) => fn()).catch(() => {}); };
  }, []);

  // 启动半自动填充：把当前设置的热键 + 选项推给 Rust 端监听
  useEffect(() => {
    const s = useAppStore.getState().settings;
    setAutofillHotkey(s.autofillHotkey || 'Ins').catch(() => {});
    setAutofillOptions(s.autofillResetAfterUse || false).catch(() => {});
  }, []);

  // 启动快速打开：注册全局快捷键（软件在跑时一键唤起窗口）
  useEffect(() => {
    const s = useAppStore.getState().settings;
    setQuickOpenHotkey(s.quickOpenHotkey || '').catch(() => {});
  }, []);

  // 快速打开热键变更时实时重新注册
  useEffect(() => {
    setQuickOpenHotkey(settings.quickOpenHotkey || '').catch(() => {});
  }, [settings.quickOpenHotkey]);

  // 半自动填充选项（填充后是否重置）变更时实时同步
  useEffect(() => {
    setAutofillOptions(settings.autofillResetAfterUse || false).catch(() => {});
  }, [settings.autofillResetAfterUse]);

  // 首次安装（无已保存设置）时，自动把数据文件夹默认指向 exe 同级 data/ 并建好目录，开箱即用
  useEffect(() => {
    const initDefaultDataDir = async () => {
      try {
        if (localStorage.getItem('fallvault-settings')) return; // 已有设置则不动
        if (useAppStore.getState().settings.dataDir?.trim()) return;
        const exe = (await invoke('get_exe_dir')) as string;
        const dir = `${exe}\\data`;
        await mkdirAll(dir);
        useAppStore.getState().updateSettings({ dataDir: dir });
      } catch { /* 忽略：用户仍可在设置里手动选择 */ }
    };
    initDefaultDataDir();
  }, []);

  // 解锁宽限（免验证时长）配置同步：设置变更时推给 crypto 模块 + Rust 端（Rust 端据此决定是否在关/最小化到托盘时强制重锁）
  useEffect(() => {
    setUnlockGraceConfig(settings.unlockGraceEnabled, settings.unlockGraceMin);
    invoke('set_grace_enabled', { enabled: settings.unlockGraceEnabled }).catch(() => {});
  }, [settings.unlockGraceEnabled, settings.unlockGraceMin]);

  // 窗口重新聚焦 / 从托盘唤起时，若处于免验证有效期内则直接保持解锁（不要求重输）
  // 同时：若宽限已过期且仍停留在主界面，则自动回到锁定态（仅当曾开启过宽限）
  useEffect(() => {
    const iv = setInterval(() => {
      if (hasGraceSession()) {
        // 存在宽限会话：有效期内保持解锁，过期则回到锁定态
        setLocked((prev) => (isUnlockGraceValid() ? (prev ? false : prev) : (prev ? prev : true)));
      }
      // 未开启宽限：不干预（保持原有锁定逻辑）
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // GitHub 自动备份调度器：放在 App 层（始终存活），不受设置面板开关影响
  useEffect(() => {
    const cfg = settings.githubAutoBackup;
    if (cfg.enabled && cfg.repo && cfg.tokenLabel) {
      const stop = startGithubAutoBackup(cfg.intervalMin);
      return () => stop();
    }
    stopGithubAutoBackup();
    return undefined;
  }, [settings.githubAutoBackup.enabled, settings.githubAutoBackup.intervalMin, settings.githubAutoBackup.repo, settings.githubAutoBackup.tokenLabel]);

  // 解锁后刷新数据（分类/标签/账号）
  const handleUnlocked = () => {
    setLocked(false);
    useAppStore.getState().refreshAll();
  };

  const handleLock = async () => {
    await lockVault();
    setLocked(true);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Background />

      {locked ? (
        <LockScreen onUnlocked={handleUnlocked} />
      ) : (
        <div className="relative z-10 flex flex-col w-full h-full">
          <TitleBar onLock={handleLock} />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden">
              <TopBar />
              <div className="flex-1 overflow-y-auto p-4">
                <EntryList />
              </div>
            </main>
          </div>
        </div>
      )}

      {/* 全局弹窗层（仅解锁后显示） */}
      {!locked && isDetailOpen && <EntryDetail />}
      {!locked && isEntryModalOpen && <EntryModal />}
      {!locked && isSettingsOpen && <SettingsPanel />}
      {!locked && isPasswordGeneratorOpen && <PasswordGenerator />}
      {!locked && isSecurityAuditOpen && <SecurityAuditModal />}
      {!locked && isTotpMigrationOpen && <TotpMigrationModal />}
      {!locked && importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => { useAppStore.getState().refreshAll(); }}
        />
      )}
      <Toast />
      <ConfirmDialog />
    </div>
  );
}

export default App;
