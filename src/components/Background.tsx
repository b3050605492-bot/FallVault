import { useAppStore } from '@/stores/appStore';
import LineWaves from '@/components/LineWaves';
import Particles from '@/components/Particles';
import { convertFileSrc } from '@tauri-apps/api/core';

export function Background() {
  const { settings } = useAppStore();
  const { background, theme } = settings;

  // 背景类型：'linewaves' | 'particles' | 'image' | 'video'
  const bgType = background?.type === 'particles' ? 'particles'
    : background?.type === 'image' ? 'image'
    : background?.type === 'video' ? 'video'
    : 'linewaves';

  const opacity = background?.opacity ?? 1;
  // 自定义图片/视频背景自动加深遮罩（保证文字可读性）
  const isMediaBg = bgType === 'image' || bgType === 'video';
  const darkOverlay = isMediaBg ? Math.max(0.55, background?.darkOverlay ?? 0.55) : (background?.darkOverlay ?? 0.25);

  // 本地文件路径 → WebView 可访问地址
  const mediaUrl = background?.source ? convertFileSrc(background.source) : '';

  return (
    <div className="fixed inset-0 z-0 overflow-hidden" style={{ opacity, background: 'var(--void)' }}>
      {/* 背景选择切换 */}
      {bgType === 'linewaves' && (
        <LineWaves
          key={`${bgType}`}
          speed={0.08}
          innerLineCount={48}
          outerLineCount={56}
          warpIntensity={0.18}
          rotation={-35}
          edgeFadeWidth={0.2}
          colorCycleSpeed={0.1}
          brightness={0.38}
          color1="#FFFFFF"
          color2="#A0A0AC"
          color3="#55555F"
          mouseInfluence={1.8}
        />
      )}

      {bgType === 'particles' && (
        <Particles
          key={`${bgType}`}
          particleCount={220}
          particleSpread={11}
          speed={0.08}
          particleColors={['#FFFFFF', '#E8E8F0', '#C0C8D8']}
          moveParticlesOnHover={true}
          particleHoverFactor={0.8}
          alphaParticles={true}
          particleBaseSize={110}
          sizeRandomness={1.2}
          disableRotation={true}
        />
      )}

      {bgType === 'image' && mediaUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${mediaUrl}")` }}
        />
      )}

      {bgType === 'video' && mediaUrl && (
        <video
          key={mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          src={mediaUrl}
        />
      )}

      {/* 轻微渐变遮罩（保证文字可读性） */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isMediaBg
            ? `linear-gradient(180deg, rgba(8,8,16,${Math.min(0.85, darkOverlay * 1.2)}) 0%, rgba(8,8,16,${darkOverlay * 0.6}) 45%, rgba(8,8,16,${darkOverlay * 0.75}) 100%)`
            : `linear-gradient(180deg, rgba(10,10,20,${darkOverlay * 0.4}) 0%, transparent 40%, rgba(10,10,20,${darkOverlay * 0.3}) 100%)`,
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