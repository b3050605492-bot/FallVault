import zxcvbn from 'zxcvbn';

export function getPasswordStrength(password: string) {
  const result = zxcvbn(password);
  return {
    score: result.score,
    crackTimeDisplay: result.crack_times_display.online_no_throttling_10_per_second,
    feedback: result.feedback,
  };
}

export function generatePassword(options: {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const ambiguous = 'iIl1Lo0O';

  let chars = '';
  if (options.upper) chars += upper;
  if (options.lower) chars += lower;
  if (options.numbers) chars += numbers;
  if (options.symbols) chars += symbols;

  if (options.excludeAmbiguous) {
    for (const c of ambiguous) {
      chars = chars.replace(c, '');
    }
  }

  if (!chars) return '';

  let password = '';
  const array = new Uint32Array(options.length);
  crypto.getRandomValues(array);
  for (let i = 0; i < options.length; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}
