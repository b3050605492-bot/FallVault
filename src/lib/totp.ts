// TOTP 验证码工具（RFC 6238，HMAC-SHA1，30 秒周期，6 位码）
// 使用 Web Crypto API 实现，零外部依赖

const PERIOD = 30;
const DIGITS = 6;

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
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

export interface MigratedTotp {
  secret: string;
  name: string;
  issuer: string;
}

// 解析 Google 导出链接，返回所有 TOTP 条目
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
      for (const g of inner) {
        if (g.tag === 1 && g.value instanceof Uint8Array) secret = bytesToBase32(g.value as Uint8Array);
        else if (g.tag === 2 && g.value instanceof Uint8Array) name = bytesToStr(g.value as Uint8Array);
        else if (g.tag === 3 && g.value instanceof Uint8Array) issuer = bytesToStr(g.value as Uint8Array);
      }
      if (secret) out.push({ secret: secret.trim().toUpperCase(), name, issuer });
    }
    return out;
  } catch {
    return [];
  }
}

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as unknown as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg as unknown as BufferSource);
  return new Uint8Array(sig);
}

// 计算当前/指定时刻的 6 位 TOTP 码
export async function generateTotp(secretB32: string, atSeconds?: number): Promise<string> {
  const key = base32Decode(secretB32);
  const time = Math.floor((atSeconds ?? Date.now() / 1000) / PERIOD);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // 大端 64 位时间计数
  view.setUint32(0, Math.floor(time / 2 ** 32));
  view.setUint32(4, time >>> 0);

  const hmac = await hmacSha1(key, new Uint8Array(buffer));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, '0');
}

// 返回 { code, remainingSeconds }（剩余秒数用于 UI 倒计时）
export async function getTotpWithRemaining(secretB32: string): Promise<{ code: string; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const remaining = PERIOD - (now % PERIOD);
  const code = await generateTotp(secretB32, now);
  return { code, remaining };
}

// ---- Steam 验证器算法（Steam Guard）----
// Steam 用的是自己的算法：同样的 HMAC-SHA1 时间步，但输出 5 位自定义字母表字符（非标准 6 位数字）
const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

// base64（含 URL-safe）解码为字节
function b64Decode(input: string): Uint8Array {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/').trim();
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 由 Steam shared_secret（base64）生成 5 位 Steam 验证码
export async function generateSteamTotp(secretB64: string, atSeconds?: number): Promise<string> {
  const key = b64Decode(secretB64);
  const time = Math.floor((atSeconds ?? Date.now() / 1000) / PERIOD);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(time / 2 ** 32));
  view.setUint32(4, time >>> 0);

  const hmac = await hmacSha1(key, new Uint8Array(buffer));
  // Steam 取最后 4 字节的低 31 位作为偏移起点
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  let code = bin >>> 0;
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += STEAM_ALPHABET[code % STEAM_ALPHABET.length];
    code = Math.floor(code / STEAM_ALPHABET.length);
  }
  return out;
}

// 返回 { code, remainingSeconds }（Steam 同样 30 秒周期）
export async function getSteamWithRemaining(secretB64: string): Promise<{ code: string; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const remaining = PERIOD - (now % PERIOD);
  const code = await generateSteamTotp(secretB64, now);
  return { code, remaining };
}
