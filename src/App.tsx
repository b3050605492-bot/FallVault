import { useEffect, useState } from 'react';
import { useDatabase } from '@/hooks/useDatabase';
import { Background } from '@/components/Background';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { EntryList } from '@/components/EntryList';
import { EntryModal } from '@/components/EntryModal';
import { Toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsPanel } from '@/components/SettingsPanel';
import { PasswordGenerator } from '@/components/PasswordGenerator';
import { SecurityAuditModal } from '@/components/SecurityAuditModal';
import { TotpMigrationModal } from '@/components/TotpMigrationModal';
import { TitleBar } from '@/components/TitleBar';
import { LockScreen } from '@/components/LockScreen';
import { ImportModal } from '@/components/ImportModal';
import { useAppStore } from '@/stores/appStore';
import { THEMES, applyTheme } from '@/types';
import { lockVault } from '@/lib/crypto';
import { useAutoLock } from '@/hooks/useAutoLock';
import { startAutoBackup, stopAutoBackup } from '@/lib/backupManager';
import { getCurrentWindow } from '@tauri-apps/api/window';

function App() {
  useDatabase();
  const { isEntryModalOpen, isSettingsOpen, isPasswordGeneratorOpen, isSecurityAuditOpen, isTotpMigrationOpen, settings } = useAppStore();
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

  // 启动时等待 LockScreen 初始化（内部检测是否有主密码）
  // locked 初始 true → 显示解锁屏；解锁后 false 显示主界面

  // 监听设置面板发出的"锁定"事件（含关闭到托盘）——先 checkpoint 落盘 WAL，再清空内存密钥
  useEffect(() => {
    const handler = () => {
      import('@/lib/db').then((m) => m.checkpointDatabase()).catch(() => {});
      lockVault().then(() => setLocked(true)).catch(() => setLocked(true));
    };
    window.addEventListener('fallvault:lock', handler);
    return () => window.removeEventListener('fallvault:lock', handler);
  }, []);

  // 恢复备份后 reload：重置锁定状态，让 LockScreen 重新检测是否已有主密码
  useEffect(() => {
    const handler = () => setLocked(true);
    window.addEventListener('fallvault:reload', handler);
    return () => window.removeEventListener('fallvault:reload', handler);
  }, []);

  // 监听打开导入弹窗事件
  useEffect(() => {
    const handler = () => setImportOpen(true);
    window.addEventListener('fallvault:open-import', handler);
    return () => window.removeEventListener('fallvault:open-import', handler);
  }, []);

  // 自动锁定：闲置超时自动回解锁页
  const handleAutoLock = () => {
    lockVault().then(() => setLocked(true)).catch(() => setLocked(true));
  };
  useAutoLock(settings.autoLockEnabled, settings.autoLockMinutes, !locked, handleAutoLock);

  // 解锁后启动自动备份调度，锁定时停止（避免未解锁时备份空库）
  useEffect(() => {
    if (!locked) {
      const s = useAppStore.getState().settings;
      if (s.autoBackupEnabled && s.dataDir?.trim()) {
        startAutoBackup(s.autoBackupIntervalMin);
      }
    } else {
      stopAutoBackup();
    }
    return () => stopAutoBackup();
  }, [locked]);
  useEffect(() => {
    const unlistenFn = getCurrentWindow().onResized(async () => {
      // 仅当窗口被最小化时锁定
      const win = getCurrentWindow();
      const minimized = await win.isMinimized();
      if (minimized) {
        await lockVault();
        setLocked(true);
      }
    });
    return () => { unlistenFn.then((fn) => fn()).catch(() => {}); };
  }, []);

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
