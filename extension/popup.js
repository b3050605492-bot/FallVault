// popup 逻辑
const dot = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const pairSection = document.getElementById('pair-section');
const pairedSection = document.getElementById('paired-section');
const notRunningSection = document.getElementById('not-running-section');
const codeInput = document.getElementById('code-input');
const pairBtn = document.getElementById('pair-btn');
const unpairBtn = document.getElementById('unpair-btn');
const errorEl = document.getElementById('error');
const openApp = document.getElementById('open-app');
const openApp2 = document.getElementById('open-app2');

// 打开外部应用（用 chrome 原生能力：openURL 需要外部链接，这里用简单方式）
function openFallVault() {
  // 尝试用系统签名/协议。简单做法：打开一个空白标签并在地址栏提示。
  // 由于扩展无法直接启动 exe，这里提示用户。
  statusText.textContent = '请手动启动 FallVault 桌面应用';
  setTimeout(refresh, 1200);
}
openApp.addEventListener('click', openFallVault);
openApp2.addEventListener('click', openFallVault);

function setStatus(running, paired) {
  if (!running) {
    dot.className = 'dot dot-red';
    statusText.textContent = 'FallVault 未运行';
    pairSection.style.display = 'none';
    pairedSection.style.display = 'none';
    notRunningSection.style.display = 'block';
  } else if (paired) {
    dot.className = 'dot dot-green';
    statusText.textContent = '已连接 FallVault';
    pairSection.style.display = 'none';
    pairedSection.style.display = 'block';
    notRunningSection.style.display = 'none';
  } else {
    dot.className = 'dot dot-gray';
    statusText.textContent = '等待配对';
    pairSection.style.display = 'block';
    pairedSection.style.display = 'none';
    notRunningSection.style.display = 'none';
    codeInput.focus();
  }
}

async function refresh() {
  statusText.textContent = '检测中...';
  chrome.runtime.sendMessage({ type: 'STATUS' }, (resp) => {
    setStatus(resp.running, resp.paired);
  });
}

pairBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) {
    errorEl.textContent = '请输入配对码';
    return;
  }
  errorEl.textContent = '';
  pairBtn.disabled = true;
  pairBtn.textContent = '配对中...';
  chrome.runtime.sendMessage({ type: 'PAIR', code }, (resp) => {
    pairBtn.disabled = false;
    pairBtn.textContent = '配对并连接';
    if (resp.ok) {
      statusText.textContent = '配对成功！';
      setTimeout(refresh, 500);
    } else if (resp.error === 'wrong_code') {
      errorEl.textContent = '配对码不正确，请重新复制';
    } else if (resp.error === 'not_running') {
      errorEl.textContent = 'FallVault 未运行，请先启动';
    } else {
      errorEl.textContent = '配对失败，请重试';
    }
  });
});

unpairBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'UNPAIR' }, () => {
    refresh();
  });
});

// 回车配对
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pairBtn.click();
});

refresh();
