import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LifeStore, today } from '../store.mjs';
import { LocalActions } from '../local-actions.mjs';
import { planTraining, performedFocuses, trainingFeedbackText } from '../training.mjs';
import { parseTrainingImport, validateTrainingRecords } from '../training-import.mjs';

const past = days => new Date(Date.parse(`${today()}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const record = (overrides = {}) => ({ date: past(2), duration_minutes: 45, source: '虚构训练笔记', entries: [{ name: '自由卧推', focus: 'chest', sets: [{ reps: 8, load_kg: 40 }, { reps: 6, load_kg: 40, rir: 2 }] }], ...overrides });
const document = records => JSON.stringify({ format: 'pi-training-v1', records });
function fixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), 'life-import-test-')); const store = new LifeStore(root);
  context.after(() => { store.close(); const relative = path.relative(tmpdir(), root); if (relative.startsWith('life-import-test-') && !relative.includes(path.sep)) rmSync(root, { recursive: true, force: true }); });
  return { store, actions: new LocalActions(store) };
}

test('standalone records require no generated plan and keep unknown values unknown', async context => {
  const { store, actions } = fixture(context);
  const preview = actions.prepare('training_record', record());
  assert.equal(store.listTraining().length, 0); assert.match(preview.summary, /独立实际记录/); assert.match(preview.summary, /未记录/);
  const result = await actions.commit(preview.id); const saved = result.records[0];
  assert.equal(saved.plan.mode, 'recorded'); assert.equal(saved.plan.total_minutes, null); assert.deepEqual(saved.plan.exercises, []);
  assert.equal(saved.actual.independent, true); assert.equal(saved.actual.energy, 'unknown'); assert.equal(saved.actual.discomfort, 'unknown');
  assert.equal(saved.actual.entries[0].sets[0].rir, null); assert.equal(saved.cloud_allowed, false); assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  assert.equal(store.listPlans().length, 0); assert.equal(store.listMetrics().length, 0);
  assert.equal((await actions.commit(preview.id)).records[0].id, saved.id); assert.equal(store.trainingHistory(saved.id).length, 1);
});

test('file consent is ignored and import commits one normalized atomic batch', async context => {
  const { store, actions } = fixture(context);
  const first = record({ cloud_allowed: true });
  const second = record({ date: past(1), entries: [{ name: '慢跑', focus: 'full_body', tracking_unit: 'seconds', sets: [{ seconds: 1800 }] }] });
  const preview = actions.prepare('training_import', { content: `\uFEFF${document([first, second])}` });
  assert.equal(store.listTraining().length, 0); assert.match(preview.summary, /1800秒/);
  const saved = (await actions.commit(preview.id)).records;
  assert.equal(saved.length, 2); assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  assert.equal(saved[1].actual.entries[0].sets[0].reps, null); assert.equal(saved[1].actual.entries[0].sets[0].load_kg, null);
  assert.equal(store.exportData().training_versions.length, 2); assert.equal(store.listMetrics().length, 0);
  assert.throws(() => actions.prepare('training_import', { content: document([first]) }), /重复导入/);
});

test('same-day reference plan is immutable when unrelated actual work is imported', async context => {
  const { store, actions } = fixture(context);
  const plan = planTraining({ split: 'five', day: 'legs', readiness: 'normal', yesterday: 'rest', minutes: 40 });
  const original = store.saveTraining(plan);
  const preview = actions.prepare('training_record', record({ date: today() }));
  assert.match(preview.summary, /不代表完成了原计划/);
  const saved = (await actions.commit(preview.id)).records[0];
  assert.equal(saved.id, original.id); assert.deepEqual(saved.plan, original.plan); assert.equal(saved.revision, 2);
  assert.deepEqual(performedFocuses(saved.plan, saved.actual), ['chest']); assert.match(trainingFeedbackText(saved), /胸部/);
  assert.equal(store.listTraining({ focus: 'chest' })[0].id, original.id);
  assert.equal(store.trainingHistory(saved.id)[1].actual, null);
});

test('invalid dates, future facts, invalid units, malformed sets and plans are rejected', () => {
  for (const content of ['broken', '[]', '{}', JSON.stringify({ format: 'pi-life-v3', records: [] }), 'a'.repeat(60001)]) assert.throws(() => parseTrainingImport(content));
  for (const row of [null, record({ date: '2026-02-30' }), record({ date: past(-1) }), record({ duration_minutes: 0 }), record({ status: 'planned' }), record({ recovery: {} }), record({ entries: [] }), record({ source: 'sk-abcdefghijklmnopqrstuvwxyz1234' })]) assert.throws(() => validateTrainingRecords([row]), /第1条/);
  for (const entry of [null, { name: '卧推', sets: [{ reps: 8 }] }, { name: '卧推', focus: 'chest', sets: [{ reps: '8' }] }, { name: '卧推', focus: 'chest', sets: [null] }, { name: '跑步', focus: 'full_body', tracking_unit: 'minutes', sets: [{ seconds: 20 }] }, { name: '卧推', focus: 'chest', sets: [{ reps: 8, seconds: 20 }] }, { name: '卧推', focus: 'chest', sets: [{ reps: 8, load_kg: -1 }] }]) assert.throws(() => validateTrainingRecords([record({ entries: [entry] })]));
  assert.throws(() => validateTrainingRecords([record(), record()]), /同一天/);
  assert.throws(() => validateTrainingRecords(Array.from({ length: 51 }, () => record())), /1—50/);
  assert.throws(() => validateTrainingRecords([record({ entries: [record().entries[0], { ...record().entries[0], name: ' 自由卧推 ' }] })]), /同一动作/);
});

test('cancellation, stale preview and database conflicts never leave partial imports', async context => {
  const { store, actions } = fixture(context);
  const cancelled = actions.prepare('training_record', record()); actions.cancel(cancelled.id);
  await assert.rejects(actions.commit(cancelled.id), /取消/); assert.equal(store.listTraining().length, 0);
  const next = record({ date: past(1) });
  const stale = actions.prepare('training_import', { content: document([record(), next]) });
  const saved = store.saveTrainingRecords([next])[0];
  await assert.rejects(actions.commit(stale.id), /已改变/);
  assert.equal(store.listTraining().length, 1); assert.equal(store.trainingOnDate(record().date), null);
  assert.throws(() => store.saveTrainingRecords([record(), next]), /重复导入/);
  assert.equal(store.listTraining().length, 1); assert.equal(store.trainingHistory(saved.id).length, 1);
  assert.equal(store.database.prepare('SELECT count(*) AS count FROM audit WHERE entity=?').get('training').count, 1);
});

test('confirmed sharing, corrections, recovery and deletion preserve provenance and privacy', async context => {
  const { store, actions } = fixture(context);
  const preview = actions.prepare('training_import', { content: document([record()]), cloud_allowed: true });
  assert.match(preview.warnings.join(''), /你已勾选共享/);
  const saved = (await actions.commit(preview.id)).records[0]; assert.equal(store.listTraining({ cloudOnly: true }).length, 1);
  const recovered = store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { chest: 'mild' }, cloud_allowed: true }, saved.revision);
  const changed = actions.prepare('training_log', { id: saved.id, expected_revision: recovered.revision, ...saved.actual, cloud_allowed: false, source: '不能偷偷更改来源', entries: [{ exercise_id: 'custom', name: '自由深蹲', focus: 'legs', sets: [{ reps: 8 }] }] });
  assert.match(changed.warnings.join(''), /重新填写/);
  const revised = (await actions.commit(changed.id)).record;
  assert.equal(revised.actual.source, '虚构训练笔记'); assert.equal(revised.actual.recovery, undefined); assert.deepEqual(performedFocuses(revised.plan, revised.actual), ['legs']);
  assert.equal(store.listTraining({ cloudOnly: true }).length, 0); assert.ok(store.trainingHistory(saved.id).every(row => !row.cloud_allowed));
  assert.throws(() => store.saveTrainingLog(saved.id, saved.actual, saved.revision), /已改变/);
  await actions.commit(actions.prepare('training_delete', { id: saved.id, expected_revision: revised.revision }).id);
  assert.equal(store.exportData().training_sessions.length, 0); assert.equal(store.exportData().training_versions.length, 0);
});

test('later plans use recorded muscles and recovery, never guess exercise catalog identity', context => {
  const { store } = fixture(context);
  const saved = store.saveTrainingRecords([record({ date: past(1), entries: [{ name: '器械推胸', focus: 'chest', sets: [{ reps: 8, load_kg: 40, rir: 4 }] }] })])[0];
  const next = planTraining({ split: 'five', day: 'chest', readiness: 'normal', yesterday: 'rest', minutes: 40 }, { history: store.listTraining() });
  assert.equal(next.mode, 'recovery'); assert.equal(next.history_basis.session_id, saved.id); assert.deepEqual(next.adaptations, []);
  store.saveTrainingRecovery(saved.id, { fatigue: 'exhausted', soreness: { chest: 'none' } }, saved.revision);
  const legs = planTraining({ split: 'five', day: 'legs', readiness: 'normal', yesterday: 'rest', minutes: 40 }, { history: store.listTraining() });
  assert.equal(legs.mode, 'recovery');
});
