// FallVault 扩展后台
// 负责：配对码校验、token 存储、与本地 FallVault 服务通信

const API = 'http://127.0.0.1:6666';

// FallVault 是否在运行
async function isRunning() {
  try {
    const res = await fetch(`${API}/api/ping`, { method: 'GET' });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// 用配对码验证并保存
async function pairWithCode(code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  try {
    const res = await fetch(`${API}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: trimmed }),
    });
    if (res.ok) {
      await chrome.storage.local.set({ fvToken: trimmed });
      return { ok: true };
    }
    if (res.status === 403) return { ok: false, error: 'wrong_code' };
    return { ok: false, error: 'server_error' };
  } catch (e) {
    return { ok: false, error: 'not_running' };
  }
}

// 当前配对状态
async function getStatus() {
  const running = await isRunning();
  if (!running) return { running: false, paired: false };
  const { fvToken } = await chrome.storage.local.get('fvToken');
  return { running: true, paired: !!fvToken };
}

// 校验 token 是否还有效
async function checkToken(token) {
  try {
    const res = await fetch(`${API}/api/ping`, {
      headers: { 'X-FallVault-Token': token },
    });
    if (res.ok) return true;
    if (res.status === 401) {
      await chrome.storage.local.remove('fvToken');
      return false;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function getValidToken() {
  const { fvToken } = await chrome.storage.local.get('fvToken');
  if (!fvToken) return null;
  const ok = await checkToken(fvToken);
  return ok ? fvToken : null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TOKEN') {
    getValidToken().then((token) => sendResponse({ token })).catch(() => sendResponse({ token: null }));
    return true;
  }
  if (msg.type === 'STATUS') {
    getStatus().then((s) => sendResponse(s)).catch(() => sendResponse({ running: false, paired: false }));
    return true;
  }
  if (msg.type === 'PAIR') {
    pairWithCode(msg.code).then((r) => sendResponse(r)).catch(() => sendResponse({ ok: false, error: 'unknown' }));
    return true;
  }
  if (msg.type === 'UNPAIR') {
    chrome.storage.local.remove('fvToken').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'MARK_FILLED') {
    chrome.storage.local.set({ lastFilled: { title: msg.title, host: msg.host, at: Date.now() } });
    sendResponse({ ok: true });
  }
  return false;
});

// 安装时清理
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove('fvToken');
});
