// FallVault 内容脚本
// 1. 检测登录表单 → 注入填充按钮 → 打开账号下拉 → 自动填充
// 2. 检测注册/密码修改 → 提交时提示保存

(() => {
  const API = 'http://127.0.0.1:6666';
  let lastPrompt = 0; // 防重复弹出

  // ---------- 与 background 通信获取 token ----------
  function getToken() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_TOKEN' }, (resp) => {
        resolve(resp && resp.token ? resp.token : null);
      });
    });
  }

  async function fetchEntries() {
    const token = await getToken();
    if (!token) return null;
    try {
      const host = location.hostname;
      const res = await fetch(`${API}/api/entries?host=${encodeURIComponent(host)}`, {
        headers: { 'X-FallVault-Token': token },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.entries || [];
    } catch (e) {
      return null;
    }
  }

  // ---------- 表单识别 ----------
  function findLoginFields(doc = document) {
    let user = null;
    let pass = null;

    const inputs = Array.from(doc.querySelectorAll('input'));
    for (const inp of inputs) {
      const t = (inp.type || '').toLowerCase();
      const name = (inp.name || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      const placeholder = (inp.placeholder || '').toLowerCase();
      if (t === 'password' || t === 'text-password' || name.includes('password') || id.includes('password')) {
        if (!pass) pass = inp;
      } else if (
        (t === 'text' || t === 'email' || t === 'tel' || name.includes('user') || name.includes('account') ||
         id.includes('user') || id.includes('account') || id.includes('email') || name === 'email' || placeholder.includes('邮箱') || placeholder.includes('账号') || placeholder.includes('手机') || placeholder.includes('用户名'))
      ) {
        if (!user) user = inp;
      }
    }
    return { user, pass };
  }

  // 排除搜索框等
  function isSearchField(inp) {
    const name = ((inp.name || '') + (inp.id || '') + (inp.placeholder || '')).toLowerCase();
    return name.includes('search') || name.includes('query') || name.includes('关键字');
  }

  // ---------- 注入填充按钮 ----------
  function injectAutoFill() {
    const { user, pass } = findLoginFields();
    if (!pass) return;
    if (isSearchField(pass)) return;

    // 防止重复
    if (document.querySelector('.fv-autofill-btn')) return;

    // 找密码框对应的容器
    const target = pass.closest('div, form') || document.body;

    const btn = document.createElement('button');
    btn.className = 'fv-autofill-btn';
    btn.type = 'button';
    btn.innerHTML = '🔑';
    btn.title = 'FallVault 填充';
    btn.style.cssText = `
      position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
      width: 24px; height: 24px; border: none; background: rgba(125,211,192,0.2);
      border-radius: 6px; cursor: pointer; z-index: 2147483647;
      display:flex; align-items:center; justify-content:center; font-size:14px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    `;
    target.style.position = target.style.position === '' ? 'relative' : target.style.position;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const entries = await fetchEntries();
      if (!entries) {
        showToast('请先打开 FallVault 并完成配对');
        return;
      }
      if (entries.length === 0) {
        showToast('FallVault 中暂无此网站的账号');
        return;
      }
      showDropdown(btn, entries);
    });

    target.appendChild(btn);
  }

  // ---------- 下拉菜单 ----------
  function showDropdown(anchor, entries) {
    removeDropdown();
    const wrap = document.createElement('div');
    wrap.className = 'fv-dropdown';
    wrap.style.cssText = `
      position: absolute; right: 0; top: 100%; margin-top: 6px; z-index: 2147483647;
      background: rgba(18,18,26,0.95); border: 1px solid rgba(255,255,255,0.2);
      border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      min-width: 240px; max-height: 300px; overflow-y: auto; font-family: -apple-system, 'Microsoft YaHei', sans-serif;
      color: #eee;
    `;

    const title = document.createElement('div');
    title.style.cssText = 'padding:8px 12px;font-size:11px;color:#999;border-bottom:1px solid rgba(255,255,255,0.08)';
    title.textContent = `FallVault · ${entries.length} 个账号`;
    wrap.appendChild(title);

    entries.forEach((entry) => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background .2s';
      item.innerHTML = `<div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(entry.title)}</div>
          <div style="font-size:11px;color:#999;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(entry.username || '')}</div>
        </div>`;
      item.addEventListener('mouseenter', () => item.style.background = 'rgba(125,211,192,0.1)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('click', () => {
        fillForm(entry);
        removeDropdown();
      });
      wrap.appendChild(item);
    });

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('click', removeDropdown, { once: true });
    }, 0);

    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(wrap);
  }

  function removeDropdown() {
    document.querySelectorAll('.fv-dropdown').forEach((el) => el.remove());
    document.removeEventListener('click', removeDropdown);
  }

  // 记录已填的账号列表，防止重复填充（发送到 background 存储）
  function markFilled(title) {
    chrome.runtime.sendMessage({ type: 'MARK_FILLED', title, host: location.hostname });
  }

  // ---------- 填充 ----------
  async function fillForm(entry) {
    const { user, pass } = findLoginFields();
    if (!pass) return;
    // 触发 focus 以激活站点自己的检测
    if (user) {
      user.value = entry.username || '';
      user.dispatchEvent(new Event('input', { bubbles: true }));
      user.dispatchEvent(new Event('change', { bubbles: true }));
    }
    pass.value = entry.password || '';
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    pass.dispatchEvent(new Event('change', { bubbles: true }));

    markFilled(entry.title);
    showToast(`已填充：${entry.title}`);
  }

  // ---------- 新账号保存提示 ----------
  const FORM_WATCH_INTERVAL = 3000;

  function detectSignupForm() {
    // 检测注册/创建账号的表单：有用户名+密码+密码确认或"注册/创建"
    const form = Array.from(document.querySelectorAll('form')).find((f) => {
      const text = (f.innerText || '').toLowerCase();
      const hasPwd = f.querySelector('input[type="password"]');
      const hasUser = Array.from(f.querySelectorAll('input')).some((i) => {
        const nm = ((i.name || '') + (i.id || '') + (i.placeholder || '')).toLowerCase();
        return /user|account|email|注册|邮箱|手机/.test(nm);
      });
      const isSignup = /注册|sign[\s-]?up|create account|创建账号/.test(text);
      return hasPwd && hasUser && isSignup;
    });
    return form;
  }

  // 仅在"点提交/回车"时检测并提示保存（自己写的新账号）
  function watchSignupSubmit() {
    const form = detectSignupForm();
    if (!form) return;

    const onFormSubmit = (e) => {
      const now = Date.now();
      if (now - lastPrompt < 5000) return; // 5 秒内不重复
      lastPrompt = now;

      // 收集表单值
      const inputs = form.querySelectorAll('input');
      let username = '', password = '';
      for (const inp of inputs) {
        const t = (inp.type || '').toLowerCase();
        const nm = ((inp.name || '') + (inp.id || '') + (inp.placeholder || '')).toLowerCase();
        if (t === 'password' && !nm.includes('confirm')) {
          if (!password) password = inp.value;
        } else if (/user|account|email/.test(nm)) {
          if (!username) username = inp.value;
        }
      }
      if (!password || password.length < 4) return;

      // 防抖：等表单真的提交了（SPA 框架），1.2 秒后再问
      setTimeout(() => {
        promptSave({ username, password });
      }, 1200);
    };

    form.addEventListener('submit', onFormSubmit, true);

    // 也监听回车键（非 form 元素时）
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.type === 'password') {
        const evt = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(evt);
      }
    });
  }

  // ---------- 保存提示 UI ----------
  function promptSave(data) {
    removePrompt();
    const host = location.hostname;
    const domain = host.replace(/^www\./, '');

    const box = document.createElement('div');
    box.className = 'fv-save-prompt';
    box.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: rgba(18,18,26,0.97); border: 1px solid rgba(125,211,192,0.5);
      border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      width: 300px; padding: 16px; font-family: -apple-system, 'Microsoft YaHei', sans-serif; color: #eee;
      animation: fvSlideIn .3s ease;
    `;
    const style = document.createElement('style');
    style.textContent = `@keyframes fvSlideIn { from { opacity:0; transform: translateY(20px); } to { opacity:1; transform: none; } }`;
    document.head.appendChild(style);

    box.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">🔐 保存此账号到 FallVault？</div>
      <div style="font-size:11px;color:#999;margin-bottom:8px">${escapeHtml(domain)}</div>
      <div style="margin-bottom:8px">
        <label style="display:block;font-size:11px;color:#bbb;margin-bottom:4px">标题</label>
        <input class="fv-in-title" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#eee;font-size:13px" placeholder="例如：B站 账号" />
      </div>
      <div style="font-size:11px;color:#bbb;margin-bottom:12px">
        👤 ${escapeHtml(data.username) || '（无用户名）'}
      </div>
      <div style="display:flex;gap:8px">
        <button class="fv-save-yes" style="flex:1;padding:9px;border:none;border-radius:8px;background:rgba(125,211,192,0.25);color:#7DD3C0;font-size:13px;font-weight:600;cursor:pointer">保存</button>
        <button class="fv-save-no" style="flex:1;padding:9px;border:none;border-radius:8px;background:rgba(255,255,255,0.08);color:#999;font-size:13px;cursor:pointer">暂不</button>
      </div>
    `;

    box.querySelector('.fv-save-yes').addEventListener('click', async () => {
      const titleInput = box.querySelector('.fv-in-title');
      const title = (titleInput.value || '').trim() || domain;
      const token = await getToken();
      if (!token) {
        showToast('请先打开 FallVault 并完成配对');
        return;
      }
      try {
        const res = await fetch(`${API}/api/entries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-FallVault-Token': token,
          },
          body: JSON.stringify({
            title,
            username: data.username || '',
            password: data.password || '',
            website: location.href,
            notes: '',
          }),
        });
        if (res.ok) {
          showToast('已保存到 FallVault');
        } else {
          showToast('保存失败，请稍后重试');
        }
      } catch (e) {
        showToast('保存失败，请确认 FallVault 正在运行');
      }
      removePrompt();
    });

    box.querySelector('.fv-save-no').addEventListener('click', () => removePrompt());

    document.body.appendChild(box);
  }

  function removePrompt() {
    document.querySelectorAll('.fv-save-prompt').forEach((el) => el.remove());
  }

  // ---------- Toast ----------
  function showToast(msg) {
    removeToast();
    const t = document.createElement('div');
    t.className = 'fv-toast';
    t.textContent = msg;
    t.style.cssText = `
      position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      background: rgba(18,18,26,0.97); border: 1px solid rgba(125,211,192,0.4);
      color: #eee; padding: 10px 18px; border-radius: 12px; font-size: 13px;
      font-family: -apple-system, 'Microsoft YaHei', sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(t);
    setTimeout(removeToast, 2200);
  }
  function removeToast() {
    document.querySelectorAll('.fv-toast').forEach((el) => el.remove());
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 初始化 ----------
  function init() {
    // 登录页：注入填充按钮（延迟等表单渲染）
    setTimeout(injectAutoFill, 1500);
    setTimeout(injectAutoFill, 3000);
    // 注册表单监听
    setTimeout(() => watchSignupSubmit(), 2000);

    // SPA 路由变化时重新注入
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(injectAutoFill, 1500);
        setTimeout(() => watchSignupSubmit(), 2000);
      }
    }, 2000);
  }

  // 等 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
