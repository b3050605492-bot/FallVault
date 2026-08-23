export interface Folder {
  id: number;
  name: string;
  icon: string;
  parent_id: number | null;
  sort_order: number;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Entry {
  id: number;
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  totp_secret?: string;
  icon: string;
  folder_id: number | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  // 联表查询附加字段
  tag_names?: string;
  tag_colors?: string;
  attach_count?: number;
  folder_name?: string;
  password_history?: PasswordHistory[];
  customFields?: CustomField[];
}

export interface PasswordHistory {
  id: number;
  entry_id: number;
  old_password: string;
  changed_at: string;
}

export interface Attachment {
  id: number;
  entry_id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  created_at: string;
}

export interface CustomField {
  key: string;
  value: string;
  hidden?: boolean; // 是否作为密码隐藏显示
}

export interface AppSettings {
  language: 'zh' | 'en';
  theme: 'default' | 'sakura' | 'azure';
  glassOpacity: number;
  background: {
    type: 'particles' | 'sakura' | 'image' | 'video' | 'color';
    source: string;
    name?: string;
    blur: number;
    opacity: number;
    darkOverlay: number;
  };
  clipboardClearSeconds: number;
  autoBackupEnabled: boolean;
  autoBackupMax: number;
  autoBackupIntervalMin: number;
  // 解锁宽限（免验证时长）：开启后，解锁成功的若干分钟内重新打开/从托盘唤起不要求重输主密码
  unlockGraceEnabled: boolean;
  unlockGraceMin: number; // 免验证时长（分钟）：5/15/30/60
  totpOffsetSec: number; // TOTP 时间偏移校正（秒），补偿本机与验证器设备的时间差
  autofillResetAfterUse: boolean; // 半自动填充：填充一次后是否重置待填账号（true=需重新选择，false=可连续填充）
  githubAutoBackup: {
    enabled: boolean;
    intervalMin: number; // 备份间隔（分钟）：1/720/1440/2880/5760
    repo: string; // 选中的仓库 full_name
    tokenLabel: string; // 已保存令牌的 label（令牌本体在 Windows 凭据管理器）
  };
  dataDir: string; // 用户自定义数据文件夹（备份/壁纸/图标/附件统一存放）；为空则未设置（禁用自动备份与背景导入）
  customBackgrounds: { id: string; type: 'image' | 'video'; source: string; name: string }[]; // 用户上传的自定义背景清单
  autofillHotkey: string; // 半自动填充热键（如 'Ins'），默认 'Ins'
}

// 三套主题定义（配色 + gradient-waves 背景色）
export interface ThemeDef {
  id: 'default' | 'sakura' | 'azure';
  name: string;
  nameEn: string;
  cssVars: Record<string, string>;
  waves: {
    horizon: string;
    wave: string;
    crest: string;
  };
}

export const THEMES: ThemeDef[] = [
  {
    id: 'default',
    name: '黑白',
    nameEn: 'Mono',
    cssVars: {
      '--mint': '#FFFFFF',
      '--crystal': '#D0D0D8',
      '--amethyst': '#9A9AA5',
      '--void': '#121212',
      '--void-light': '#1C1C1C',
      '--moon': '#F0F0F0',
      '--danger': '#D47070',
      '--success': '#FFFFFF',
      '--warning': '#C8C8C8',
    },
    waves: {
      horizon: '#101010',
      wave: '#3A3A42',
      crest: '#FFFFFF',
    },
  },
  {
    id: 'sakura',
    name: '二次元少女',
    nameEn: 'Sakura',
    cssVars: {
      '--mint': '#F4A7C3',
      '--crystal': '#F8E8EE',
      '--amethyst': '#E19ADE',
      '--void': '#2A1622',
      '--void-light': '#3D1E2E',
      '--moon': '#FFF0F5',
      '--danger': '#E07090',
      '--success': '#F4A7C3',
      '--warning': '#E8B060',
    },
    waves: {
      horizon: '#463394',
      wave: '#e19ade',
      crest: '#f0e8e8',
    },
  },
  {
    id: 'azure',
    name: '二次元蓝',
    nameEn: 'Azure',
    cssVars: {
      '--mint': '#7DB8D3',
      '--crystal': '#D0E4F0',
      '--amethyst': '#8FA7D9',
      '--void': '#0E1A2E',
      '--void-light': '#16263F',
      '--moon': '#E8F0FA',
      '--danger': '#D47070',
      '--success': '#7DB8D3',
      '--warning': '#D4B070',
    },
    waves: {
      horizon: '#0E1A2E',
      wave: '#2E5FA8',
      crest: '#7DB8D3',
    },
  },
];

export const applyTheme = (theme: ThemeDef) => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, value);
  }
  // 重新计算 dim 系列（基于主色）
  root.style.setProperty('--mint-dim', `${theme.cssVars['--mint']}26`);
  root.style.setProperty('--crystal-dim', `${theme.cssVars['--crystal']}1F`);
  root.style.setProperty('--amethyst-dim', `${theme.cssVars['--amethyst']}33`);
  root.style.setProperty('--moon-dim', `${theme.cssVars['--moon']}80`);
  root.style.setProperty('--moon-faint', `${theme.cssVars['--moon']}33`);
  // 注意：不在这里设置 --glass-bg（由毛玻璃透明度滑块单独控制，避免覆盖）
  root.style.setProperty('--glass-border', `${theme.cssVars['--crystal']}40`);
  root.style.setProperty('--glass-border-hover', `${theme.cssVars['--crystal']}66`);
};
