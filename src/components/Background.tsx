import { useAppStore } from '@/stores/appStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Ferrofluid } from '@/components/Ferrofluid';

// 背景组件：根据设置渲染 内置动态流体 / 自定义图片 / 自定义视频
export function Background() {
  const { settings } = useAppStore();
  const { background } = settings;

  const opacity = background?.opacity ?? 1;

  // 内置动态流体背景（React Bits Ferrofluid，零媒体文件）
  if (background?.type === 'ferrofluid') {
    return (
      <div className="fixed inset-0 z-0 overflow-hidden" style={{ opacity, background: 'var(--void)' }}>
        <Ferrofluid />
        {/* 轻微渐变遮罩（保证文字可读性） */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `linear-gradient(180deg, rgba(8,8,16,0.55) 0%, rgba(8,8,16,0.35) 45%, rgba(8,8,16,0.5) 100%)`,
          }}
        />
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

  // 媒体背景（image / video）
  const isCustom = background?.type === 'image' || background?.type === 'video';
  const bgType: 'video' | 'image' = isCustom ? (background!.type as 'video' | 'image') : 'video';
  const rawSource = isCustom && background?.source ? background.source : '';
  const darkOverlay = Math.max(0.45, background?.darkOverlay ?? 0.45);
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
