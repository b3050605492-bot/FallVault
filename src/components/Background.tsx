import { useAppStore } from '@/stores/appStore';
import { convertFileSrc } from '@tauri-apps/api/core';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { DEFAULT_BG_TOKEN } from '@/lib/constants';

// 把 @resource:xxx 标记解析为安装包 resources 目录下的绝对路径
// 优先用 Rust 端 resolve_resource（同时覆盖打包安装与直接运行 exe 两种情况）
async function resolveSource(src: string): Promise<string> {
  if (!src || !src.startsWith('@resource:')) return src;
  const name = src.slice('@resource:'.length);
  try {
    const path = await invoke<string>('resolve_resource', { name });
    return path || src;
  } catch {
    return src;
  }
}

export function Background() {
  const { settings } = useAppStore();
  const { background } = settings;

  const isCustom = background?.type === 'image' || background?.type === 'video';
  const bgType: 'video' | 'image' = isCustom ? (background!.type as 'video' | 'image') : 'image';
  const opacity = background?.opacity ?? 1;

  // 解析媒体源（处理 @resource: 标记）
  const [rawSource, setRaw] = useState(background?.source || DEFAULT_BG_TOKEN);
  useEffect(() => {
    let mounted = true;
    resolveSource(background?.source || DEFAULT_BG_TOKEN).then((r) => {
      if (mounted) setRaw(r);
    });
    return () => { mounted = false; };
  }, [background?.source]);

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
