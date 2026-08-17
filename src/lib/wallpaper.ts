// Wallpaper Engine 壁纸文件夹识别工具
// 读取 project.json 找到主媒体文件（视频/图片），支持文件夹级导入

const MEDIA_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
export const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

export interface WallpaperMeta {
  type: 'video' | 'image' | 'unknown';
  file: string;      // 主媒体文件名
  fullPath: string;  // 完整路径
  title?: string;
}

export interface FsApi {
  readDir: (path: string) => Promise<{ name: string; isDir: boolean }[]>;
  readTextFile: (path: string) => Promise<string>;
}

export async function detectWallpaperFolder(folderPath: string, fs: FsApi): Promise<WallpaperMeta | null> {
  try {
    const entries = await fs.readDir(folderPath);
    const names = entries.map((e) => e.name);
    const lower = names.map((n) => n.toLowerCase());

    // 1. 先找 project.json 读取 type/file 字段
    const projectIdx = lower.indexOf('project.json');
    if (projectIdx >= 0) {
      const projectPath = `${folderPath}\\${names[projectIdx]}`;
      try {
        const raw = await fs.readTextFile(projectPath);
        const json = JSON.parse(raw);
        const type: string = json.type || json.general?.type || '';
        const file: string = json.file || '';

        // 视频壁纸
        if (type.toLowerCase() === 'video' && file) {
          const full = `${folderPath}\\${file}`;
          const ext = file.split('.').pop()?.toLowerCase() || '';
          if (VIDEO_EXTS.includes(`.${ext}`)) {
            return { type: 'video', file, fullPath: full, title: json.title };
          }
          if (IMAGE_EXTS.includes(`.${ext}`)) {
            return { type: 'image', file, fullPath: full, title: json.title };
          }
        }
        // type 无效时回退到按扩展名找
      } catch {}
    }

    // 2. 回退：按扩展名扫描目录找最大的视频文件
    const videoFiles = entries.filter((e) => VIDEO_EXTS.some((ext) => e.name.toLowerCase().endsWith(ext)));
    if (videoFiles.length > 0) {
      // 优先选文件名含 4k/1080 的，否则选第一个
      const preferred = videoFiles.find((f) => /4k|2k|1080|2160/i.test(f.name)) || videoFiles[0];
      return { type: 'video', file: preferred.name, fullPath: `${folderPath}\\${preferred.name}` };
    }

    // 3. 再找图片（优先排除 preview.*）
    const imageFiles = entries.filter(
      (e) => IMAGE_EXTS.some((ext) => e.name.toLowerCase().endsWith(ext))
        && !/^preview\./i.test(e.name)
    );
    if (imageFiles.length > 0) {
      // 优先选最大尺寸的常用命名（bg/background/wallpaper）
      const preferred = imageFiles.find((f) => /^bg|background|wallpaper/i.test(f.name)) || imageFiles[0];
      return { type: 'image', file: preferred.name, fullPath: `${folderPath}\\${preferred.name}` };
    }

    // 4. 兜底：preview 预览文件（scene.pkg 3D壁纸/网页壁纸也有 preview）
    //    preview.gif 是动态图，优先使用；其次是 preview.png/jpg
    const previewFiles = entries.filter((e) => /^preview\./i.test(e.name));
    if (previewFiles.length > 0) {
      const gif = previewFiles.find((f) => f.name.toLowerCase().endsWith('.gif'));
      const preferred = gif || previewFiles[0];
      return { type: 'image', file: preferred.name, fullPath: `${folderPath}\\${preferred.name}` };
    }

    return null;
  } catch {
    return null;
  }
}