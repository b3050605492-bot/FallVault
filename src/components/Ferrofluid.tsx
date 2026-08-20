import { useEffect, useRef } from 'react';
import { Renderer, Triangle, Mesh, Program, Vec2 } from 'ogl';

// 内置动态背景：磁性流体 Ferrofluid（React Bits，MIT）
// 参考：https://reactbits.dev/backgrounds/ferrofluid
// 按需求：关闭光标磁吸交互（不追踪鼠标），仅保留流体随时间流动；默认暗色。

// 标准 Ashima simplex noise（GLSL）
const fragment = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uIntensity;
uniform float uSpeed;
uniform vec3 uColorA;
uniform vec3 uColorB;

varying vec2 vUv;

//	Simplex 3D Noise by Ian McEwan, Ashima Arts
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){ 
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

//	fbm
float fbm(vec3 p){
  float f = 0.0;
  float amp = 0.5;
  for(int i = 0; i < 5; i++){
    f += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return f;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  uv = uv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;
  float d = length(uv);
  float t = uTime * uSpeed;

  // 流体场：多层 fbm，随时间流动（不随鼠标）
  float n = fbm(vec3(uv * 1.8, t * 0.15));
  float n2 = fbm(vec3(uv * 3.0 + 10.0, t * 0.22));
  float field = n * 0.65 + n2 * 0.35;

  // 等高线（发光描边）
  float bands = abs(fract(field * 4.0) - 0.5);
  float lines = smoothstep(0.06, 0.0, bands);

  // 中心暗、边缘更暗的 vignette
  float vig = smoothstep(1.6, 0.2, d);

  vec3 base = mix(uColorA, uColorB, smoothstep(-0.6, 0.6, field));
  vec3 col = base + lines * uIntensity;
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
`;

const vertex = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export function Ferrofluid({
  className = '',
  color = '#05060a',
  color2 = '#1b2a4a',
  intensity = 1.2,
  speed = 0.5,
}: {
  className?: string;
  color?: string;
  color2?: string;
  intensity?: number;
  speed?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const renderer = new Renderer({
      alpha: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 1);
    el.appendChild(gl.canvas);

    const hexToRgb = (hex: string): [number, number, number] => {
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new Vec2(1, 1) },
        uMouse: { value: new Vec2(0.5, 0.5) },
        uIntensity: { value: intensity },
        uSpeed: { value: speed },
        uColorA: { value: hexToRgb(color) },
        uColorB: { value: hexToRgb(color2) },
      },
    });

    const geometry = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const w = el!.clientWidth || window.innerWidth;
      const h = el!.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value.set(w * renderer.dpr, h * renderer.dpr);
    };
    window.addEventListener('resize', resize);
    resize();

    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      program.uniforms.uTime.value = (now - start) / 1000;
      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (gl.canvas.parentNode) gl.canvas.parentNode.removeChild(gl.canvas);
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    };
  }, [color, color2, intensity, speed]);

  return <div ref={ref} className={`fixed inset-0 z-0 ${className}`} />;
}
