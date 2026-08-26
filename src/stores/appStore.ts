import { create } from 'zustand';
import type { Entry, Folder, Tag, AppSettings, ThemeDef } from '@/types';
import { THEMES, applyTheme } from '@/types';
import { DEFAULT_BG_TOKEN } from '@/lib/constants';

interface AppState {
  // Data
  entries: Entry[];
  folders: Folder[];
  tags: Tag[];
  favorites: Entry[];
  selectedFolderId: number | null;
  selectedTagId: number | null;
  searchQuery: string;
  selectedEntryId: number | null;
  isDetailOpen: boolean;
  isLoading: boolean;

  // UI
  isSidebarOpen: boolean;
  isEntryModalOpen: boolean;
  editingEntry: Entry | null;
  templatePrefill: { title: string; website: string; notes: string; customFields: any[] } | null;
  isSettingsOpen: boolean;
  isPasswordGeneratorOpen: boolean;
  isSecurityAuditOpen: boolean;
  isTotpMigrationOpen: boolean;
  confirmDialog: {
    open: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  };

  // Settings
  settings: AppSettings;
  __lastPersist?: number;

  // Actions
  setEntries: (entries: Entry[]) => void;
  setFolders: (folders: Folder[]) => void;
  setTags: (tags: Tag[]) => void;
  setFavorites: (favorites: Entry[]) => void;
  setSelectedFolderId: (id: number | null) => void;
  setSelectedTagId: (id: number | null) => void;
  setSearchQuery: (query: string) => void;
  setSelectedEntryId: (id: number | null) => void;
  setDetailOpen: (open: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setIsEntryModalOpen: (open: boolean) => void;
  setEditingEntry: (entry: Entry | null) => void;
  setTemplatePrefill: (prefill: { title: string; website: string; notes: string; customFields: any[] } | null) => void;
  setIsSettingsOpen: (open: boolean) => void;
  setIsPasswordGeneratorOpen: (open: boolean) => void;
  setIsSecurityAuditOpen: (open: boolean) => void;
  setIsTotpMigrationOpen: (open: boolean) => void;
  setConfirmDialog: (dialog: Partial<AppState['confirmDialog']>) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  refreshAll: () => Promise<void>;
}

const defaultSettings: AppSettings = {
  language: 'zh',
  theme: 'default',
  glassOpacity: 0.65,
  background: {
    type: 'image',
    source: DEFAULT_BG_TOKEN,
    name: '默认壁纸',
    blur: 0,
    opacity: 1,
    darkOverlay: 0.45,
  },
  clipboardClearSeconds: 30,
  autoBackupEnabled: true,
  autoBackupMax: 5,
  autoBackupIntervalMin: 60,
  unlockGraceEnabled: false,
  unlockGraceMin: 15,
  totpOffsetSec: 0,
  autofillResetAfterUse: false,
  quickOpenHotkey: 'Ctrl+Q',
  githubAutoBackup: {
    enabled: false,
    intervalMin: 720, // 默认 12 小时
    repo: '',
    tokenLabel: '',
  },
  dataDir: '',
  customBackgrounds: [],
  autofillHotkey: 'Ins',
};

// 从 localStorage 恢复设置
function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('fallvault-settings');
    if (raw) {
      const saved = JSON.parse(raw);
      const merged = { ...defaultSettings, ...saved, background: { ...defaultSettings.background, ...(saved.background || {}) } };
      // 迁移：旧版保存的 shiro 视频路径（写死绝对路径、换机器读不到）统一替换为内置图片
      const OLD_SHIRO = 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\白凪shiro.mp4';
      if (merged.background?.source === OLD_SHIRO || (merged.background?.source || '').toLowerCase().endsWith('白凪shiro.mp4')) {
        merged.background.type = 'image';
        merged.background.source = DEFAULT_BG_TOKEN;
        merged.background.name = '默认壁纸';
      }
      return merged;
    }
  } catch { }
  return defaultSettings;
}

const initialSettings = loadSettings();

