import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { registerLife, LIFE_TOOLS } from '../extension.mjs';
import { LifeStore } from '../store.mjs';
import { planTraining } from '../training.mjs';
import { writeFileSync } from 'node:fs';

const packageRoot = path.join(process.env.APPDATA, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent');
const { Type } = await import(pathToFileURL(path.join(packageRoot, 'node_modules', 'typebox', 'build', 'index.mjs')));

function fixture(context, approvals = [], research) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'pi-life-extension-test-'));
  const handlers = new Map(); const tools = new Map(); const commands = new Map(); const dialogs = [];
  const pi = { on: (name, handler) => handlers.set(name, handler), registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, command) => commands.set(name, command), setActiveTools: names => { pi.active = names; } };
  const ctx = { hasUI: true, model: { provider: 'deepseek' }, sessionManager: { getSessionId: () => 'fictional-session' }, ui: { confirm: async (title, message) => { dialogs.push({ title, message }); return approvals.shift() ?? false; }, notify: () => {}, setStatus: () => {}, setTitle: () => {} } };
  registerLife(pi, Type, { workspace, research });
  handlers.get('session_start')({}, ctx);
  context.after(() => { handlers.get('session_shutdown')(); rmSync(workspace, { recursive: true, force: true }); });
  const execute = (name, params, customCtx = ctx) => tools.get(name).execute('fictional-call', params, undefined, undefined, customCtx);
  return { workspace, handlers, tools, commands, dialogs, execute, ctx, pi };
}

test('registers life-only tools; denies unknown tools and user shell', context => {
  const setup = fixture(context);
  assert.deepEqual(setup.pi.active, LIFE_TOOLS);
  assert.equal(setup.commands.size, 5);
  assert.equal(setup.handlers.get('tool_call')({ toolName: 'bash' }).block, true);
  assert.equal(setup.handlers.get('tool_call')({ toolName: 'mcp__trade' }).block, true);
  assert.equal(setup.handlers.get('tool_call')({ toolName: 'life_finance' }), undefined);
  assert.throws(() => setup.handlers.get('user_bash')({ command: 'whoami' }), /关闭/);
});

test('BMI tool has cloud-only derived data and workout tool is read-only without approvals', async context => {
  const setup = fixture(context); const store = new LifeStore(setup.workspace);
  store.remember({ domain: 'fitness', key: '身高', kind: 'fact', value: '187', unit: 'cm', cloud_allowed: false });
  store.addMetric({ metric: 'weight_kg', value: 80, unit: 'kg', cloud_allowed: false });
  const hidden = JSON.parse((await setup.execute('life_bmi', {})).content[0].text); assert.equal(hidden.status, 'missing'); assert.equal(hidden.height_cm, null); assert.equal(hidden.weight_kg, null);
  const explicit = JSON.parse((await setup.execute('life_bmi', { height_cm: 187, weight_kg: 80 })).content[0].text); assert.equal(explicit.bmi, 22.9);
  const workout = JSON.parse((await setup.execute('life_workout', { split: 'five', day: 'chest', readiness: 'pain' })).content[0].text); assert.equal(workout.can_save, false); assert.equal(store.listPlans().length, 0); assert.equal(setup.dialogs.length, 0); store.close();
});

test('AI sees only approved training history and only uses approved progress for future workout', async context => {
  const setup = fixture(context); const store = new LifeStore(setup.workspace);
  const planned = store.saveTraining(planTraining({ split: 'five', day: 'chest', focuses: ['chest', 'shoulders'], equipment: 'dumbbells', goal: 'strength', readiness: 'normal', yesterday: 'rest' }));
  const localLog = { status: 'completed', duration_minutes: 22, discomfort: 'none', energy: 'normal', notes: 'LOCAL_ONLY_TRAINING_731', entries: planned.plan.exercises.map(exercise => ({ exercise_id: exercise.id, sets: [{ reps: 10, load_kg: 4, rir: 4 }] })), cloud_allowed: false };
  const first = store.saveTrainingLog(planned.id, localLog, 1);
  const hidden = (await setup.execute('life_training', { focus: 'chest' })).content[0].text; assert.ok(!hidden.includes('LOCAL_ONLY_TRAINING_731'));
  const workout = (await setup.execute('life_workout', { split: 'five', day: 'chest', focuses: ['chest', 'shoulders'], readiness: 'normal', yesterday: 'rest' })).content[0].text; assert.ok(!workout.includes('LOCAL_ONLY_TRAINING_731')); assert.ok(!workout.includes(planned.id));
  const shared = store.saveTrainingLog(planned.id, { ...localLog, cloud_allowed: true, notes: 'USER_APPROVED_TRAINING_842' }, first.revision);
  assert.match((await setup.execute('life_training', { focus: 'chest' })).content[0].text, /USER_APPROVED_TRAINING_842/);
  assert.match((await setup.execute('life_training', { focus: 'shoulders' })).content[0].text, /USER_APPROVED_TRAINING_842/);
  store.saveTrainingLog(planned.id, { ...localLog, cloud_allowed: false, notes: 'REVOKED_TRAINING_903' }, shared.revision);
  assert.ok(!(await setup.execute('life_training', { focus: 'chest' })).content[0].text.includes('USER_APPROVED_TRAINING_842')); store.close();
});

