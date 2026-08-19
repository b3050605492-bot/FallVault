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
