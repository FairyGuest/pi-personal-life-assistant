import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { LifeStore } from '../store.mjs';

const require = createRequire(import.meta.url);
const { createPiEnvironment } = require('../../deepseek-only.cjs');
const cli = path.join(process.env.APPDATA, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
const fixture = fileURLToPath(new URL('./fixtures/life-test.ts', import.meta.url));

test('real RPC local profile input and consent persist across sessions without model messages', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pi-life-rpc-fictional-'));
  const config = path.join(root, 'config'); mkdirSync(config);
  const environment = { ...createPiEnvironment(process.env), PI_CODING_AGENT_DIR: config, PI_LIFE_TEST_WORKSPACE: root };
  delete environment.DEEPSEEK_API_KEY;
  const child = spawn(process.execPath, [cli, '--offline', '--no-extensions', '--extension', fixture, '--no-context-files', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-builtin-tools', '--provider', 'deepseek', '--model', 'deepseek-flash', '--mode', 'rpc', '--no-session'], { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const requests = new Map(); const notifications = []; let stderr = '';
  let dialogs = 0;
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  lines.on('line', line => {
    const event = JSON.parse(line);
    if (event.type === 'response' && requests.has(event.id)) { const resolve = requests.get(event.id); requests.delete(event.id); resolve(event); }
    if (event.type !== 'extension_ui_request') return;
    if (event.method === 'notify') notifications.push(event.message);
    if (!['select', 'input', 'confirm'].includes(event.method)) return;
    dialogs++;
    let response = { type: 'extension_ui_response', id: event.id };
    if (event.method === 'select') response.value = event.title === '领域' ? '职业与求职' : event.title.includes('类型') ? '已发生的事实' : '个人资料';
    if (event.method === 'input') response.value = event.title.includes('字段名') ? '测试岗位' : event.title.includes('生效日期') ? '' : 'PURE_LOCAL_RPC_FICTIONAL_657';
    if (event.method === 'confirm') response.confirmed = !['允许后续发送给DeepSeek吗？', '打开本地折线图？'].includes(event.title);
    child.stdin.write(`${JSON.stringify(response)}\n`);
  });
  const request = (id, type, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${stderr.slice(0, 500)}`)), 20000);
    requests.set(id, result => { clearTimeout(timer); resolve(result); });
    child.stdin.write(`${JSON.stringify({ id, type, ...params })}\n`);
  });
  try {
    const save = await request('save', 'prompt', { message: '/profile add' });
    assert.equal(save.success, true);
    assert.equal(save.data.disposition, 'handled');
    assert.equal(dialogs, 8);
    const database = new LifeStore(root);
    assert.equal(database.listMemory()[0].value, 'PURE_LOCAL_RPC_FICTIONAL_657');
    assert.equal(database.listMemory({ cloudOnly: true }).length, 0);
    database.close();
    const messages = await request('messages', 'get_messages');
    assert.equal(messages.data.messages.length, 0);
    const newSession = await request('new', 'new_session');
    assert.equal(newSession.success, true);
    const profile = await request('read', 'prompt', { message: '/profile' });
    assert.equal(profile.data.disposition, 'handled');
    assert.ok(notifications.some(message => message.includes('PURE_LOCAL_RPC_FICTIONAL_657')));
    const metricStore = new LifeStore(root);
    metricStore.addMetric({ metric: 'weight_kg', value: 71.5, unit: 'kg', measured_date: '2026-01-01', cloud_allowed: false });
    metricStore.close();
    const localChart = await request('chart', 'prompt', { message: '/metrics chart weight_kg 2026-01-01 2026-01-02' });
    assert.equal(localChart.data.disposition, 'handled');
    assert.ok(notifications.some(message => message.includes('已生成本地图表')));
    const afterChart = await request('after-chart', 'get_messages');
    assert.equal(afterChart.data.messages.length, 0);
    assert.ok(!stderr.includes('Failed to load extension'));
  } finally {
    lines.close(); child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 2000); child.once('close', () => { clearTimeout(timer); resolve(); }); });
    rmSync(root, { recursive: true, force: true });
  }
});
