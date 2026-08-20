import type { CustomField } from '@/types';

export interface EntryTemplate {
  id: string;
  name: string;       // 模板名（中文）
  nameEn: string;
  icon: string;       // 显示的 emoji/图标字符
  titlePrefix: string; // 默认标题前缀
  website?: string;
  notes?: string;
  customFields: { key: string; value: string; hidden?: boolean }[];
}

// 内置常用模板
export const BUILTIN_TEMPLATES: EntryTemplate[] = [
  {
    id: 'login',
    name: '登录账号',
    nameEn: 'Login',
    icon: '🔑',
    titlePrefix: '',
    customFields: [],
  },
  {
    id: 'wifi',
    name: 'WiFi 网络',
    nameEn: 'WiFi',
    icon: '📶',
    titlePrefix: 'WiFi · ',
    notes: 'SSID：\n加密方式：WPA2/WPA3',
    customFields: [
      { key: 'SSID', value: '' },
      { key: '加密方式', value: 'WPA2' },
    ],
  },
  {
    id: 'bankcard',
    name: '银行卡',
    nameEn: 'Bank Card',
    icon: '💳',
    titlePrefix: '银行卡 · ',
    customFields: [
      { key: '卡号', value: '', hidden: true },
      { key: '持卡人', value: '' },
      { key: '有效期', value: 'MM/YY' },
      { key: 'CVV', value: '', hidden: true },
      { key: '银行', value: '' },
    ],
  },
  {
    id: 'license',
    name: '软件授权',
    nameEn: 'Software License',
    icon: '📜',
    titlePrefix: '授权 · ',
    customFields: [
      { key: '序列号 / License Key', value: '' },
      { key: '授权类型', value: '永久 / 订阅' },
      { key: '绑定邮箱', value: '' },
      { key: '到期时间', value: '' },
    ],
  },
  {
    id: 'server',
    name: '服务器',
    nameEn: 'Server',
    icon: '🖥️',
    titlePrefix: '服务器 · ',
    customFields: [
      { key: 'IP / 域名', value: '' },
      { key: '端口', value: '22' },
      { key: '系统', value: 'Linux' },
      { key: '备注', value: '' },
    ],
  },
  {
    id: 'idcard',
    name: '证件 / 身份',
    nameEn: 'ID / Document',
    icon: '🪪',
    titlePrefix: '证件 · ',
    customFields: [
      { key: '证件号', value: '', hidden: true },
      { key: '姓名', value: '' },
      { key: '有效期', value: '' },
      { key: '签发机关', value: '' },
    ],
  },
];

// 应用模板到表单：返回预填的 form 片段 + 自定义字段
export function applyTemplate(tpl: EntryTemplate): {
  form: { title: string; website: string; notes: string };
  customFields: CustomField[];
} {
  return {
    form: {
      title: tpl.titlePrefix,
      website: tpl.website || '',
      notes: tpl.notes || '',
    },
    customFields: tpl.customFields.map((f) => ({ ...f })),
  };
}
