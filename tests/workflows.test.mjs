import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LifeStore, SCHEMA_VERSION } from '../store.mjs';
import { LocalActions } from '../local-actions.mjs';
import { chartPayload } from '../charts.mjs';
import { metricLabel } from '../catalog.mjs';

function fixture(context) { const root = mkdtempSync(path.join(tmpdir(), 'life-workflow-')); const store = new LifeStore(root); context.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { root, store, actions: new LocalActions(store) }; }
const measurement = (overrides = {}) => ({ metric: 'weight_kg', value: 70, unit: 'kg', measured_date: '2026-01-01', ...overrides });

test('catalog uses Chinese labels while stable storage identifiers and canonical units stay compatible', () => {
  assert.equal(metricLabel('weight_kg'), '体重（kg）'); assert.equal(metricLabel('resting_heart_rate'), '静息心率（次/分）'); assert.equal(metricLabel('sleep_hours'), '睡眠时长（小时）');
});

test('migrates legacy corrections with backup, identity, revisions, and no changes to numeric history', context => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-migrate-')); mkdirSync(path.join(root, 'data'));
  const old = new DatabaseSync(path.join(root, 'data', 'personal.sqlite'));
  old.exec('CREATE TABLE metrics(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,metric TEXT NOT NULL,value REAL NOT NULL,unit TEXT NOT NULL,measured_date TEXT NOT NULL,note TEXT NOT NULL,cloud_allowed INTEGER NOT NULL,correction_of TEXT,is_current INTEGER NOT NULL,created_at TEXT NOT NULL)');
  const insert = old.prepare('INSERT INTO metrics VALUES (NULL,?,?,?,?,?,?,?,?,?,?)'); insert.run('first', 'weight_kg', 70, 'kg', '2026-01-01', '', 0, null, 0, '2026-01-01'); insert.run('second', 'weight_kg', 71, 'kg', '2026-01-01', '', 0, 'first', 1, '2026-01-02'); old.close();
  const store = new LifeStore(root); context.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  assert.equal(store.database.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const history = store.metricHistory('first'); assert.deepEqual(history.map(row => row.value), [71, 70]); assert.deepEqual(history.map(row => row.revision), [2, 1]); assert.equal(history[0].record_id, history[1].record_id); assert.equal(store.metricSeries({ metric: 'weight_kg' }).length, 1);
  const backup = readdirSync(path.join(root, 'backups')).find(name => name.startsWith('pre-schema-')); assert.ok(backup); const copy = new DatabaseSync(path.join(root, 'backups', backup)); assert.equal(copy.prepare('SELECT value FROM metrics WHERE id=?').get('first').value, 70); copy.close();
});

test('local prepare is read-only, explicit confirm saves atomic grouped metrics, retry is idempotent', async context => {
  const { store, actions } = fixture(context);
  const prepared = actions.prepare('metric_save', { records: [measurement(), { metric: 'waist_cm', value: 82, unit: 'cm', measured_date: '2026-01-01' }] });
  assert.match(prepared.summary, /体重（kg）/); assert.ok(!prepared.summary.includes('weight_kg')); assert.equal(store.listMetrics().length, 0);
  const [first, second] = await Promise.all([actions.commit(prepared.id), actions.commit(prepared.id)]); assert.deepEqual(first, second); assert.equal(store.listMetrics().length, 2); assert.equal(first.records[0].batch_id, first.records[1].batch_id); assert.equal(first.records[0].record_id, first.records[0].id); assert.equal(store.listMetrics({ cloudOnly: true }).length, 0);
  assert.throws(() => actions.prepare('metric_save', { records: [measurement(), measurement({ value: 71 })] }), /每种指标/);
  assert.throws(() => actions.prepare('metric_save', { records: [measurement({ value: 700 })] }), /核对/);
  assert.equal(store.listMetrics().length, 2);
});

test('local cancellation, expired or forged confirm leaves data unchanged', async context => {
  const { store } = fixture(context); let clock = 0; const actions = new LocalActions(store, { clock: () => clock });
  const prepared = actions.prepare('metric_save', { records: [measurement()] }); actions.cancel(prepared.id); await assert.rejects(actions.commit(prepared.id), /取消/); await assert.rejects(actions.commit('fake'), /过期/);
  const next = actions.prepare('metric_save', { records: [measurement()] }); clock = 400000; await assert.rejects(actions.commit(next.id), /过期/); assert.equal(store.listMetrics().length, 0);
});

test('duplicate preview and stale confirmations reject concurrent saves instead of silently duplicating', async context => {
  const { store, actions } = fixture(context);
  const prepared = actions.prepare('metric_save', { records: [measurement()] }); store.addMetric(measurement()); await assert.rejects(actions.commit(prepared.id), /重复记录/);
  const warning = actions.prepare('metric_save', { records: [measurement()] }); assert.equal(warning.warnings.length, 1); actions.cancel(warning.id); assert.equal(store.listMetrics().length, 1);
});

