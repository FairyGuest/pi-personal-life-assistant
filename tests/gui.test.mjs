import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLifeServer, safeChartFile } from '../gui/server.mjs';
import { jsonLines, PiBridge, messageView } from '../gui/rpc.mjs';
import { chartPayload } from '../charts.mjs';
import { LifeStore } from '../store.mjs';

class FakeBridge extends EventEmitter {
  async start() { return this; }
  snapshot() { return { state: { sessionId: 'test', connected: true }, messages: [], dialogs: [], notifications: [] }; }
  async sessions() { return []; }
  async command(type) { if (!['new', 'rename', 'prompt', 'switch'].includes(type)) throw new Error('不支持此操作。'); return {}; }
  respond() { throw new Error('确认已经失效。'); }
  async abort() {}
  stop() { this.closed = true; }
}

test('RPC framing preserves split UTF8, U+2028 and U+2029 without treating them as newlines', () => {
  const values = []; const errors = [];
  const parse = jsonLines(value => values.push(value), error => errors.push(error));
  const buffer = Buffer.from(`${JSON.stringify({ text: '体重\u2028腰围\u2029🙂' })}\n${JSON.stringify({ value: 4 })}\r\n`);
  for (const byte of buffer) parse(Buffer.from([byte]));
  assert.deepEqual(values, [{ text: '体重\u2028腰围\u2029🙂' }, { value: 4 }]); assert.equal(errors.length, 0);
  parse(Buffer.from('invalid\n')); assert.equal(errors.length, 1);
});

test('message projection hides internal memory snapshots, reasoning, and tool arguments', () => {
  assert.equal(messageView({ role: 'life-personal-context', content: [{ type: 'text', text: 'private' }] }), null);
  assert.equal(messageView({ role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'toolCall', arguments: { secret: 'hidden' } }, { type: 'text', text: '<img onerror=alert(1)>安全文本' }] }).text, '<img onerror=alert(1)>安全文本');
});

