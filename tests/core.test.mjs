import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { LifeStore, validateMemory, validateMetric, relevantDomains, today } from '../store.mjs';
import { projectFinances } from '../finance.mjs';
import { fetchPublic, publicUrl, isPublicAddress, PublicResearch, parseArxiv, htmlText } from '../network.mjs';
import { inboxPath, readDocument } from '../documents.mjs';

function fixture(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pi-life-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const memory = overrides => ({ domain: 'career', key: '当前岗位', kind: 'fact', value: '虚构测试工程师', effective_date: today(), ...overrides });

test('new instance recalls approved facts but keeps goals and assumptions separate', context => {
  const root = fixture(context);
  let store = new LifeStore(root);
  store.remember(memory({ cloud_allowed: true }));
  store.remember(memory({ kind: 'goal', value: '虚构目标岗位' }));
  store.remember(memory({ kind: 'assumption', value: '虚构工资增长' }));
  store.close();
  store = new LifeStore(root);
  assert.equal(store.listMemory().length, 3);
  assert.equal(store.listMemory({ cloudOnly: true })[0].value, '虚构测试工程师');
  assert.equal(store.listMemory({ cloudOnly: true }).length, 1);
  store.close();
});

test('corrections preserve history, detect concurrent writes and revoke historical sharing', context => {
  const store = new LifeStore(fixture(context));
  const first = store.remember(memory({ cloud_allowed: true }));
  const latest = store.remember(memory({ value: '更正后的虚构岗位', cloud_allowed: false }), 'test', first.id);
  assert.equal(store.listMemory({ history: true }).length, 2);
  assert.equal(store.listMemory()[0].id, latest.id);
  assert.equal(store.listMemory({ history: true, cloudOnly: true }).length, 0);
  assert.throws(() => store.remember(memory(), 'test', first.id), /另一会话/);
  assert.throws(() => store.remember(memory({ effective_date: '2020-01-01' })), /旧日期/);
  assert.equal(store.forgetMemory('career', '当前岗位', 'fact'), 2);
  assert.equal(store.listMemory({ history: true }).length, 0);
  store.close();
});

test('validation blocks secrets, future facts, malformed dates and wrong metric units', () => {
  assert.throws(() => validateMemory(memory({ value: 'sk-fictional012345678901234567' })), /密钥/);
  assert.throws(() => validateMemory(memory({ effective_date: '2099-01-01' })), /未来/);
  assert.doesNotThrow(() => validateMemory(memory({ kind: 'goal', effective_date: '2099-01-01' })));
  assert.throws(() => validateMemory(memory({ effective_date: '2026-02-30' })), /无效/);
  assert.equal(validateMemory(memory({ sensitivity: 'sensitive', cloud_allowed: true })).cloud_allowed, false);
  assert.throws(() => validateMetric({ metric: 'weight_kg', value: 70, unit: 'lb' }), /kg/);
  assert.throws(() => validateMetric({ metric: 'weight_kg', value: 700, unit: 'kg' }), /核对/);
  assert.throws(() => validateMetric({ metric: 'steps', value: 2.5, unit: 'steps' }), /整数/);
  assert.throws(() => validateMetric({ metric: 'steps', value: 500, unit: 'steps', measured_date: '2099-01-01' }), /未来/);
});

test('metric correction is dated and chained; deletion removes the whole correction chain', context => {
  const store = new LifeStore(fixture(context));
  const first = store.addMetric({ metric: 'weight_kg', value: 70, unit: 'kg', cloud_allowed: true });
  const second = store.addMetric({ metric: 'weight_kg', value: 71, unit: 'kg', correction_of: first.id });
  assert.equal(store.listMetrics().length, 1);
  assert.equal(store.listMetrics({ history: true }).length, 2);
  assert.equal(store.listMetrics({ history: true, cloudOnly: true }).length, 0);
  assert.throws(() => store.addMetric({ metric: 'steps', value: 50, unit: 'steps', correction_of: second.id }), /同一天/);
  assert.equal(store.deleteMetric(second.id), 2);
  store.close();
});

test('plan revisions reject stale changes; full export and backup do not truncate', context => {
  const root = fixture(context);
  const store = new LifeStore(root);
  const plan = store.savePlan({ domain: 'career', kind: 'job', title: '虚构岗位', status: 'applied' });
  const updated = store.savePlan({ ...plan, status: 'interview' }, 'test', plan.revision);
  assert.equal(updated.revision, 2);
  assert.throws(() => store.savePlan({ ...plan, status: 'offer' }, 'test', plan.revision), /另一会话/);
  for (let index = 0; index < 105; index++) store.remember(memory({ key: `测试${index}` }));
  assert.equal(store.exportData().memory.length, 105);
  const backup = store.backupTo(path.join(root, 'backup.sqlite'));
  assert.equal(typeof backup, 'string');
  const copy = new DatabaseSync(backup);
  assert.equal(copy.prepare('SELECT count(*) count FROM memory').get().count, 105);
  assert.equal(copy.prepare('SELECT status FROM plans').get().status, 'interview');
  copy.close();
  assert.equal(store.deletePlan(plan.id), 1);
  store.close();
});

test('finance effective annual compounding matches formula for 240 monthly deposits', () => {
  const projected = projectFinances({ annual_return: 0.1, phases: [{ years: 20, monthly_investment: 7000 }], retirement_annual_spending: 100000 });
  const monthlyReturn = 1.1 ** (1 / 12) - 1;
  assert.equal(projected.final_assets, Math.round(7000 * ((1 + monthlyReturn) ** 240 - 1) / monthlyReturn));
  assert.equal(projected.contributions, 1680000);
  assert.equal(projected.checkpoints.length, 20);
  assert.equal(projected.assumptions.constant_return_not_forecast, true);
  assert.equal(projectFinances({ annual_return: 0, phases: [{ years: 1, monthly_investment: 1000 }] }).final_assets, 12000);
});

test('300万 house/car cash shortage stops instead of compounding negative assets', () => {
  const projected = projectFinances({ annual_return: 0.1, phases: [{ years: 3, monthly_investment: 7000 }, { years: 4, monthly_investment: 14000 }, { years: 5, monthly_investment: 22000 }, { years: 8, monthly_investment: 30000 }], outflows: [{ month: 108, amount: 3000000 }] });
  assert.equal(projected.feasible, false);
  assert.equal(projected.shortfall_month, 108);
  assert.ok(projected.shortfall > 900000);
  assert.equal(projected.final_assets, undefined);
});

test('inflation adjusted result and outflow timing are explicit', () => {
  const projection = projectFinances({ initial_assets: 100000, annual_return: 0, annual_inflation: 0.02, phases: [{ years: 1, monthly_investment: 0 }], outflows: [{ month: 12, amount: 10000 }] });
  assert.equal(projection.final_assets, 90000);
  assert.equal(projection.present_purchasing_power, Math.round(90000 / 1.02));
  assert.throws(() => projectFinances({ annual_return: -1, phases: [{ years: 1, monthly_investment: 1 }] }));
});

test('network denies loopback, internal, reserved, credentials and DNS rebinding targets', async () => {
  for (const url of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.0.0.1', 'https://169.254.169.254', 'https://user:pass@example.com', 'https://example.com:444']) assert.throws(() => publicUrl(url));
  assert.equal(publicUrl('https://arxiv.org/abs/2210.03629').hostname, 'arxiv.org');
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('192.168.1.1'), false);
  await assert.rejects(fetchPublic('https://public.example.com', { resolve: async () => [{ address: '127.0.0.1', family: 4 }] }), /已阻止/);
});

test('papers parse verified metadata; wrong Crossref candidate is not labeled exact;429 propagates', async () => {
  const xml = '<feed><entry><id>http://arxiv.org/abs/2210.03629v3</id><title>ReAct: Test &amp; Metadata</title><author><name>Test Author</name></author><summary>Abstract only</summary><published>2022-10-01</published></entry></feed>';
  assert.equal(parseArxiv(xml)[0].title, 'ReAct: Test & Metadata');
  const calls = [];
  const research = new PublicResearch(async url => { calls.push(url); return { fetched_at: 'test', text: url.includes('arxiv') ? xml : JSON.stringify({ message: { items: [{ title: ['Wrong candidate'], DOI: '10.1234/test', author: [] }] } }) }; });
  assert.equal((await research.papers({ query: '2210.03629' })).results[0].arxiv_id, '2210.03629v3');
  await research.papers({ query: '2210.03629' });
  assert.equal(calls.length, 1);
  assert.match((await research.papers({ source: 'crossref', query: 'ReAct' })).results[0].verification, /候选/);
  const failed = new PublicResearch(async () => { throw new Error('HTTP 429'); });
  await assert.rejects(failed.papers({ query: 'Test' }), /429/);
  assert.equal(htmlText('<script>secret()</script><p>Visible &amp; text</p>'), 'Visible & text');
});

test('inbox blocks traversal, unsupported credentials and arbitrary paths; reads text', async context => {
  const root = fixture(context);
  mkdirSync(path.join(root, 'inbox'));
  writeFileSync(path.join(root, 'inbox', 'test.txt'), 'Fictional test only');
  writeFileSync(path.join(root, 'inbox', 'auth.json'), '{}');
  writeFileSync(path.join(root, 'outside.txt'), 'outside');
  assert.throws(() => inboxPath(root, '../outside.txt'), /inbox/);
  assert.throws(() => inboxPath(root, path.join(root, 'outside.txt')), /相对/);
  assert.throws(() => inboxPath(root, 'auth.json'), /凭据/);
  assert.throws(() => inboxPath(root, 'test.txt:alternate'), /相对/);
  assert.equal((await readDocument(root, 'test.txt')).text, 'Fictional test only');
});

test('inbox rejects junction traversal, including a relocated inbox root', context => {
  const root = fixture(context);
  const outside = fixture(context);
  mkdirSync(path.join(root, 'inbox'));
  writeFileSync(path.join(outside, 'outside.txt'), 'not allowed');
  symlinkSync(outside, path.join(root, 'inbox', 'escape'), 'junction');
  assert.throws(() => inboxPath(root, 'escape/outside.txt'), /inbox/);
  const relocated = fixture(context);
  symlinkSync(outside, path.join(relocated, 'inbox'), 'junction');
  assert.throws(() => inboxPath(relocated, 'outside.txt'), /工作区外/);
});

test('relevant memory domains match Chinese career/fitness/finance prompts', () => {
  assert.ok(relevantDomains('面试和工资规划').includes('career'));
  assert.ok(relevantDomains('面试和工资规划').includes('finance'));
  assert.ok(relevantDomains('体重和论文').includes('fitness'));
  assert.ok(relevantDomains('体重和论文').includes('learning'));
});
