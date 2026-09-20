// Keep reads, integrity checks and master-password rotation on the same field list.
export const ENCRYPTED_ENTRY_FIELDS = ['username', 'password', 'notes', 'totp_secret', 'custom_fields'] as const;
export type EncryptedEntryField = typeof ENCRYPTED_ENTRY_FIELDS[number];

export function encryptedFieldLabel(field: string, isEn = false): string {
  const labels: Record<string, [string, string]> = {
    username: ['账号', 'Username'],
    password: ['密码', 'Password'],
    notes: ['备注', 'Notes'],
    totp_secret: ['双重验证密钥（TOTP）', 'Two-factor secret (TOTP)'],
    custom_fields: ['自定义字段', 'Custom fields'],
    password_history: ['密码历史', 'Password history'],
    attachment: ['附件', 'Attachment'],
  };
  return labels[field]?.[isEn ? 1 : 0] || field;
}