test('read-only dashboard can represent an empty store, but exported chart still refuses fake empty data', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-ui-empty-')); const store = new LifeStore(root);
  try { assert.throws(() => chartPayload(store, {}), /没有有效测量/); assert.equal(chartPayload(store, {}, { allowEmpty: true }).panels[0].daily.length, 0); }
  finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('local HTTP requires launch token, same origin and CSRF header; no arbitrary RPC or file access', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-ui-http-')); const bridge = new FakeBridge(); const app = await createLifeServer({ workspace: root, bridge });
  const headers = { 'Content-Type': 'application/json', Origin: app.origin };
  const post = async (route, body, extra = {}) => fetch(`${app.origin}${route}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${app.origin}/api/dashboard`)).status, 401);
    assert.equal((await post('/api/connect', { token: 'wrong' })).status, 401);
    assert.equal((await post('/api/connect', { token: app.token }, { Origin: 'https://evil.example' })).status, 403);
    const login = await post('/api/connect', { token: app.token }); assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const authenticated = { Cookie: cookie, 'X-Life-Token': app.token };
    assert.equal((await post('/api/fitness/bmi', { height_cm: 187, weight_kg: 80 }, { Cookie: cookie })).status, 403);
    const localBmi = await post('/api/fitness/bmi', { height_cm: 187, weight_kg: 80 }, authenticated); assert.equal((await localBmi.json()).bmi, 22.9);
    const localWorkout = await post('/api/fitness/workout', { split: 'five', day: 'chest', readiness: 'red_flags' }, authenticated); assert.equal((await localWorkout.json()).can_save, false);
    const grouped = await post('/api/fitness/workout', { split: 'five', day: 'back', focuses: ['back', 'shoulders'], equipment: 'dumbbells', readiness: 'normal', yesterday: 'rest' }, authenticated); const guided = await grouped.json(); assert.deepEqual(guided.focuses, ['back', 'shoulders']); assert.ok(guided.exercises.some(item => item.focus === 'shoulders')); assert.ok(guided.exercises[0].sets && guided.exercises[0].cues);
    assert.equal((await fetch(`${app.origin}/api/training-history?id=unknown`)).status, 401);
    assert.equal((await post('/api/fitness/workout', { minutes: 0 }, authenticated)).status, 400);
    const dashboard = await fetch(`${app.origin}/api/dashboard`, { headers: { Cookie: cookie } }); assert.equal(dashboard.status, 200); const data = await dashboard.json(); assert.deepEqual(data.memory, []); assert.equal(data.skills.length, 6);
    const series = await fetch(`${app.origin}/api/series`, { headers: { Cookie: cookie } }); assert.equal(series.status, 200); assert.deepEqual((await series.json()).panels[0].raw_points, []);
    assert.equal((await post('/api/command', { type: 'new' }, { Cookie: cookie })).status, 403);
    assert.equal((await post('/api/command', { type: 'new' }, { ...authenticated, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/command', { type: 'bash', command: 'echo bad' }, authenticated)).status, 400);
    assert.equal((await post('/api/dialog', { id: 'forged', confirmed: true }, authenticated)).status, 400);
    assert.equal((await post('/api/command', { type: 'new' }, authenticated)).status, 200);
    assert.equal((await post('/api/local/prepare', { action: 'metric_save', input: { records: [{ metric: 'weight_kg', value: 70, unit: 'kg' }] } }, { Cookie: cookie })).status, 403);
    const preview = await post('/api/local/prepare', { action: 'metric_save', input: { records: [{ metric: 'weight_kg', value: 70, unit: 'kg' }] } }, authenticated); assert.equal(preview.status, 200); const proposal = await preview.json(); assert.match(proposal.summary, /体重（kg）/);
    const beforeSave = await fetch(`${app.origin}/api/metrics`, { headers: { Cookie: cookie } }); assert.equal((await beforeSave.json()).rows.length, 0);
    assert.equal((await post('/api/local/commit', { id: proposal.id }, { Cookie: cookie })).status, 403);
    assert.equal((await post('/api/local/commit', { id: 'forged' }, authenticated)).status, 400);
    assert.equal((await post('/api/local/commit', { id: proposal.id }, authenticated)).status, 200);
    assert.equal((await post('/api/local/prepare', { action: 'bash', input: {} }, authenticated)).status, 400);
    const page = await fetch(app.origin); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.ok(!(await page.text()).includes(app.token));
    assert.equal((await fetch(`${app.origin}/api/chart/auth.json`, { headers: { Cookie: cookie } })).status, 400);
    assert.equal((await post('/api/command', { type: 'new', oversized: 'a'.repeat(100001) }, authenticated)).status, 400);
    const streamAbort = new AbortController(); const events = await fetch(`${app.origin}/api/events`, { headers: { Cookie: cookie }, signal: streamAbort.signal }); assert.match(events.headers.get('content-type'), /text\/event-stream/); const first = await events.body.getReader().read(); assert.match(Buffer.from(first.value).toString(), /snapshot/); streamAbort.abort();
  } finally { await app.close(); await new Promise(resolve => setTimeout(resolve, 50)); rmSync(root, { recursive: true, force: true }); }
});

test('chart serving refuses traversal and junction escape', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-ui-chart-')); const outside = mkdtempSync(path.join(tmpdir(), 'life-ui-outside-'));
  try {
    mkdirSync(path.join(root, 'charts')); writeFileSync(path.join(root, 'charts', 'metrics-test.png'), 'fake');
    assert.equal(safeChartFile(root, 'metrics-test.png'), path.join(root, 'charts', 'metrics-test.png'));
    assert.throws(() => safeChartFile(root, '../auth.json'), /无效/);
    rmSync(path.join(root, 'charts'), { recursive: true, force: true }); symlinkSync(outside, path.join(root, 'charts'), 'junction'); writeFileSync(path.join(outside, 'metrics-test.png'), 'fake');
    assert.throws(() => safeChartFile(root, 'metrics-test.png'), /指向/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('bridge dialogs require a live matching request, cannot be forged or answer invalid options', () => {
  const bridge = new PiBridge(); const written = []; bridge.child = { stdin: { write: value => written.push(JSON.parse(value)) } };
  try {
    assert.throws(() => bridge.respond('missing', { confirmed: true }), /失效/);
    bridge.receive({ type: 'extension_ui_request', id: 'test', method: 'select', options: ['本地', '共享'], timeout: 2000 });
    assert.throws(() => bridge.respond('test', { confirmed: true }), /无效/);
    assert.throws(() => bridge.respond('test', { value: 'fake' }), /无效/);
    bridge.respond('test', { value: '本地' }); assert.deepEqual(written[0], { type: 'extension_ui_response', id: 'test', value: '本地' });
    assert.throws(() => bridge.respond('test', { value: '共享' }), /失效/);
  } finally { bridge.clearDialogs(); }
});

test('GUI bridge command allowlist rejects shell, external attachments, arbitrary models and busy-session switches', async () => {
  const bridge = new PiBridge(); bridge.request = async () => ({}); bridge.refresh = async () => {};
  await assert.rejects(bridge.command('bash', { command: 'echo bad' }), /不支持/);
  for (const message of ['!echo bad', '@secret.txt', '/model anthropic', '/skill:arbitrary hi']) await assert.rejects(bridge.command('prompt', { message }), /不接受/);
  await assert.rejects(bridge.command('switch', { sessionId: '../escape' }), /无效/);
  bridge.busy = true; await assert.rejects(bridge.command('new'), /先完成/);
  bridge.busy = false; bridge.dialogs.set('pending', {}); await assert.rejects(bridge.command('new'), /先完成/);
  bridge.dialogs.clear(); bridge.state.sessionId = 'current'; await assert.rejects(bridge.command('prompt', { message: 'hello', expectedSessionId: 'stale' }), /其他窗口/);
});
