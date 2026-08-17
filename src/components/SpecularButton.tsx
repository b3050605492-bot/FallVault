import { useRef, type ReactNode, type MouseEventHandler } from 'react';

// 高光扫过按钮（纯 CSS 实现 react-bits SpecularButton 的鼠标移入高光效果）
interface SpecularButtonProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}

export function SpecularButton({
  children,
  className = '',
  style,
  onClick,
  disabled = false,
  type = 'button',
  title,
}: SpecularButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = btnRef.current;
    if (!btn) return;
    // 自定义属性 --x/--y 供 CSS 定位高光
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty('--fx-x', `${e.clientX - rect.left}px`);
    btn.style.setProperty('--fx-y', `${e.clientY - rect.top}px`);
  };

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      onMouseMove={handleMouseMove}
      className={`specular-btn ${className}`.trim()}
      style={style}
    >
      {/* 跟随鼠标的高光 */}
      <span className="specular-btn__glow" aria-hidden />
      {/* 斜向扫过高光（也在 hover 时出现） */}
      <span className="specular-btn__sweep" aria-hidden />
      <span className="specular-btn__label">{children}</span>
    </button>
  );
}