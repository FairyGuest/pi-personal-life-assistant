import { spawn } from 'node:child_process';
import { existsSync, readFileSync, openSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import settings from '../workspace.cjs';
import { applicationRevision } from './version.mjs';

async function probeService(info) {
  try {
    const response = await fetch(`${info.origin}/api/health`, { headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(1200), redirect: 'error' });
    const result = await response.json();
    if (!response.ok || result.service !== 'pi-life-ui') throw new Error('无法验证已有本地服务，未启动第二个后台。请检查工作区data内的服务日志。');
    return { ...info, connected: result.connected === true, revision: result.revision };
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    if (error.name === 'TimeoutError') throw new Error('已有本地服务响应超时，未启动第二个后台。请稍后重试，或先关闭旧服务。');
    throw error;
  }
}

export async function runningService(workspace = settings.WORKSPACE) {
  let info;
  try { info = JSON.parse(readFileSync(path.join(workspace, 'data', 'life-ui-runtime.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('本地服务运行信息无法读取，请检查工作区data内的服务日志。'); }
  if (info.service !== 'pi-life-ui' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(info.origin) || !/^[a-f0-9]{64}$/.test(info.token)) throw new Error('本地服务运行信息无效，未连接或启动其他服务。');
  return probeService(info);
}

async function stopService(info) {
  const response = await fetch(`${info.origin}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: info.origin, Cookie: `life_session=${info.token}`, 'X-Life-Token': info.token }, body: '{}', signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('旧服务未能关闭，未启动第二个后台。');
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!await probeService(info)) return;
  }
  throw new Error('旧服务仍在退出，请稍后重新打开；没有强行结束其他进程。');
}

function spawnService(workspace) {
  mkdirSync(path.join(workspace, 'data'), { recursive: true });
  const output = openSync(path.join(workspace, 'data', 'life-ui-service.log'), 'a');
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { cwd: workspace, detached: true, windowsHide: true, stdio: ['ignore', output, output] });
    child.unref(); return child;
  } finally { closeSync(output); }
}

export async function ensureLifeService({ workspace = settings.WORKSPACE, revision = applicationRevision(), confirmRestart = async () => false, startService = spawnService } = {}) {
  let info = await runningService(workspace);
  if (info && (!info.connected || info.revision !== revision)) {
    const reason = info.connected ? '检测到旧后台与当前界面版本不一致。' : '本地服务仍在运行，但Pi连接已中断。';
    const confirmed = await confirmRestart(`${reason}重启会停止正在生成的回复并取消待确认操作，请先保存其他窗口中的输入。已保存的资料和训练记录不受影响。是否重启本地服务？`);
    if (confirmed !== true) throw new Error('未重启旧服务。请先保存其他窗口的输入，再重新打开助手并确认重启；终端 /app 也可确认。');
    await stopService(info); info = null;
  }
  if (!info) {
    const child = await startService(workspace);
    let failure;
    child.on('error', error => { failure = error; });
    child.on('exit', () => { failure = new Error('服务提前退出'); });
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (failure) throw new Error('无法启动本地服务，请检查Node安装和工作区data内的服务日志。');
      info = await runningService(workspace);
      if (info?.connected && info.revision === revision) break;
      info = null;
    }
    if (!info) { child.kill(); throw new Error('本地服务未就绪，请查看工作区data内的服务日志。'); }
  }
  return info;
}

export async function launchLifeWindow({ openWindow = true, confirmRestart } = {}) {
  const info = await ensureLifeService({ confirmRestart });
  if (openWindow) {
    const candidates = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean).map(root => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    const edge = candidates.find(existsSync);
    if (!edge) throw new Error('未找到Microsoft Edge，服务已启动，请安装Edge后重试。');
    const child = spawn(edge, [`--app=${info.origin}/#${info.token}`, '--window-size=1380,920'], { detached: true, windowsHide: false, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  }
  return { origin: info.origin };
}

async function confirmRestart(message) {
  if (process.argv.includes('--restart')) return true;
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|yes)$/i.test((await prompt.question(`${message}\n输入 y 确认重启，其他输入取消：`)).trim()); }
  finally { prompt.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) launchLifeWindow({ openWindow: !process.argv.includes('--no-open'), confirmRestart }).then(() => { process.stdout.write('个人生活助手已就绪。\n'); }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
