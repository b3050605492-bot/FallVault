// TOTP 验证码工具（RFC 6238）
// 默认 HMAC-SHA1 / 30 秒 / 6 位；若传入完整的 otpauth:// URI，则尊重其中的
// algorithm / digits / period 参数（兼容 SHA256 / SHA512 / 8 位 等服务）

type Algo = 'SHA-1' | 'SHA-256' | 'SHA-512';

// TOTP 时间偏移校正（秒）：补偿本机时间与验证器设备（如 Google 验证器）的时间差。
// 由 App 启动时从设置读取并 setTotpOffset() 注入，默认 0。
let totpOffsetSec = 0;
export function setTotpOffset(sec: number): void {
  totpOffsetSec = Number.isFinite(sec) ? sec : 0;
}

function parseTotpParams(secretOrUri: string): { secret: string; algo: Algo; digits: number; period: number } {
  const raw = (secretOrUri || '').trim();
  // 完整 otpauth:// URI：提取 secret 与参数
  if (raw.toLowerCase().startsWith('otpauth://')) {
    try {
      const u = new URL(raw);
      const secret = u.searchParams.get('secret') || '';
      const algoParam = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace('SHA', 'SHA-');
      const algo: Algo = algoParam === 'SHA-256' ? 'SHA-256' : algoParam === 'SHA-512' ? 'SHA-512' : 'SHA-1';
      const digits = parseInt(u.searchParams.get('digits') || '6', 10) || 6;
      const period = parseInt(u.searchParams.get('period') || '30', 10) || 30;
      return { secret: secret.trim(), algo, digits, period };
    } catch { /* 解析失败回落到明文 */ }
  }
  return { secret: raw, algo: 'SHA-1', digits: 6, period: 30 };
}

// Base32 解码（RFC 4648，忽略空格和 = 填充）
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 char: ' + ch);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

// 从 otpauth:// URI 提取 secret（兼容二维码扫码结果）
export function parseOtpAuth(uri: string): string | null {
  if (!uri || !uri.startsWith('otpauth://')) return null;
  try {
    const u = new URL(uri);
    const secret = u.searchParams.get('secret');
    return secret || null;
  } catch {
    return null;
  }
}

// 由 secret + 标题构建 otpauth:// URI（用于迁移/导出到其他验证器）
export function buildOtpAuthUri(secret: string, label: string, issuer?: string): string {
  const clean = secret.replace(/\s+/g, '').toUpperCase();
  const enc = (s: string) => encodeURIComponent(s);
  const base = `otpauth://totp/${enc(label || 'FallVault')}?secret=${enc(clean)}&period=30&digits=6&algorithm=SHA1`;
  return issuer ? `${base}&issuer=${enc(issuer)}` : base;
}

// ---- Google Authenticator 批量迁移格式解析（otpauth-migration://offline?data=BASE64PROTOBUF） ----

interface ProtoField { tag: number; wireType: number; value: Uint8Array | number; }

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length) {
    const byte = buf[p];
    result |= (byte & 0x7f) << shift;
    p++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, p];
}

function parseProto(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = readVarint(buf, pos);
    const fieldNo = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      let val: number;
      [val, pos] = readVarint(buf, pos);
      fields.push({ tag: fieldNo, wireType, value: val });
    } else if (wireType === 2) {
      let len: number;
      [len, pos] = readVarint(buf, pos);
      const slice = buf.slice(pos, pos + len);
      pos += len;
      fields.push({ tag: fieldNo, wireType, value: slice });
    } else if (wireType === 5) {
      fields.push({ tag: fieldNo, wireType, value: buf.slice(pos, pos + 4) });
      pos += 4;
    } else if (wireType === 1) {
      fields.push({ tag: fieldNo, wireType, value: buf.slice(pos, pos + 8) });
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

function bytesToStr(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

// 原始字节 → Base32（RFC 4648，无填充大写），用于 TOTP secret 存储
function bytesToBase32(b: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of b) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  // 每 5 bit 一组（不足 5 bit 的末尾补 0），保证完整编码所有字节
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += alphabet[parseInt(chunk, 2)];
  }
  return out;
}

