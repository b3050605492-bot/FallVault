// 内置壁纸常量（避免循环依赖）
// 白凪 shiro：Wallpaper Engine 视频（用户指定路径）
export const SHIRO_VIDEO = 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\白凪shiro.mp4';

// 内置壁纸清单：id / 名称 / 类型 / 应用时的媒体源 / 预览图
export interface BuiltinWallpaper {
  id: string;
  name: string;
  type: 'video' | 'image';
  source: string;   // 应用为背景时使用的媒体文件路径
  preview: string;  // 设置里显示的预览图路径
}

export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: 'shiro',
    name: '白凪 shiro',
    type: 'video',
    source: SHIRO_VIDEO,
    preview: 'D:\\Steam\\steamapps\\workshop\\content\\431960\\3640752243\\preview.jpg',
  },
];
