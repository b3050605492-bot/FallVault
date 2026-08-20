// 内置壁纸常量（避免循环依赖）

// 默认内置背景图片（随安装包打包在 resources/ 下）
// 用 @resource: 前缀标记，运行时由 Background.tsx 通过 resourceDir() 解析为绝对路径，
// 避免写死绝对路径导致换机器读不到。
export const DEFAULT_BG_RESOURCE = 'default-bg.png';
export const DEFAULT_BG_TOKEN = `@resource:${DEFAULT_BG_RESOURCE}`;

// 内置壁纸清单：id / 名称 / 类型 / 应用时的媒体源 / 预览图
export interface BuiltinWallpaper {
  id: string;
  name: string;
  type: 'video' | 'image';
  source: string;   // 应用为背景时使用的媒体文件路径（@resource: 标记会运行时解析）
  preview: string;   // 设置里显示的预览图路径（@resource: 标记会运行时解析）
}

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: 'default-bg',
    name: '默认壁纸',
    type: 'image',
    source: DEFAULT_BG_TOKEN,
    preview: DEFAULT_BG_TOKEN,
  },
];
