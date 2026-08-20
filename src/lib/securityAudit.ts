import type { Entry } from '@/types';
import { getPasswordStrength } from './passwordUtils';

// 离线泄露密码库（Top 常见弱密码，本地比对，不上传任何数据）
// 来源：常年出现在各种泄露 dump 里的最高频密码
const BREACHED_PASSWORDS: Set<string> = new Set([
  '123456', '12345678', '123456789', '1234567', '1234567890', '12345', '1234', '123',
  'password', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', 'abc123', 'abcd1234',
  '111111', '11111111', '000000', '00000000', '88888888', '888888', '666666', '7777777',
  'admin', 'administrator', 'root', 'guest', 'user', 'test', 'test123', 'demo', 'demo123',
  'letmein', 'login', 'welcome', 'welcome1', 'welcome123', 'changeme', 'p@ssw0rd',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'master',
  'shadow', 'superman', 'batman', 'trustno1', 'whatever', 'secret', 'secret123',
  '1q2w3e4r', '1qaz2wsx', '1q2w3e4r5t', 'q1w2e3r4', 'qazwsx', 'zaq12wsx',
  'password1', 'password12', 'password123', 'pass123', 'p@ssword', 'pw123456',
  '123123', '123321', '123qwe', 'a123456', 'a12345678', 'aa123456', '1234qwer',
  '1q2w3e', 'qwerty1', 'qwerty12', 'qwe123', 'asdfgh', 'asdfghjkl', 'asdzxc',
  '66666666', '5201314', '1314520', 'woaini', 'woaini1314', 'iloveyou1314',
  '19891231', '19900101', '20001111', '123456a', '123456aA', 'aA123456',
  'google', 'google123', 'yahoo', 'msn', 'hotmail', 'outlook', 'facebook', 'twitter',
  'liverpool', 'chelsea', 'arsenal', 'manchester', 'barcelona', 'realmadrid',
  'starwars', 'naruto', 'pokemon', 'minecraft', 'csgo', 'steam', 'steam123',
  'flower', 'flower123', 'hello', 'hello123', 'freedom', 'shadow123', 'michael',
  'jordan', 'jordan23', 'tigger', 'poohbear', 'cookie', 'cookie123', 'sunshine1',
  'photoshop', 'photoshop123', 'expedia', 'expedia123', 'intel', 'intel123',
  'november', 'december', 'summer', 'winter', 'spring', 'autumn', 'microsoft',
  'microsoft123', 'apple', 'apple123', 'samsung', 'samsung123', 'huawei', 'xiaomi',
  'lovely', 'lovely123', 'babygirl', 'baby', 'baby123', 'money', 'money123',
  '123456789a', '123456789A', 'Password1', 'Password123', 'P@ssw0rd1', 'Pa55w0rd',
  'qwertyui', 'qwertyuiop123', '1g2w3e4r', '1qaz@wsx', '!@#$%^&*', '!@#$%^&*()',
  'q1w2e3r4t5', 'zaq12wsx', 'plokijuh', 'mnbvcxz', '1234abcd', 'abcd1234qwer',
  'passw0rd123', 'admin123', 'root123', 'toor', 'user123', 'test1234',
  'changethispassword', 'default', 'rootme', 'hacked', 'hacked123', 'nope', 'nopassword',
  '12345678a', '123456789b', 'mustang', 'access', 'access123', 'yellow', 'yellow123',
  'internet', 'internet123', 'computer', 'computer123', 'silver', 'silver123',
  'superman1', 'batman1', 'shadow1', 'dragons', 'monkey1', 'letmein1',
  '123qweasd', 'qweasdzxc', '1q2w3e4r5t6y', 'passwort', 'passwort123', 'azerty',
  'azerty123', 'trustno1!', 'ihateyou', 'ihateyou1', 'fuckyou', 'fuckyou123',
  'sex', 'sex123', 'god', 'god123', 'jesus', 'jesus123', 'angel', 'angel123',
  'love', 'love123', 'loveyou', 'loveyou123', 'killer', 'killer123',
]);

export interface AuditResult {
  total: number;
  weak: { entry: Entry; score: number }[];      // zxcvbn score <= 1
  reused: Entry[][];                              // 相同密码的组（>=2 条）
  breached: Entry[];                              // 命中离线泄露库
  issuesCount: number;
  // 每个账号只列一次（问题最严重的优先）：标识该账号属于哪些类别
  deduped: { entry: Entry; reasons: { breached: boolean; weak: boolean; reused: boolean; score: number } }[];
}

// 计算密码强度（复用 zxcvbn，返回 0-4）
function strengthScore(pwd: string): number {
  if (!pwd) return 0;
  try {
    return getPasswordStrength(pwd).score;
  } catch {
    return 0;
  }
}

export function runSecurityAudit(entries: Entry[]): AuditResult {
  const withPwd = entries.filter((e) => e.password && e.password.length > 0);

  // 弱密码：score <= 1
  const weak: { entry: Entry; score: number }[] = [];
  // 泄露命中
  const breached: Entry[] = [];

  for (const e of withPwd) {
    const score = strengthScore(e.password);
    if (score <= 1) weak.push({ entry: e, score });
    if (BREACHED_PASSWORDS.has(e.password.toLowerCase())) breached.push(e);
  }

  // 重复密码：按明文密码分组（同密码 = 复用风险）
  const byPwd = new Map<string, Entry[]>();
  for (const e of withPwd) {
    const arr = byPwd.get(e.password) || [];
    arr.push(e);
    byPwd.set(e.password, arr);
  }
  const reused = [...byPwd.values()].filter((g) => g.length >= 2);

  const reusedIds = new Set<number>();
  reused.forEach((g) => g.forEach((e) => reusedIds.add(e.id)));

  // 去重：每个账号只出现一次，汇总它命中了哪些类别
  const byId = new Map<number, { entry: Entry; reasons: { breached: boolean; weak: boolean; reused: boolean; score: number } }>();
  for (const w of weak) {
    const cur = byId.get(w.entry.id) || { entry: w.entry, reasons: { breached: false, weak: false, reused: false, score: w.score } };
    cur.reasons.weak = true;
    cur.reasons.score = w.score;
    byId.set(w.entry.id, cur);
  }
  for (const b of breached) {
    const cur = byId.get(b.id) || { entry: b, reasons: { breached: false, weak: false, reused: false, score: strengthScore(b.password) } };
    cur.reasons.breached = true;
    byId.set(b.id, cur);
  }
  for (const g of reused) {
    for (const e of g) {
      const cur = byId.get(e.id) || { entry: e, reasons: { breached: false, weak: false, reused: false, score: strengthScore(e.password) } };
      cur.reasons.reused = true;
      byId.set(e.id, cur);
    }
  }
  const deduped = [...byId.values()].sort((a, b) => (b.reasons.breached ? 1 : 0) - (a.reasons.breached ? 1 : 0));

  const issueIds = new Set<number>();
  weak.forEach((w) => issueIds.add(w.entry.id));
  breached.forEach((b) => issueIds.add(b.id));
  reused.forEach((g) => g.forEach((e) => issueIds.add(e.id)));

  return {
    total: withPwd.length,
    weak,
    reused,
    breached,
    issuesCount: issueIds.size,
    deduped,
  };
}
