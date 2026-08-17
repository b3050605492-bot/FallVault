// 描边文字动画（纯 CSS + SVG，无额外依赖）
// 每次挂载时：先描边勾勒出文字轮廓，再填充颜色
interface StrokeTextProps {
  text: string;
  strokeColor?: string;
  fillColor?: string;
  fontSize?: number;
  duration?: number;
  className?: string;
}

export function StrokeText({
  text,
  strokeColor = '#7DD3C0',
  fillColor = 'var(--moon, #E8E8F0)',
  fontSize = 26,
  duration = 1.6,
  className = '',
}: StrokeTextProps) {
  // 给每个字符算描边动画延迟，形成从左到右依次书写
  const chars = Array.from(text);
  const charDelay = 0.06;

  return (
    <svg
      className={className}
      width="100%"
      height={fontSize * 1.4}
      viewBox={`0 0 ${chars.length * fontSize * 0.72} ${fontSize * 1.4}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-label={text}
    >
      <style>{`
        @keyframes fv-stroke-draw {
          0% { stroke-dashoffset: var(--len); }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes fv-stroke-fill {
          0%, 55% { fill-opacity: 0; }
          100% { fill-opacity: 1; }
        }
      `}</style>
      {chars.map((ch, i) => {
        const x = i * fontSize * 0.72 + fontSize * 0.6;
        return (
          <text
            key={i}
            x={x}
            y={fontSize}
            textAnchor="middle"
            fontSize={fontSize}
            fontWeight={800}
            letterSpacing="-1"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={1}
            style={{
              strokeDasharray: 'var(--len)',
              strokeDashoffset: 'var(--len)',
              animation: `fv-stroke-draw ${duration}s cubic-bezier(0.4, 0, 0.2, 1) forwards ${i * charDelay}s, fv-stroke-fill ${duration * 0.8}s ease forwards ${i * charDelay + duration * 0.5}s`,
              '--len': `${fontSize * 3}px`,
            } as React.CSSProperties}
          >
            {ch}
          </text>
        );
      })}
    </svg>
  );
}