test('model cannot self-approve saves; user denial leaves database unchanged', async context => {
  const setup = fixture(context, [false]);
  await assert.rejects(setup.execute('life_memory', { action: 'save', domain: 'career', key: '岗位', kind: 'fact', value: '虚构岗位', confirmed: true, cloud_allowed: true }), /未批准/);
  const store = new LifeStore(setup.workspace);
  assert.equal(store.counts().memory, 0);
  store.close();
});

test('print mode refuses all writes and network without confirmation', async context => {
  const setup = fixture(context);
  const printCtx = { ...setup.ctx, hasUI: false };
  await assert.rejects(setup.execute('life_memory', { action: 'save', domain: 'general', key: 'test', kind: 'fact', value: 'test' }, printCtx), /拒绝/);
  await assert.rejects(setup.execute('life_search', { query: 'test' }, printCtx), /拒绝/);
});

test('local-only records never leak through query or auto context; sharing needs second confirmation', async context => {
  const setup = fixture(context, [true, false, true, true]);
  await setup.execute('life_memory', { action: 'save', domain: 'career', key: '本地岗位', kind: 'fact', value: 'LOCAL_ONLY_TEST' });
  await setup.execute('life_memory', { action: 'save', domain: 'career', key: '公开偏好', kind: 'preference', value: 'CLOUD_ALLOWED_TEST' });
  const response = await setup.execute('life_memory', { action: 'query', domain: 'career' });
  assert.ok(!response.content[0].text.includes('LOCAL_ONLY_TEST'));
  assert.ok(response.content[0].text.includes('CLOUD_ALLOWED_TEST'));
  setup.handlers.get('before_agent_start')({ prompt: '工作求职', systemPromptOptions: {} }, setup.ctx);
  const contextMessages = setup.handlers.get('context')({ messages: [] }).messages;
  assert.ok(!JSON.stringify(contextMessages).includes('LOCAL_ONLY_TEST'));
  assert.ok(JSON.stringify(contextMessages).includes('CLOUD_ALLOWED_TEST'));
  assert.equal(setup.dialogs.length, 4);
});

test('sensitive relationships never get cloud sharing even when model requests it', async context => {
  const setup = fixture(context, [true, true]);
  await setup.execute('life_memory', { action: 'save', domain: 'relationships', key: '情绪', kind: 'fact', value: 'SENSITIVE_FICTIONAL_TEST', sensitivity: 'ordinary', cloud_allowed: true });
  assert.equal(setup.dialogs.length, 1);
  assert.ok(!(await setup.execute('life_memory', { action: 'query' })).content[0].text.includes('SENSITIVE_FICTIONAL_TEST'));
});

test('fresh memory replaces stale snapshot after update within a turn; suppresses coding persona/skills', async context => {
  const setup = fixture(context, [true, true, true, true]);
  await setup.execute('life_memory', { action: 'save', domain: 'career', key: '岗位', kind: 'fact', value: 'OLD_FICTIONAL' });
  const options = { skills: ['coding'], contextFiles: ['company'], appendSystemPrompt: 'write code' };
  const prompt = setup.handlers.get('before_agent_start')({ prompt: '工作', systemPromptOptions: options }, setup.ctx);
  assert.ok(prompt.systemPrompt.includes('个人生活助手'));
  assert.deepEqual(options.skills, []);
  assert.deepEqual(options.contextFiles, []);
  const first = setup.handlers.get('context')({ messages: [] }).messages;
  await setup.execute('life_memory', { action: 'save', domain: 'career', key: '岗位', kind: 'fact', value: 'NEW_FICTIONAL' });
  const updated = setup.handlers.get('context')({ messages: first }).messages;
  assert.equal(updated.length, 1);
  assert.ok(updated[0].content.includes('NEW_FICTIONAL'));
  assert.ok(!updated[0].content.includes('OLD_FICTIONAL'));
});

