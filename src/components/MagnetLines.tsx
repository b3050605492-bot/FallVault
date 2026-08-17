import { useRef, useEffect, useCallback } from 'react';

// React Bits 风格 - 磁吸线条背景
interface Line {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
}

export function MagnetLines({ 
  children, 
  lineCount = 30,
  lineColor = 'rgba(210,210,220, 0.08)',
  activeColor = 'rgba(210,210,220, 0.25)',
  attractionRadius = 150,
}: {
  children: React.ReactNode;
  lineCount?: number;
  lineColor?: string;
  activeColor?: string;
  attractionRadius?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<Line[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const animRef = useRef<number>(0);

  const initLines = useCallback((width: number, height: number) => {
    linesRef.current = Array.from({ length: lineCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      targetX: Math.random() * width,
      targetY: Math.random() * height,
      vx: 0,
      vy: 0,
    }));
  }, [lineCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.offsetWidth;
      canvas.height = parent.offsetHeight;
      initLines(canvas.width, canvas.height);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    canvas.parentElement?.addEventListener('mousemove', handleMouseMove);
    canvas.parentElement?.addEventListener('mouseleave', handleMouseLeave);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: mx, y: my } = mouseRef.current;

      linesRef.current.forEach(line => {
        // 距离鼠标
        const dx = mx - line.x;
        const dy = my - line.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 弹簧回归
        const springK = 0.02;
        const damp = 0.9;
        line.vx += (line.targetX - line.x) * springK;
        line.vy += (line.targetY - line.y) * springK;

        // 磁吸效果
        if (dist < attractionRadius) {
          const force = (attractionRadius - dist) / attractionRadius * 0.5;
          line.vx += dx * force * 0.1;
          line.vy += dy * force * 0.1;
        }

        line.vx *= damp;
        line.vy *= damp;
        line.x += line.vx;
        line.y += line.vy;

        // 画线
        const isActive = dist < attractionRadius;
        ctx.beginPath();
        ctx.moveTo(line.x, 0);
        ctx.lineTo(line.x, canvas.height);
        ctx.strokeStyle = isActive ? activeColor : lineColor;
        ctx.lineWidth = isActive ? 1.5 : 0.5;
        ctx.stroke();

        // 交点发光
        if (isActive) {
          ctx.beginPath();
          ctx.arc(line.x, my, 3, 0, Math.PI * 2);
          ctx.fillStyle = activeColor;
          ctx.fill();
        }
      });

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
      canvas.parentElement?.removeEventListener('mousemove', handleMouseMove);
      canvas.parentElement?.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [initLines, lineColor, activeColor, attractionRadius]);

  return (
    <div className="relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />
      <div className="relative" style={{ zIndex: 2 }}>
        {children}
      </div>
    </div>
  );
}
