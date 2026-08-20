import { useAppStore } from '@/stores/appStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import { SHIRO_VIDEO } from '@/lib/constants';

// 基础背景（白凪 shiro）

export function Background() {
  const { settings } = useAppStore();
  const { background } = settings;

  // 背景类型：'particles' | 'sakura' 已废弃，统一回退到内置 shiro 视频；
  // 'image' | 'video' 用自定义源；默认 shiro 视频
  const isCustom = background?.type === 'image' || background?.type === 'video';
  const bgType: 'video' | 'image' = isCustom ? (background!.type as 'video' | 'image') : 'video';

  // 实际使用的媒体源：自定义则用 source，否则用内置 白凪 shiro 视频
  const rawSource = isCustom && background?.source ? background.source : SHIRO_VIDEO;
  const opacity = background?.opacity ?? 1;

  // 媒体背景自动加深遮罩（保证文字可读性）
  const isMediaBg = true;
  const darkOverlay = Math.max(0.45, background?.darkOverlay ?? 0.45);

  // 本地文件路径 → WebView 可访问地址
  const mediaUrl = rawSource ? convertFileSrc(rawSource) : '';

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" style={{ opacity, background: 'var(--void)' }}>
      {bgType === 'image' && mediaUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${mediaUrl}")` }}
        />
      ) : (
        mediaUrl && (
          <video
            key={mediaUrl}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            src={mediaUrl}
          />
        )
      )}

      {/* 轻微渐变遮罩（保证文字可读性） */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(180deg, rgba(8,8,16,${Math.min(0.85, darkOverlay * 1.2)}) 0%, rgba(8,8,16,${darkOverlay * 0.6}) 45%, rgba(8,8,16,${darkOverlay * 0.75}) 100%)`,
        }}
      />

      {/* 轻微网格点 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}