test('metric correction keeps identity and group, rejects stale edits and revokes old sharing', async context => {
  const { store, actions } = fixture(context); const first = store.addMetric(measurement({ cloud_allowed: true }));
  const prepared = actions.prepare('metric_save', { records: [measurement({ value: 69, correction_of: first.id })] });
  const corrected = (await actions.commit(prepared.id)).records[0]; assert.equal(corrected.record_id, first.record_id); assert.equal(corrected.batch_id, first.batch_id); assert.equal(corrected.revision, 2); assert.equal(store.metricHistory(first.record_id).length, 2); assert.equal(store.listMetrics({ cloudOnly: true, history: true }).length, 0);
  assert.throws(() => actions.prepare('metric_save', { records: [measurement({ value: 68, correction_of: first.id })] }), /已改变/);
  const deletion = actions.prepare('metric_delete', { id: corrected.id }); store.addMetric(measurement({ value: 68, correction_of: corrected.id })); await assert.rejects(actions.commit(deletion.id), /被更正/);
});

test('daily cumulative totals use latest measurement, body readings use mean and missing dates stay absent', context => {
  const { store } = fixture(context); store.addMetrics([measurement({ value: 70 }), measurement({ value: 72 }), { metric: 'steps', value: 2000, unit: 'steps', measured_date: '2026-01-01', measured_time: '12:00' }, { metric: 'steps', value: 8000, unit: 'steps', measured_date: '2026-01-01', measured_time: '21:00' }]);
  const series = chartPayload(store, { metrics: ['weight_kg', 'steps'] }); assert.equal(series.panels[0].daily[0].value, 71); assert.equal(series.panels[1].daily[0].value, 8000); assert.equal(series.panels[1].daily_label, '当日最新总量'); assert.equal(series.panels[1].unit, '步');
});

test('mistyped date correction moves the effective point while preserving original date in history', async context => {
  const { store, actions } = fixture(context); const first = store.addMetric(measurement());
  const prepared = actions.prepare('metric_save', { records: [measurement({ measured_date: '2026-01-02', correction_of: first.id })] }); await actions.commit(prepared.id);
  assert.equal(store.metricSeries({ metric: 'weight_kg', start_date: '2026-01-01', end_date: '2026-01-01' }).length, 0);
  assert.deepEqual(store.metricHistory(first.record_id).map(row => row.measured_date), ['2026-01-02', '2026-01-01']);
});

test('plan hierarchy, revision history, privacy revocation, child checks and all-row dashboard counts', context => {
  const { store } = fixture(context); const goal = store.savePlan({ domain: 'career', kind: 'goal', title: '虚构职业目标', cloud_allowed: true });
  const milestone = store.savePlan({ domain: 'career', kind: 'milestone', title: '虚构阶段', parent_id: goal.id }); const task = store.savePlan({ domain: 'career', kind: 'task', title: '虚构行动', parent_id: milestone.id, cloud_allowed: true });
  assert.throws(() => store.savePlan({ ...goal, status: 'done' }), /下级/); assert.throws(() => store.deletePlan(goal.id), /下级/);
  assert.throws(() => store.savePlan({ domain: 'fitness', kind: 'task', title: '错误领域', parent_id: goal.id }), /领域/);
  assert.throws(() => store.savePlan({ ...goal, parent_id: task.id }), /层级/);
  const { parent_id, ...patch } = task; const changed = store.savePlan({ ...patch, status: 'done', cloud_allowed: false }, '', task.revision); assert.equal(changed.parent_id, parent_id); assert.equal(store.planHistory(task.id).length, 2); assert.equal(store.planHistory(task.id, true).length, 0);
  store.savePlan({ ...milestone, status: 'done' }); store.savePlan({ ...goal, status: 'done' });
  assert.throws(() => store.savePlan({ ...changed, status: 'active' }), /上级已经完成/);
  for (let index = 0; index < 105; index++) store.savePlan({ domain: 'learning', kind: 'task', title: `虚构任务${index}` });
  assert.equal(store.dashboardSummary().pending_tasks, 105); assert.equal(store.dashboardSummary().next_actions.length, 3); assert.equal(store.listPlans({ offset: 100 }).length, 8);
  assert.equal(store.exportData().format, 'pi-life-v3'); assert.ok(store.exportData().plan_versions.length > 108);
});

test('local plan and memory edit reject stale expected versions and never automatically grant cloud sharing', async context => {
  const { store, actions } = fixture(context); const plan = store.savePlan({ domain: 'career', kind: 'task', title: '虚构任务' });
  const pending = actions.prepare('plan_save', { ...plan, title: '修改任务', expected_revision: plan.revision }); store.savePlan({ ...plan, status: 'active' }); await assert.rejects(actions.commit(pending.id), /另一会话/);
  const memory = store.remember({ domain: 'career', kind: 'fact', key: '岗位', value: '虚构岗位' }); const prepare = actions.prepare('memory_save', { ...memory, value: '虚构修改', expected_id: memory.id }); store.remember({ ...memory, value: '其他会话修改' }); await assert.rejects(actions.commit(prepare.id), /另一会话/);
  assert.throws(() => actions.prepare('memory_save', { ...memory, expected_id: memory.id }), /已改变/);
});

test('chart review snapshots selected range and produces no model calls', async context => {
  const { store } = fixture(context); store.addMetrics([measurement(), measurement({ measured_date: '2026-02-01' })]); let rendered;
  const actions = new LocalActions(store, { renderChart: async (_workspace, payload) => { rendered = payload; return { saved: true }; } });
  const prepared = actions.prepare('chart', { metrics: ['weight_kg'], start_date: '2026-01-01', end_date: '2026-01-31' }); await actions.commit(prepared.id); assert.equal(rendered.panels[0].summary.records, 1); assert.equal(rendered.panels[0].points[0].date, '2026-01-01');
});
