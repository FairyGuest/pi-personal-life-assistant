const startup = document.querySelector('#startup');
const title = document.querySelector('#startup-title');
const message = document.querySelector('#startup-message');
const actions = document.querySelector('#startup-actions');
const stop = document.querySelector('#startup-stop');
let stopping = false;
let token = location.hash.slice(1);
try {
  if (/^[a-f0-9]{64}$/.test(token)) { sessionStorage.setItem('life-window-token', token); history.replaceState(null, '', '/'); }
  else token = sessionStorage.getItem('life-window-token') || '';
} catch {}

function showFailure(text) {
  title.textContent = '生活助手启动未完成';
  message.textContent = text;
  actions.hidden = false;
}

document.querySelector('#startup-retry').addEventListener('click', () => location.reload());
stop.addEventListener('click', async () => {
  if (stopping || !window.confirm('关闭旧服务会停止生成并取消待确认操作。请先保存其他窗口中的输入。确定关闭？')) return;
  stopping = true; stop.disabled = true;
  try {
    const response = await fetch('/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Token': token }, body: '{}', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('无法关闭旧服务，请重新运行“打开生活助手”，按提示确认重启。');
    title.textContent = '旧服务已关闭';
    message.textContent = '已保存的资料和训练记录仍在本地。请关闭此窗口，再双击工作区的“打开生活助手”。';
  } catch (error) { stopping = false; stop.disabled = false; showFailure(error.message); }
});

const timer = setTimeout(() => showFailure('启动时间较长，可能是旧后台与新界面不一致，或本地连接未响应。可重试；更新后请重新运行“打开生活助手”，按提示确认重启旧服务。'), 15000);

async function boot() {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('窗口授权已失效，请重新双击工作区的“打开生活助手”。');
  const response = await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('窗口授权已失效，请重新双击工作区的“打开生活助手”。');
  const application = await import('./app-main.js');
  await application.ready;
  if (stopping) return;
  startup.hidden = true;
  document.querySelector('#app-shell').hidden = false;
}

boot().catch(() => {
  if (!stopping) showFailure('界面模块或本地连接加载失败，可能是旧后台仍在运行。请重新双击“打开生活助手”并按提示确认更新；也可先关闭旧服务。不会自动重启或提交训练记录。');
}).finally(() => clearTimeout(timer));
