// 内置壁纸常量（避免循环依赖）

// 旧内置视频壁纸（白凪 shiro）：源为本地 Steam 路径，仅本机有该文件时可用
export const SHIRO_VIDEO = 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\白凪shiro.mp4';


//  type: 'video' | 'image' 走媒体背景；'ferrofluid' 走 React Bits 动态流体组件（无需媒体文件）
export interface BuiltinWallpaper {
  id: string;
  name: string;
  type: 'video' | 'image' | 'ferrofluid';
  source: string;   // 媒体背景使用的文件路径（ferrofluid 留空）
  preview: string;  // 设置里显示的预览图路径（ferrofluid 可用内置占位）
}

// 默认动态流体背景（React Bits Ferrofluid，MIT，零文件体积）
export const FERROFLUID_ID = 'ferrofluid';

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: FERROFLUID_ID,
    name: '磁性流体 Ferrofluid',
    type: 'ferrofluid',
    source: '',
    preview: '', // 组件实时渲染，无需预览图
  },
  {
    // 旧内置视频壁纸（白凪 shiro），源为本地 Steam 路径，仅本机有该文件时可用
    id: 'shiro',
    name: '白凪 shiro',
    type: 'video',
    source: 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\白凪shiro.mp4',
    preview: 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\preview.jpg',
  },
];