export const useAppStore = create<AppState>((set, get) => ({
  entries: [],
  folders: [],
  tags: [],
  favorites: [],
  selectedFolderId: null,
  selectedTagId: null,
  searchQuery: '',
  selectedEntryId: null,
  isDetailOpen: false,
  isLoading: false,
  isSidebarOpen: true,
  isEntryModalOpen: false,
  editingEntry: null,
  templatePrefill: null,
  isSettingsOpen: false,
  isPasswordGeneratorOpen: false,
  isSecurityAuditOpen: false,
  isTotpMigrationOpen: false,
  confirmDialog: { open: false },
  settings: initialSettings,

  setEntries: (entries) => set({ entries }),
  setFolders: (folders) => set({ folders }),
  setTags: (tags) => set({ tags }),
  setFavorites: (favorites) => set({ favorites }),
  setSelectedFolderId: (id) => set({ selectedFolderId: id, selectedTagId: null, searchQuery: '' }),
  setSelectedTagId: (id) => set({ selectedTagId: id, selectedFolderId: null, searchQuery: '' }),
  setSearchQuery: (query) => set({ searchQuery: query, selectedFolderId: null, selectedTagId: null }),
  setSelectedEntryId: (id) => set({ selectedEntryId: id }),
  setDetailOpen: (open) => set({ isDetailOpen: open }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
  setIsEntryModalOpen: (open) => set({ isEntryModalOpen: open }),
  setEditingEntry: (entry) => set({ editingEntry: entry }),
  setTemplatePrefill: (prefill) => set({ templatePrefill: prefill }),
  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setIsPasswordGeneratorOpen: (open) => set({ isPasswordGeneratorOpen: open }),
  setIsSecurityAuditOpen: (open) => set({ isSecurityAuditOpen: open }),
  setIsTotpMigrationOpen: (open) => set({ isTotpMigrationOpen: open }),
  setConfirmDialog: (dialog) => set({ confirmDialog: { ...get().confirmDialog, ...dialog } }),
  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    // 主题切换时立即应用 CSS 变量
    if (partial.theme) {
      const theme = THEMES.find((t) => t.id === next.theme) || THEMES[0];
      applyTheme(theme);
    }
    // 毛玻璃透明度直接应用（JS 计算 alpha，CSS 负责叠加暗色保护层）
    if (partial.glassOpacity !== undefined) {
      const alpha = Math.round(partial.glassOpacity * 100) / 100;
      const root = document.documentElement;
      root.style.setProperty('--glass-opacity', String(alpha));
      // 线性映射：20%→0.12（轻度白），95%→0.72（明显白玻璃但文字仍可读）
      const glassAlpha = 0.12 + ((alpha - 0.2) / 0.75) * 0.6;
      root.style.setProperty('--glass-alpha', Math.min(0.75, Math.max(0.1, glassAlpha)).toFixed(2));
    }
    // 持久化到 localStorage（节流：拖动时最多每秒写 2 次）
    try {
      const now = Date.now();
      const last = get().__lastPersist ?? 0;
      if (now - last > 500) {
        localStorage.setItem('fallvault-settings', JSON.stringify(next));
        set({ settings: next, __lastPersist: now });
      } else {
        set({ settings: next });
      }
    } catch {
      set({ settings: next });
    }
  },

  refreshAll: async () => {
    set({ isLoading: true });
    try {
      const { getFolders, getTags, getEntries, getFavorites } = await import('@/lib/db');
      const { isLocked } = await import('@/lib/crypto');
          // 分类/标签不涉及加密，始终可加载
      const [folders, tags] = await Promise.all([getFolders(), getTags()]);
          let entries: any[] = [];
      let favorites: any[] = [];
      // 账号数据需要解锁后才可读（否则保持空，等解锁后再刷）
      if (!isLocked()) {
        try {
          const results = await Promise.all([
            getEntries(get().selectedFolderId || undefined, get().selectedTagId || undefined, get().searchQuery || undefined),
            getFavorites(),
          ]);
          entries = results[0];
          favorites = results[1];
                } catch (e) {
        }
      } else {
            }
      set({ folders, tags, entries, favorites });
    } catch (e) {
      console.error('Refresh failed:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));
