import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLifeServer } from '../gui/server.mjs';
import { LifeStore, today } from '../store.mjs';
import { planTraining } from '../training.mjs';

const require = createRequire(import.meta.url);
const runtimeRoot = path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
const candidates = [process.env.LIFE_PLAYWRIGHT_PATH, path.join(runtimeRoot, 'playwright'), ...readdirSync(path.join(runtimeRoot, '.pnpm')).filter(name => name.startsWith('playwright-core@')).map(name => path.join(runtimeRoot, '.pnpm', name, 'node_modules', 'playwright-core'))].filter(Boolean);
let chromium;
for (const candidate of candidates) { if (existsSync(candidate)) { try { chromium = require(candidate).chromium; break; } catch {} } }
if (!chromium) throw new Error('浏览器验收需要Playwright；可通过LIFE_PLAYWRIGHT_PATH指定已安装路径。');
class FakeBridge extends EventEmitter {
  async start() { return this; }
  snapshot() { return { state: { sessionId: 'fictional', connected: true }, messages: [], dialogs: [], notifications: [] }; }
  async sessions() { return []; }
  stop() { this.closed = true; }
}
const root = mkdtempSync(path.join(tmpdir(), 'life-import-browser-'));
const past = days => new Date(Date.parse(`${today()}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
let application; let browser; let store;
try {
  application = await createLifeServer({ workspace: root, bridge: new FakeBridge() });
  store = new LifeStore(root);
  browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1380, height: 1000 } }); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${application.origin}/#${application.token}`);
  await page.getByRole('button', { name: '身体与锻炼', exact: true }).click();
  await page.getByRole('button', { name: '＋ 直接记录训练', exact: true }).click();
  const dialog = page.locator('.local-form-dialog');
  const save = async () => { await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  await dialog.locator('[name=date]').fill(past(2)); await dialog.locator('[name=duration_minutes]').fill('45');
  await dialog.getByRole('textbox', { name: '自定义动作名称', exact: true }).fill('杠铃卧推');
  await dialog.getByLabel('主练胸部', { exact: true }).check();
  await dialog.getByRole('button', { name: '＋ 单独加一组', exact: true }).click();
  await dialog.getByLabel('本组次数', { exact: true }).fill('8'); await dialog.getByLabel('本组负重kg', { exact: true }).fill('40');
  assert.equal(await dialog.locator('[name=cloud_allowed]').isChecked(), false);
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click();
  assert.equal(store.listTraining().length, 0); assert.match(await dialog.locator('.local-preview').innerText(), /独立实际记录/);
  await dialog.getByRole('button', { name: '返回修改', exact: true }).click();
  assert.equal(await dialog.getByLabel('本组次数', { exact: true }).inputValue(), '8'); await save();
  assert.equal(store.listTraining()[0].plan.mode, 'recorded');
  await page.locator('.training-entry').getByRole('button', { name: '更正实际训练', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox', { name: '自定义动作名称', exact: true }).inputValue(), '杠铃卧推');
  await dialog.getByRole('textbox', { name: '自定义动作名称', exact: true }).fill('慢跑');
  await dialog.locator('.exercise-muscles summary').click();
  await dialog.getByLabel('主练全身', { exact: true }).check();
  await dialog.getByRole('button', { name: '清空已录组数', exact: true }).click();
  await dialog.getByRole('button', { name: '确认清空这些组', exact: true }).click();
  await dialog.getByLabel('记录单位', { exact: true }).selectOption('seconds');
  await dialog.getByRole('button', { name: '＋ 单独加一组', exact: true }).click();
  await dialog.getByLabel('本组秒数', { exact: true }).fill('1800'); await save();
  assert.equal(store.listTraining()[0].actual.entries[0].sets[0].seconds, 1800);
  await page.locator('.training-entry').getByRole('button', { name: '给AI反馈', exact: true }).click();
  const share = page.getByRole('dialog', { name: '核对发给AI的训练信息' });
  assert.match(await share.innerText(), /部位：全身/); assert.match(await share.innerText(), /不代表完成参考计划/);
  await share.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.training-entry').getByRole('button', { name: '填写训练后恢复反馈', exact: true }).click();
  assert.equal(await dialog.locator('[name=soreness_full_body]').count(), 1); assert.equal(await dialog.locator('[name=soreness_chest]').count(), 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const imported = { date: past(1), duration_minutes: 30, cloud_allowed: true, entries: [{ name: '<img src=x onerror="window.importXss=true">', focus: 'legs', sets: [{ reps: 8 }] }] };
  const upload = async records => { await page.getByRole('button', { name: '导入训练记录（JSON）', exact: true }).click(); await dialog.locator('[name=training_file]').setInputFiles({ name: 'fictional.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'pi-training-v1', records })) }); };
  await upload([imported]); assert.equal(await dialog.locator('[name=cloud_allowed]').isChecked(), false); await save();
  assert.equal(store.listTraining().length, 2); assert.equal(store.listTraining({ cloudOnly: true }).length, 0); assert.equal(await page.evaluate(() => window.importXss), undefined);
  await upload([{ ...imported, date: past(3) }, imported]);
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('alert').filter({ hasText: '重复导入' }).waitFor();
  assert.equal(store.listTraining().length, 2); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '导入训练记录（JSON）', exact: true }).click();
  await dialog.locator('[name=training_json]').fill('broken'); await dialog.getByRole('button', { name: '核对并保存', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'JSON格式无效' }).waitFor(); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: '身体与锻炼', exact: true }).click(); await page.locator('.training-entry').first().waitFor();
  assert.equal(await page.locator('.training-entry').count(), 2); assert.ok(!(await page.locator('.training-history').last().innerText()).includes('计划null'));
  const planned = store.saveTraining(planTraining({ split: 'five', day: 'chest', readiness: 'normal', yesterday: 'rest', minutes: 40 }));
  await page.reload(); await page.getByRole('button', { name: '身体与锻炼', exact: true }).click();
  await page.locator('.training-entry').first().getByRole('button', { name: '记录实际训练', exact: true }).click();
  await dialog.locator('[name=duration_minutes]').fill('30');
  for (const card of await dialog.locator('.exercise-log').all()) await card.getByRole('button', { name: '＋ 单独加一组', exact: true }).click();
  for (const input of await dialog.getByLabel('本组次数', { exact: true }).all()) await input.fill('8');
  await save(); assert.equal(store.training(planned.id).status, 'completed'); assert.equal(store.training(planned.id).actual.independent, undefined);
  await page.setViewportSize({ width: 400, height: 850 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (process.env.LIFE_IMPORT_SCREENSHOT) await page.locator('.training-history').first().screenshot({ path: process.env.LIFE_IMPORT_SCREENSHOT });
  assert.deepEqual(errors, []);
  process.stdout.write('PASS: manual record, review/back, correction, timed activity, recovery targets, share preview, JSON file, duplicate rejection, invalid JSON, privacy, XSS, existing plan logging and mobile layout.\n');
} finally {
  await browser?.close(); store?.close(); await application?.close();
  const relative = path.relative(tmpdir(), root); if (relative.startsWith('life-import-browser-') && !relative.includes(path.sep)) rmSync(root, { recursive: true, force: true });
}