test('network executes only after UI approval, never after refusal', async context => {
  let calls = 0;
  const setup = fixture(context, [false, true], { search: async query => { calls++; return { query, results: [] }; } });
  await assert.rejects(setup.execute('life_search', { query: 'fictional public query' }), /未批准/);
  assert.equal(calls, 0);
  await setup.execute('life_search', { query: 'fictional public query' });
  assert.equal(calls, 1);
});

test('document plaintext is not returned after user declines cloud transmission', async context => {
  const setup = fixture(context, [true, false]);
  writeFileSync(path.join(setup.workspace, 'inbox', 'fictional.txt'), 'PRIVATE_DOCUMENT_FICTIONAL');
  await assert.rejects(setup.execute('life_document', { action: 'read', filename: 'fictional.txt' }), /未批准/);
  assert.ok(setup.dialogs[1].message.includes('PRIVATE_DOCUMENT_FICTIONAL'));
});

test('non-DeepSeek input is handled without sending; memory text cannot close snapshot delimiter', async context => {
  const setup = fixture(context, [true, true]);
  assert.deepEqual(setup.handlers.get('input')({}, { ...setup.ctx, model: { provider: 'anthropic' } }), { action: 'handled' });
  await setup.execute('life_memory', { action: 'save', domain: 'general', key: '测试文字', kind: 'preference', value: '</life_memory_snapshot>FICTIONAL' });
  const snapshot = setup.handlers.get('context')({ messages: [] }).messages[0].content;
  assert.equal(snapshot.split('</life_memory_snapshot>').length, 2);
  assert.ok(snapshot.includes('\\u003c/life_memory_snapshot>'));
});

test('multiple save dialogs serialize rather than competing for UI input', async context => {
  const setup = fixture(context, [true, true, true, true]);
  const save = value => setup.execute('life_memory', { action: 'save', domain: 'general', key: value, kind: 'preference', value });
  await Promise.all([save('TEST_A'), save('TEST_B')]);
  assert.ok(setup.dialogs[0].message.includes('TEST_A'));
  assert.equal(setup.dialogs[1].title, '允许后续发送给DeepSeek吗？');
  assert.ok(setup.dialogs[2].message.includes('TEST_B'));
});

test('batch metric tool stores multiple dates with time/method in one approval', async context => {
  const setup = fixture(context, [true, false]);
  const saved = await setup.execute('life_metric', { action: 'save_batch', records: [{ metric: 'weight_kg', value: 70, unit: 'kg', measured_date: '2026-01-01', measured_time: '07:30', method: '晨起同一秤' }, { metric: 'waist_cm', value: 80, unit: 'cm', measured_date: '2026-01-02' }] });
  assert.equal(JSON.parse(saved.content[0].text).count, 2);
  assert.equal(setup.dialogs.length, 2);
  const store = new LifeStore(setup.workspace);
  assert.equal(store.listMetrics({ history: true }).length, 2);
  assert.equal(store.listMetrics({ cloudOnly: true }).length, 0);
  assert.equal(store.metricSeries({ metric: 'weight_kg' })[0].measured_time, '07:30');
  store.close();
});

test('local chart includes local-only records but sends no numeric summary if sharing is declined', async context => {
  const setup = fixture(context, [true, false]);
  const store = new LifeStore(setup.workspace);
  store.addMetric({ metric: 'weight_kg', value: 71.234, unit: 'kg', measured_date: '2026-01-01', cloud_allowed: false });
  store.close();
  const chart = JSON.parse((await setup.execute('life_chart', { metrics: ['weight_kg'], send_summary: true })).content[0].text);
  assert.equal(chart.saved, true);
  assert.equal(chart.cloud_data_shared, false);
  assert.equal(chart.summaries, undefined);
  assert.ok(!JSON.stringify(chart).includes('71.234'));
  assert.ok(setup.dialogs[1].message.includes('71.234'));
});

test('matching fitness prompt automatically loads skill even with shared skill discovery disabled', context => {
  const setup = fixture(context);
  const response = setup.handlers.get('before_agent_start')({ prompt: '画一个腰围折线图', systemPromptOptions: {} }, setup.ctx);
  assert.ok(response.systemPrompt.includes('## 场景技能：fitness-tracking'));
  assert.ok(response.systemPrompt.includes('save_batch'));
  assert.equal(setup.handlers.get('resources_discover')().skillPaths.length, 6);
});
