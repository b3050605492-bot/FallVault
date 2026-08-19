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
import { TitleBar } from '@/components/TitleBar';
import { LockScreen } from '@/components/LockScreen';
import { ImportModal } from '@/components/ImportModal';
import { useAppStore } from '@/stores/appStore';
import { THEMES, applyTheme } from '@/types';
import { lockVault } from '@/lib/crypto';
import { useAutoLock } from '@/hooks/useAutoLock';
import { getCurrentWindow } from '@tauri-apps/api/window';

function App() {
  useDatabase();
  const { isEntryModalOpen, isSettingsOpen, isPasswordGeneratorOpen, settings } = useAppStore();
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

  // 监听设置面板发出的"锁定"事件
  useEffect(() => {
    const handler = () => {
      lockVault().then(() => setLocked(true)).catch(() => setLocked(true));
    };
    window.addEventListener('fallvault:lock', handler);
    return () => window.removeEventListener('fallvault:lock', handler);
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

  // 最小化即锁定（用户偏好：点最小化立刻上锁）
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
