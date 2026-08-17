import { useEffect } from 'react';
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
import { useAppStore } from '@/stores/appStore';
import { THEMES, applyTheme } from '@/types';

function App() {
  useDatabase();
  const { isEntryModalOpen, isSettingsOpen, isPasswordGeneratorOpen, settings } = useAppStore();

  // 启动时应用主题 + 毛玻璃透明度
  useEffect(() => {
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    applyTheme(theme);
    const alpha = settings.glassOpacity;
    document.documentElement.style.setProperty('--glass-opacity', String(alpha));
    // 线性映射：20%→0.12（轻度白），95%→0.72（明显白玻璃但文字仍可读）
    const glassAlpha = 0.12 + ((alpha - 0.2) / 0.75) * 0.6;
    document.documentElement.style.setProperty('--glass-alpha', Math.min(0.75, Math.max(0.1, glassAlpha)).toFixed(2));
    document.documentElement.style.setProperty('data-theme', theme.id);
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      <Background />

      <div className="relative z-10 flex flex-col w-full h-full">
        <TitleBar />
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

      {/* 全局弹窗层 */}
      {isEntryModalOpen && <EntryModal />}
      {isSettingsOpen && <SettingsPanel />}
      {isPasswordGeneratorOpen && <PasswordGenerator />}
      <Toast />
      <ConfirmDialog />
    </div>
  );
}

export default App;