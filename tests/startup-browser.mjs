import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLifeServer } from '../gui/server.mjs';
import { LifeStore } from '../store.mjs';

const require = createRequire(import.meta.url);
const runtime = path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const candidates = [process.env.LIFE_PLAYWRIGHT_PATH, path.join(runtime, 'playwright'), ...readdirSync(path.join(runtime, '.pnpm')).filter(name => name.startsWith('playwright-core@')).map(name => path.join(runtime, '.pnpm', name, 'node_modules', 'playwright-core'))].filter(Boolean);
let chromium;
for (const candidate of candidates) if (existsSync(candidate)) { try { chromium = require(candidate).chromium; break; } catch {} }
if (!chromium) throw new Error('需要Playwright；可通过LIFE_PLAYWRIGHT_PATH指定。');

class FakeBridge extends EventEmitter {
  async start() { return this; }
  snapshot() { return { state: { sessionId: 'fictional', connected: true }, messages: [], dialogs: [], notifications: [] }; }
  async sessions() { return []; }
  stop() { this.closed = true; }
}

const root = mkdtempSync(path.join(tmpdir(), 'life-startup-browser-'));
let application; let browser; let store;
try {
  application = await createLifeServer({ workspace: root, bridge: new FakeBridge() });
  store = new LifeStore(root);
  browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const context = await browser.newContext(); const external = []; const errors = []; const mutations = [];
  context.on('request', request => { if (request.method() === 'POST' && !request.url().endsWith('/api/connect')) mutations.push(request.url()); });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => { if (!route.request().url().startsWith(application.origin)) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  const open = page => page.goto(`${application.origin}/#${application.token}`, { waitUntil: 'domcontentloaded' });

  const normal = await context.newPage(); await open(normal);
  await normal.getByText('把日子，过成自己的方向。', { exact: true }).waitFor();
  assert.equal(await normal.locator('#startup').isVisible(), false);
  await normal.getByRole('button', { name: '身体与锻炼', exact: true }).click();
  await normal.getByRole('button', { name: '＋ 直接记录训练', exact: true }).click();
  await normal.locator('.local-form-dialog').getByRole('button', { name: '取消', exact: true }).click();
  await normal.close();

  const failed = await context.newPage();
  await failed.route('**/training-editor.js', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"legacy asset route"}' }));
  await open(failed);
  await failed.getByText('生活助手启动未完成', { exact: true }).waitFor();
  assert.equal(await failed.locator('#app-shell').isVisible(), false);
  assert.equal(await failed.getByRole('button', { name: '关闭旧服务', exact: true }).isVisible(), true);
  failed.once('dialog', dialog => dialog.dismiss());
  await failed.getByRole('button', { name: '关闭旧服务', exact: true }).click();
  assert.equal(mutations.length, 0);
  await failed.unroute('**/training-editor.js');
  await failed.getByRole('button', { name: '重试加载', exact: true }).click();
  await failed.getByText('把日子，过成自己的方向。', { exact: true }).waitFor();
  assert.equal(await failed.locator('#startup').isVisible(), false);
  await failed.close();

  const slow = await context.newPage();
  await slow.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (callback, delay, ...args) => original(callback, delay === 15000 ? 100 : delay, ...args); });
  await slow.route('**/app-main.js', () => {});
  await open(slow);
  await slow.getByText('生活助手启动未完成', { exact: true }).waitFor();
  assert.match(await slow.locator('#startup-message').textContent(), /启动时间较长/);
  assert.equal(await slow.getByRole('button', { name: '重试加载', exact: true }).isEnabled(), true);
  await slow.close();

  const disconnected = await context.newPage();
  await disconnected.addInitScript(() => { const original = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = timeout => original(timeout === 30000 ? 100 : timeout); });
  await disconnected.route('**/api/dashboard?*', () => {});
  await open(disconnected);
  await disconnected.getByText('生活助手启动未完成', { exact: true }).waitFor();
  assert.equal(await disconnected.getByRole('button', { name: '重试加载', exact: true }).isEnabled(), true);
  await disconnected.close();

  const shutdown = await context.newPage();
  await shutdown.route('**/app-main.js', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"legacy asset route"}' }));
  await open(shutdown);
  await shutdown.getByText('生活助手启动未完成', { exact: true }).waitFor();
  assert.equal(mutations.length, 0); assert.equal(store.listTraining({ limit: 100 }).length, 0);
  shutdown.once('dialog', dialog => dialog.accept());
  await shutdown.getByRole('button', { name: '关闭旧服务', exact: true }).click();
  await shutdown.getByText('旧服务已关闭', { exact: true }).waitFor();
  assert.deepEqual(mutations, [`${application.origin}/api/shutdown`]);
  assert.equal(errors.length, 0, errors.join('\n')); assert.deepEqual(external, []);
  console.log('PASS: normal startup, legacy module rejection, recovery screen, declined shutdown, successful retry, slow imports, bounded API startup, explicit shutdown and no automatic writes or external requests.');
} finally { await browser?.close(); store?.close(); await application?.close(); rmSync(root, { recursive: true, force: true }); }