export interface MigratedTotp {
  secret: string;
  name: string;
  issuer: string;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
}

// 解析 Google 导出链接，返回所有 TOTP 条目（secret 为完整 base32，附带算法/位数/周期）
export function parseGoogleMigration(uri: string): MigratedTotp[] {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'otpauth-migration:') return [];
    const data = u.searchParams.get('data');
    if (!data) return [];
    // URL-safe base64 解码
    let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const top = parseProto(bytes);
    const out: MigratedTotp[] = [];
    for (const f of top) {
      if (f.tag !== 1 || !(f.value instanceof Uint8Array)) continue; // otp_parameters
      const inner = parseProto(f.value as Uint8Array);
      let secret = '';
      let name = '';
      let issuer = '';
      let algo: 'SHA1' | 'SHA256' | 'SHA512' = 'SHA1';
      let digits = 6;
      let period = 30;
      for (const g of inner) {
        if (g.tag === 1 && g.value instanceof Uint8Array) secret = bytesToBase32(g.value as Uint8Array);
        else if (g.tag === 2 && g.value instanceof Uint8Array) name = bytesToStr(g.value as Uint8Array);
        else if (g.tag === 3 && g.value instanceof Uint8Array) issuer = bytesToStr(g.value as Uint8Array);
        else if (g.tag === 4 && typeof g.value === 'number') {
          // Google enum: 1=SHA1, 2=SHA256, 3=SHA512
          algo = g.value === 2 ? 'SHA256' : g.value === 3 ? 'SHA512' : 'SHA1';
        } else if (g.tag === 5 && typeof g.value === 'number') {
          // Google enum: 1=SIX(6), 2=EIGHT(8)
          digits = g.value === 2 ? 8 : 6;
        } else if (g.tag === 7 && typeof g.value === 'number') period = g.value || 30;
      }
      if (secret) {
        const enc = (s: string) => encodeURIComponent(s);
        // 存为完整 otpauth:// URI，携带算法/位数/周期，TOTP 生成时尊重这些参数
        const uriStr = `otpauth://totp/${enc(name || issuer || 'FallVault')}?secret=${enc(secret.trim().toUpperCase())}&issuer=${enc(issuer || '')}&algorithm=${algo}&digits=${digits}&period=${period}`;
        out.push({ secret: uriStr, name, issuer, algorithm: algo, digits, period });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function hmacSha(secret: Uint8Array, msg: Uint8Array, algo: Algo): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', secret as unknown as BufferSource, { name: 'HMAC', hash: algo }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg as unknown as BufferSource);
  return new Uint8Array(sig);
}

// 计算指定时刻的 TOTP 码（支持 SHA1/256/512、6/8 位、任意 period）
// atSeconds 缺省时取本机时间 + totpOffsetSec（补偿时间差）
export async function generateTotp(secretOrUri: string, atSeconds?: number): Promise<string> {
  const { secret, algo, digits, period } = parseTotpParams(secretOrUri);
  const key = base32Decode(secret);
  const t = (atSeconds ?? Math.floor(Date.now() / 1000)) + totpOffsetSec;
  const time = Math.floor(t / period);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // 大端 64 位时间计数
  view.setUint32(0, Math.floor(time / 2 ** 32));
  view.setUint32(4, time >>> 0);

  const hmac = await hmacSha(key, new Uint8Array(buffer), algo);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

// 返回 { code, remainingSeconds }（剩余秒数用于 UI 倒计时）
// 倒计时按本机窗口计算（不受偏移影响，UI 仍每 30s 刷新）
export async function getTotpWithRemaining(secretOrUri: string): Promise<{ code: string; remaining: number }> {
  const { period } = parseTotpParams(secretOrUri);
  const now = Math.floor(Date.now() / 1000);
  const remaining = period - (now % period);
  const code = await generateTotp(secretOrUri, now);
  return { code, remaining };
}
