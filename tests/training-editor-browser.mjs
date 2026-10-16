import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, readdirSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLifeServer } from '../gui/server.mjs';
import { LifeStore, today } from '../store.mjs';
import { planTraining } from '../training.mjs';
import { IMAGE_SUPPLEMENTS } from '../scripts/supplemental-exercise-images.mjs';

const require = createRequire(import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('../gui/public/exercise-catalog.json', import.meta.url), 'utf8'));
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
const root = mkdtempSync(path.join(tmpdir(), 'life-editor-browser-'));
const screenshots = process.env.LIFE_EDITOR_SCREENSHOTS;
if (screenshots) mkdirSync(screenshots, { recursive: true });
let application; let browser; let store;
try {
  application = await createLifeServer({ workspace: root, bridge: new FakeBridge() }); store = new LifeStore(root);
  browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }); const failures = []; const external = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => { if (!route.request().url().startsWith(application.origin)) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(`${application.origin}/#${application.token}`); await page.getByText('把日子，过成自己的方向。', { exact: true }).waitFor();
  const dialog = page.locator('.local-form-dialog'); const picker = page.locator('.exercise-picker-dialog');
  const openLibrary = async () => { await page.locator('#navigation').getByRole('button', { name: '动作库', exact: true }).click(); await picker.waitFor({ state: 'visible' }); };
  await openLibrary(); assert.equal(await picker.locator('.exercise-option').count(), catalog.records.length);
  assert.match(await picker.getByRole('heading').innerText(), /39个动作 · 35个有图解/);
  for (const supplement of IMAGE_SUPPLEMENTS.records) {
    const exercise = catalog.records.find(record => record.id === supplement.id);
    await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill(exercise.name);
    assert.equal(await picker.locator('.exercise-option').count(), 1);
    assert.equal(await picker.locator('.exercise-option img').count(), supplement.images.length);
    for (const picture of await picker.locator('.exercise-option img').all()) {
      await picture.scrollIntoViewIfNeeded(); await picture.evaluate(image => image.decode());
      assert.ok(await picture.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0));
    }
    for (const image of supplement.images) assert.equal(await picker.getByText(image.caption, { exact: true }).count(), 1);
    assert.equal(await picker.getByRole('link', { name: 'CC BY-SA 4.0', exact: true }).count(), supplement.images.length);
    if (exercise.image_note) assert.equal(await picker.getByText(exercise.image_note, { exact: true }).count(), 1);
    if (supplement.id === 'wger-1744') {
      assert.equal(await picker.locator('img').evaluate(image => getComputedStyle(image).filter), 'invert(1)');
      if (screenshots) await picker.screenshot({ path: path.join(screenshots, 'machine-lateral-raise.png') });
    }
  }
  assert.equal((await page.request.get(`${application.origin}/exercise-images/everkinetic-0000-tension.png`)).status(), 404);
  await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill('');
  await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' }); assert.equal(store.listTraining().length, 0);
  await openLibrary(); await picker.getByLabel('选择杠铃卧推', { exact: true }).check(); await picker.getByLabel('选择哑铃弯举', { exact: true }).check();
  await picker.getByRole('button', { name: '开始记录（2）', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('.exercise-log').count(), 2); assert.equal(await dialog.locator('.exercise-set-row').count(), 0);
  assert.equal(await dialog.locator('.exercise-reference[open]').count(), 2); assert.equal(await dialog.getByRole('button', { name: '从动作库选择', exact: true }).isVisible(), true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(store.listTraining().length, 0);
  await page.getByRole('button', { name: '身体与锻炼', exact: true }).click();
  await page.locator('.training-history').first().getByRole('button', { name: '动作库', exact: true }).click();
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'exercise-entry.png') });
  await page.getByRole('button', { name: '＋ 直接记录训练', exact: true }).click();
  await dialog.getByRole('button', { name: '选择备选动作', exact: true }).click();
  await picker.getByLabel('选择前臂平板支撑', { exact: true }).check(); await picker.getByLabel('选择杠铃卧推', { exact: true }).check();
  assert.equal(await picker.locator('input:checked').count(), 1);
  await picker.getByRole('button', { name: '使用此动作（1）', exact: true }).click();
  assert.equal(await dialog.locator('.exercise-log').count(), 1); assert.equal(await dialog.getByLabel('自定义动作名称', { exact: true }).inputValue(), '杠铃卧推');
  await dialog.getByLabel('每组次数', { exact: true }).fill('8');
  await dialog.getByRole('button', { name: '选择备选动作', exact: true }).click();
  assert.equal(await picker.getByLabel('按参与部位筛选', { exact: true }).inputValue(), 'chest');
  assert.equal(await picker.getByLabel('选择杠铃卧推', { exact: true }).isDisabled(), true);
  await picker.getByLabel('选择哑铃卧推', { exact: true }).check(); await picker.getByRole('button', { name: '使用此动作（1）', exact: true }).click();
  await picker.getByRole('alert').filter({ hasText: '不能覆盖或转移' }).waitFor();
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await dialog.getByLabel('每组次数', { exact: true }).inputValue(), '8');
  assert.equal(await dialog.getByLabel('自定义动作名称', { exact: true }).inputValue(), '杠铃卧推');
  await dialog.getByLabel('每组次数', { exact: true }).fill('');
  await dialog.getByRole('button', { name: '选择备选动作', exact: true }).click();
  await picker.getByLabel('按参与部位筛选', { exact: true }).selectOption('');
  await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill('平板'); await picker.getByLabel('选择前臂平板支撑', { exact: true }).check();
  await picker.getByRole('button', { name: '使用此动作（1）', exact: true }).click();
  assert.equal(await dialog.getByLabel('记录单位', { exact: true }).inputValue(), 'seconds'); assert.equal(await dialog.locator('.exercise-set-row').count(), 0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(store.listTraining().length, 0);
  await page.getByRole('button', { name: '＋ 直接记录训练', exact: true }).click();
  const date = new Date(Date.parse(`${today()}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await dialog.locator('[name=date]').fill(date); await dialog.locator('[name=duration_minutes]').fill('80');
  await dialog.getByRole('button', { name: '从动作库选择', exact: true }).click();
  await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill('划船'); assert.equal(await picker.locator('.exercise-option').count(), 3);
  await picker.getByLabel('选择坐姿绳索划船', { exact: true }).check();
  await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill('');
  await picker.getByLabel('按参与部位筛选', { exact: true }).selectOption('arms'); assert.ok(await picker.getByLabel('选择杠铃卧推', { exact: true }).count());
  await picker.getByLabel('按参与部位筛选', { exact: true }).selectOption('');
  await picker.getByLabel('按器材筛选', { exact: true }).selectOption('dumbbells'); assert.ok(await picker.getByLabel('选择哑铃卧推', { exact: true }).count());
  await picker.getByLabel('按器材筛选', { exact: true }).selectOption('');
  const selected = ['杠铃卧推', '哑铃卧推', '上斜哑铃卧推', '杠铃弯举', '哑铃弯举', '哑铃锤式弯举', '哑铃侧平举', '杠铃前蹲', '前臂平板支撑'];
  for (const name of selected) await picker.getByLabel(`选择${name}`, { exact: true }).check();
  const images = picker.locator('.exercise-option').first().locator('img'); await images.first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelector('.exercise-option').querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0));
  if (screenshots) await picker.screenshot({ path: path.join(screenshots, 'exercise-library.png') });
  await picker.getByRole('button', { name: '添加所选（10）', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('.exercise-log').count(), 10);
  for (const card of await dialog.locator('.exercise-log').all()) {
    const name = await card.getByLabel('自定义动作名称', { exact: true }).inputValue(); const timed = name === '前臂平板支撑';
    await card.getByLabel('负重 kg（可空）', { exact: true }).fill(timed ? '0' : '40');
    await card.getByLabel(timed ? '每组秒数' : '每组次数', { exact: true }).fill(timed ? '45' : '10');
    await card.getByLabel('做了多少组', { exact: true }).fill(timed ? '3' : '4'); await card.getByRole('button', { name: '加入这些组', exact: true }).click();
  }
  const bench = dialog.locator('.exercise-log').filter({ has: page.locator('input[aria-label="自定义动作名称"]').filter({ visible: true }) }).first();
  assert.match(await bench.locator('.exercise-set-details summary').innerText(), /40kg × 10次 × 4组/);
  await bench.locator('.exercise-set-details summary').click(); await bench.getByLabel('本组次数', { exact: true }).first().fill('8');
  assert.match(await bench.locator('.exercise-set-details summary').innerText(), /10次 × 3组/);
  await bench.getByLabel('记录单位', { exact: true }).selectOption('seconds'); assert.equal(await bench.getByLabel('记录单位', { exact: true }).inputValue(), 'reps'); assert.match(await bench.getByRole('alert').innerText(), /不会把次数/);
  await dialog.evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  const sticky = dialog.getByRole('button', { name: '＋ 添加动作', exact: true });
  assert.ok(await sticky.evaluate(element => { const box = element.getBoundingClientRect(); const modal = element.closest('dialog').getBoundingClientRect(); return box.top >= modal.top && box.bottom <= modal.bottom; }));
  await sticky.click(); await picker.getByRole('button', { name: '自定义动作', exact: true }).click();
  const custom = dialog.locator('.exercise-log').last(); await custom.getByLabel('自定义动作名称', { exact: true }).fill('自定义静态支撑'); await custom.getByLabel('主练核心', { exact: true }).check(); await custom.getByLabel('协同肩部', { exact: true }).check();
  await custom.getByLabel('记录单位', { exact: true }).selectOption('seconds'); await custom.getByLabel('每组秒数', { exact: true }).fill('30'); await custom.getByLabel('做了多少组', { exact: true }).fill('9');
  await custom.getByRole('button', { name: '加入这些组', exact: true }).click(); assert.equal(await custom.locator('.exercise-set-row').count(), 9);
  assert.equal(store.listTraining().length, 0);
  if (screenshots) { await custom.scrollIntoViewIfNeeded(); await dialog.screenshot({ path: path.join(screenshots, 'training-multiplier.png') }); }
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).waitFor();
  assert.equal(await sticky.isVisible(), false); assert.equal(store.listTraining().length, 0); assert.match(await dialog.locator('.local-preview').innerText(), /主练：背部；协同：手臂/);
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const saved = store.listTraining()[0]; assert.equal(saved.actual.entries.length, 11); assert.equal(saved.actual.entries.reduce((sum, entry) => sum + entry.sets.length, 0), 48); assert.equal(saved.cloud_allowed, false);
  assert.equal(saved.actual.entries.find(entry => entry.name === '前臂平板支撑').sets[0].seconds, 45);
  await page.locator('.training-entry').getByRole('button', { name: '更正实际训练', exact: true }).click(); assert.equal(await dialog.locator('.exercise-log').count(), 11);
  const persisted = dialog.locator('.exercise-log').first(); assert.match(await persisted.locator('.exercise-set-details summary').innerText(), /8次 × 1组/);
  await persisted.getByRole('button', { name: '选择备选动作', exact: true }).click();
  await picker.getByLabel('选择俯身杠铃划船', { exact: true }).check(); await picker.getByRole('button', { name: '使用此动作（1）', exact: true }).click();
  await picker.getByRole('alert').filter({ hasText: '不能覆盖或转移' }).waitFor(); await picker.getByRole('button', { name: '取消', exact: true }).click();
  assert.match(await persisted.locator('.exercise-set-details summary').innerText(), /8次 × 1组/);
  await page.setViewportSize({ width: 400, height: 850 }); await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await sticky.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; }));
  if (screenshots) await dialog.screenshot({ path: path.join(screenshots, 'training-mobile.png') });
  await sticky.click(); await picker.getByLabel('搜索动作（中文 / 英文）', { exact: true }).fill('平板'); assert.equal(await picker.locator('.exercise-option').count(), 1); assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await picker.getByRole('button', { name: '取消', exact: true }).click(); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.training-entry').getByRole('button', { name: '填写训练后恢复反馈', exact: true }).click(); assert.equal(await dialog.locator('[name=soreness_arms]').count(), 1); assert.equal(await dialog.locator('[name=soreness_back]').count(), 1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(store.listMetrics().length, 0);
  await openLibrary(); assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)); await picker.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  const planned = store.saveTraining(planTraining({ split: 'five', day: 'chest', readiness: 'normal', yesterday: 'rest', minutes: 40 }));
  const originalPlan = structuredClone(planned.plan);
  await page.reload(); await page.getByRole('button', { name: '身体与锻炼', exact: true }).click();
  await page.locator('.training-entry').first().getByRole('button', { name: '记录实际训练', exact: true }).click();
  await dialog.locator('[name=duration_minutes]').fill('30');
  const firstPlanned = dialog.locator('.exercise-log').first();
  await firstPlanned.getByRole('button', { name: '选择备选动作', exact: true }).click();
  await picker.getByLabel('选择哑铃卧推', { exact: true }).check(); await picker.getByRole('button', { name: '使用此动作（1）', exact: true }).click();
  assert.equal(await dialog.locator('[name=status]').inputValue(), 'partial');
  const alternative = dialog.locator('.exercise-log').first(); assert.equal(await alternative.getByLabel('自定义动作名称', { exact: true }).inputValue(), '哑铃卧推');
  await alternative.getByLabel('每组次数', { exact: true }).fill('10'); await alternative.getByLabel('做了多少组', { exact: true }).fill('3'); await alternative.getByRole('button', { name: '加入这些组', exact: true }).click();
  if (screenshots) { await alternative.scrollIntoViewIfNeeded(); await dialog.screenshot({ path: path.join(screenshots, 'exercise-alternative.png') }); }
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).waitFor();
  assert.equal(store.training(planned.id).actual, null);
  await dialog.getByRole('button', { name: '返回修改', exact: true }).click(); assert.equal(await alternative.locator('.exercise-set-row').count(), 3);
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const recordedPlan = store.training(planned.id); assert.deepEqual(recordedPlan.plan, originalPlan); assert.equal(recordedPlan.status, 'partial'); assert.equal(recordedPlan.cloud_allowed, false);
  assert.equal(recordedPlan.actual.entries.length, 1); assert.equal(recordedPlan.actual.entries[0].exercise_id, 'custom'); assert.equal(recordedPlan.actual.entries[0].name, '哑铃卧推');
  await page.locator('.training-entry').first().getByRole('button', { name: '更正实际训练', exact: true }).click();
  assert.equal(await dialog.locator('.exercise-log').last().getByLabel('自定义动作名称', { exact: true }).inputValue(), '哑铃卧推');
  assert.equal(await dialog.locator('.exercise-log').last().locator('.exercise-set-row').count(), 3); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await openLibrary(); await picker.getByRole('button', { name: '固定器械（19）', exact: true }).click();
  assert.equal(await picker.locator('.exercise-option').count(), 19); assert.equal(await picker.getByLabel('按器材筛选', { exact: true }).inputValue(), 'machine');
  assert.equal(await picker.getByLabel('选择杠铃卧推', { exact: true }).count(), 0);
  const search = picker.getByLabel('搜索动作（中文 / 英文）', { exact: true });
  await search.fill('推肩机'); assert.equal(await picker.locator('.exercise-option').count(), 1);
  await picker.getByLabel('选择器械肩上推举', { exact: true }).check();
  await page.waitForFunction(() => [...document.querySelector('.exercise-option').querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0));
  if (screenshots) await picker.screenshot({ path: path.join(screenshots, 'machine-library.png') });
  await search.fill('倒蹬'); assert.equal(await picker.locator('.exercise-option').count(), 1); assert.equal(await picker.locator('.exercise-option img').count(), 2);
  assert.doesNotMatch(await picker.locator('.exercise-option').innerText(), /图示暂缺/); assert.match(await picker.locator('.exercise-option').innerText(), /不自动计入未知滑车自重/);
  for (const picture of await picker.locator('.exercise-option img').all()) await picture.evaluate(image => image.decode());
  if (screenshots) await picker.screenshot({ path: path.join(screenshots, 'machine-leg-press.png') });
  await picker.getByLabel('选择腿举（倒蹬机）', { exact: true }).check();
  await search.fill('开腿机'); await picker.getByLabel('选择坐姿髋外展', { exact: true }).check();
  await search.fill(''); await picker.getByRole('button', { name: '绳索 / 龙门架（3）', exact: true }).click();
  assert.equal(await picker.locator('.exercise-option').count(), 3); assert.equal(await picker.getByLabel('选择坐姿高位下拉（拉力器）', { exact: true }).count(), 1);
  await page.setViewportSize({ width: 400, height: 850 }); assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await picker.getByRole('button', { name: '开始记录（3）', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('.exercise-log').count(), 3); assert.equal(await dialog.locator('.exercise-set-row').count(), 0);
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await dialog.locator('[name=date]').fill(new Date(Date.parse(`${today()}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10));
  await dialog.locator('[name=duration_minutes]').fill('40');
  for (const card of await dialog.locator('.exercise-log').all()) {
    assert.equal(await card.getByLabel('负重口径', { exact: true }).inputValue(), 'unknown');
    await card.getByLabel('负重口径', { exact: true }).selectOption('machine');
    await card.getByLabel('负重 kg（可空）', { exact: true }).fill('20');
    await card.getByLabel('每组次数', { exact: true }).fill('10'); await card.getByLabel('做了多少组', { exact: true }).fill('3');
    await card.getByRole('button', { name: '加入这些组', exact: true }).click();
  }
  await dialog.getByRole('button', { name: '核对并保存', exact: true }).click(); await dialog.getByRole('button', { name: '确认保存', exact: true }).waitFor();
  assert.equal(store.listTraining().length, 2);
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const machineRecord = store.listTraining().at(-1); assert.equal(machineRecord.cloud_allowed, false);
  assert.deepEqual(machineRecord.actual.entries.map(exercise => exercise.catalog_id), ['wger-543', 'wger-371', 'wger-1672']);
  assert.ok(machineRecord.actual.entries.every(exercise => exercise.sets.length === 3 && exercise.load_basis === 'machine' && exercise.sets[0].load_kg === 20));
  const machineHistory = page.locator('.training-entry').filter({ has: page.getByRole('heading', { name: new RegExp(`^${machineRecord.date} ·`) }) });
  await machineHistory.getByRole('button', { name: '更正实际训练', exact: true }).click();
  assert.equal(await dialog.locator('.exercise-set-row').count(), 9); assert.equal(await dialog.getByText(/图示暂缺/).count(), 0);
  assert.equal(await dialog.locator('.exercise-reference img').count(), 6);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await openLibrary(); await picker.getByRole('button', { name: '固定器械（19）', exact: true }).click();
  await search.fill('挂片高拉'); assert.equal(await picker.locator('.exercise-option img').count(), 0);
  assert.match(await picker.locator('.exercise-option').innerText(), /图示暂缺/);
  await search.fill('器械 腿');
  for (const picture of await picker.locator('.exercise-option img').all()) { await picture.scrollIntoViewIfNeeded(); await picture.evaluate(image => image.decode()); }
  assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await picker.evaluate(element => { element.scrollTop = 0; });
  if (screenshots) await picker.screenshot({ path: path.join(screenshots, 'machine-library-mobile.png') });
  await search.fill('推胸 器械'); assert.equal(await picker.locator('.exercise-option').count(), 1);
  await picker.getByLabel('选择坐姿器械推胸', { exact: true }).check();
  await search.fill('不存在的动作'); assert.equal(await picker.locator('.exercise-option').count(), 0);
  assert.equal(await picker.getByText(`找到 0 / ${catalog.records.length} 个动作`, { exact: true }).count(), 1);
  await picker.getByRole('button', { name: '取消选择坐姿器械推胸', exact: true }).click();
  assert.equal(await picker.getByRole('button', { name: '开始记录（0）', exact: true }).count(), 1);
  await picker.getByRole('button', { name: '清空筛选', exact: true }).click();
  assert.equal(await picker.locator('.exercise-option').count(), catalog.records.length); assert.equal(await search.inputValue(), '');
  await picker.getByLabel('选择腿举（倒蹬机）', { exact: true }).check(); await picker.getByLabel('选择坐姿髋外展', { exact: true }).check();
  await picker.getByRole('button', { name: '固定器械（19）', exact: true }).click(); await picker.getByLabel('按参与部位筛选', { exact: true }).selectOption('shoulders');
  await picker.getByRole('button', { name: '清空筛选', exact: true }).click();
  assert.equal(await picker.getByRole('button', { name: '开始记录（2）', exact: true }).count(), 1);
  assert.equal(await picker.getByLabel('选择腿举（倒蹬机）', { exact: true }).isChecked(), true);
  await picker.getByRole('button', { name: '取消选择腿举（倒蹬机）', exact: true }).click();
  assert.equal(await picker.getByLabel('选择腿举（倒蹬机）', { exact: true }).isChecked(), false);
  await picker.getByRole('button', { name: '清空待选', exact: true }).click(); assert.equal(await picker.locator('input:checked').count(), 0);
  assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await picker.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(store.listTraining().length, 3);
  assert.deepEqual(external, []); assert.deepEqual(failures, []);
  process.stdout.write('PASS: 19 fixed machines, cable separation, common-name search, licensed illustrations/text-only fallback, multi-selection, private machine log and correction on mobile.\n');
  process.stdout.write('PASS: sidebar/fitness/form library entries, browse-to-record, safe single-select alternatives, immutable reference plan with partial actuals, 11 actions/48 sets, multi-select/search/filter/images, sticky add, corrections, recovery, private save, mobile layout and no external requests.\n');
} finally {
  await browser?.close(); store?.close(); await application?.close();
  const relative = path.relative(tmpdir(), root); if (relative.startsWith('life-editor-browser-') && !relative.includes(path.sep)) rmSync(root, { recursive: true, force: true });
}
