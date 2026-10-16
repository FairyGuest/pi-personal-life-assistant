import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LifeStore, SCHEMA_VERSION, today } from '../store.mjs';
import { FOCUS_LABELS, planTraining, trainingFeedbackText, validateTrainingLog, validateTrainingRecovery } from '../training.mjs';
import { LocalActions } from '../local-actions.mjs';

function fixture(context) { const root = mkdtempSync(path.join(tmpdir(), 'life-training-')); const store = new LifeStore(root); context.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { root, store, actions: new LocalActions(store) }; }
const request = (overrides = {}) => ({ split: 'custom', focus: 'legs', goal: 'strength', equipment: 'dumbbells', experience: 'beginner', minutes: 40, readiness: 'normal', yesterday: 'rest', ...overrides });
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const actual = (plan, overrides = {}) => ({ status: 'completed', duration_minutes: 31, discomfort: 'none', energy: 'normal', notes: '动作较稳，注意恢复', entries: plan.exercises.map(item => ({ exercise_id: item.id, sets: [{ [item.tracking_unit === 'seconds' ? 'seconds' : 'reps']: 8, load_kg: 6, rir: 4 }, { [item.tracking_unit === 'seconds' ? 'seconds' : 'reps']: 9, load_kg: 6, rir: 3 }] })), cloud_allowed: false, ...overrides });

test('selected body part generates clear form cues, sets, reps and rest within time budget', () => {
  for (const focus of Object.keys(FOCUS_LABELS)) for (const equipment of ['none', 'dumbbells', 'gym']) for (const minutes of [10, 20, 30, 40, 60, 90]) {
    const plan = planTraining(request({ focus, equipment, minutes }));
    assert.equal(plan.focus, focus); assert.equal(plan.blocks.reduce((sum, block) => sum + block.minutes, 0), plan.total_minutes);
    assert.ok(plan.total_minutes <= minutes && plan.exercises.length >= 1 && plan.exercises.length <= 4);
    for (const item of plan.exercises) { assert.ok(item.name && item.cues && item.avoid); assert.ok(item.sets >= 1 && item.sets <= 4); assert.match(item.reps, /次|秒/); assert.ok(item.rest_seconds >= 60); }
  }
  assert.match(planTraining(request({ focus: 'back', equipment: 'none' })).warnings.join(''), /拉力动作/);
  assert.equal(planTraining(request({ focus: 'chest' })).exercises.some(item => /腿举|臀桥/.test(item.name)), false);
  assert.equal(planTraining(request({ focus: 'legs' })).exercises.some(item => /推胸|划船/.test(item.name)), false);
});

test('recovery and unsafe symptoms override selected focus; unknown history never becomes imaginary progress', () => {
  assert.throws(() => planTraining({ focus: 'chest' }), /训练分化/);
  assert.equal(planTraining(request({ focus: 'chest', readiness: 'unknown' })).mode, 'recovery');
  assert.equal(planTraining(request({ readiness: 'tired' })).exercises.length, 0);
  assert.equal(planTraining(request({ yesterday: 'hard' })).total_minutes, 20);
  for (const readiness of ['pain', 'ill', 'red_flags']) { const plan = planTraining(request({ readiness })); assert.equal(plan.can_save, false); assert.equal(plan.exercises.length, 0); assert.equal(plan.total_minutes, 0); }
  assert.match(planTraining(request({ readiness: 'red_flags' })).warnings[0], /120/);
  for (const invalid of [{ focus: 'other' }, { minutes: 91 }, { minutes: 10.5 }, { equipment: 'unknown' }]) assert.throws(() => planTraining(request(invalid)));
  assert.equal(planTraining(request()).history_basis, null); assert.deepEqual(planTraining(request()).adaptations, []);
  const timed = planTraining(request({ focus: 'core', equipment: 'none', experience: 'regular', minutes: 65 })).exercises.find(item => item.id === 'side_plank');
  assert.equal(timed.tracking_unit, 'seconds');
});

test('three and five splits suggest groups; selected chest and shoulders both receive distinct exercises', () => {
  const push = planTraining(request({ split: 'three', day: 'push', focus: undefined, minutes: 50 }));
  assert.deepEqual(push.focuses, ['chest', 'shoulders', 'arms']);
  assert.deepEqual(new Set(push.exercises.map(item => item.focus)), new Set(push.focuses));
  const pull = planTraining(request({ split: 'three', day: 'pull', focus: undefined }));
  assert.deepEqual(pull.focuses, ['back', 'arms']);
  assert.deepEqual(planTraining(request({ split: 'three', day: 'legs', focus: undefined })).focuses, ['legs', 'core']);
  assert.deepEqual(planTraining(request({ split: 'five', day: 'chest', focus: undefined })).focuses, ['chest']);
  const combined = planTraining(request({ split: 'five', day: 'chest', focus: undefined, focuses: ['chest', 'shoulders'] }));
  assert.equal(combined.focus_label, '胸部＋肩部'); assert.deepEqual(new Set(combined.exercises.map(item => item.focus)), new Set(['chest', 'shoulders']));
  assert.equal(new Set(combined.exercises.map(item => item.id)).size, combined.exercises.length);
  assert.match(combined.warnings.join(''), /修改后的部位组合/);
  for (const invalid of [{ split: 'three' }, { split: 'three', day: 'back' }, { split: 'custom', focuses: [] }, { focuses: ['full_body', 'chest'] }, { focuses: ['chest', 'chest'] }, { split: 'three', day: 'push', minutes: 10, focus: undefined }]) assert.throws(() => planTraining(request(invalid)));
});

test('next-day fatigue and per-muscle soreness correct later plans without fabricating feedback', context => {
  const { store } = fixture(context);
  const saved = store.saveTraining(planTraining(request({ split: 'five', day: 'chest', focus: undefined, focuses: ['chest', 'shoulders'] })));
  const log = store.saveTrainingLog(saved.id, actual(saved.plan), saved.revision);
  assert.equal(store.listTraining({ focus: 'shoulders' })[0].id, saved.id);
  assert.throws(() => validateTrainingRecovery({ fatigue: 'recovered', soreness: { chest: 'none', shoulders: 'none' } }, saved.plan, saved.date, saved.date), /第二天/);
  assert.throws(() => store.saveTrainingRecovery(saved.id, { fatigue: 'recovered', soreness: { chest: 'none' } }, log.revision, 'test', addDays(today(), 1)), /分别填写/);
  const feedback = store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { chest: 'moderate', shoulders: 'none' }, notes: '肩不酸，胸较酸', cloud_allowed: false }, log.revision, 'test', addDays(today(), 1));
  assert.equal(feedback.actual.recovery.soreness.chest, 'moderate'); assert.equal(feedback.revision, 3);
  assert.throws(() => store.saveTrainingRecovery(saved.id, { fatigue: 'recovered', soreness: { chest: 'none', shoulders: 'none' } }, log.revision, 'test', addDays(today(), 2)), /已改变/);
  const chest = planTraining(request({ focus: 'chest' }), { date: addDays(today(), 3), history: store.listTraining({ focus: 'chest' }) });
  const shoulder = planTraining(request({ focus: 'shoulders' }), { date: addDays(today(), 3), history: store.listTraining({ focus: 'shoulders' }) });
  assert.match(chest.warnings.join(''), /明显酸痛/); assert.ok(chest.exercises[0].sets <= shoulder.exercises[0].sets);
  const severe = store.saveTrainingRecovery(saved.id, { fatigue: 'exhausted', soreness: { chest: 'severe', shoulders: 'none' }, cloud_allowed: false }, feedback.revision, 'test', addDays(today(), 1));
  assert.equal(planTraining(request({ focus: 'chest' }), { date: addDays(today(), 3), history: store.listTraining() }).mode, 'recovery');
  assert.equal(store.trainingHistory(severe.id).length, 4);
});

test('partial chest workout asks only about worked chest; revising trained muscles clears stale recovery', context => {
  const { store, actions } = fixture(context);
  const saved = store.saveTraining(planTraining(request({ focuses: ['chest', 'shoulders'], focus: undefined })));
  const chest = saved.plan.exercises.find(item => item.focus === 'chest');
  const shoulders = saved.plan.exercises.find(item => item.focus === 'shoulders');
  const chestOnly = actual(saved.plan, { status: 'partial', entries: [{ exercise_id: chest.id, sets: [{ reps: 8, rir: 3 }] }] });
  assert.throws(() => validateTrainingLog({ ...chestOnly, status: 'completed' }, saved.plan), /部分完成/);
  const log = store.saveTrainingLog(saved.id, chestOnly, saved.revision);
  assert.throws(() => store.saveTrainingRecovery(log.id, { fatigue: 'tired', soreness: { chest: 'mild', shoulders: 'none' } }, log.revision, 'test', addDays(today(), 1)), /分别填写/);
  const feedback = store.saveTrainingRecovery(log.id, { fatigue: 'tired', soreness: { chest: 'mild' }, cloud_allowed: false }, log.revision, 'test', addDays(today(), 1));
  assert.deepEqual(Object.keys(feedback.actual.recovery.soreness), ['chest']);
  const shoulderOnly = actual(saved.plan, { status: 'partial', entries: [{ exercise_id: shoulders.id, sets: [{ reps: 8, rir: 3 }] }] });
  const preview = actions.prepare('training_log', { id: log.id, expected_revision: feedback.revision, ...shoulderOnly });
  assert.match(preview.warnings.join(''), /重新填写疲劳和酸痛/);
  const revised = store.saveTrainingLog(log.id, shoulderOnly, feedback.revision);
  assert.equal(revised.actual.recovery, undefined);
  assert.throws(() => store.saveTrainingRecovery(log.id, { fatigue: 'tired', soreness: { chest: 'mild' } }, revised.revision, 'test', addDays(today(), 1)), /分别填写/);
  const newFeedback = store.saveTrainingRecovery(log.id, { fatigue: 'recovered', soreness: { shoulders: 'none' }, cloud_allowed: false }, revised.revision, 'test', addDays(today(), 1));
  assert.deepEqual(Object.keys(newFeedback.actual.recovery.soreness), ['shoulders']);
});

test('full-body soreness also protects overlapping single-muscle training', context => {
  const { store } = fixture(context);
  const saved = store.saveTraining(planTraining(request({ focus: 'full_body', equipment: 'none' })));
  const log = store.saveTrainingLog(saved.id, actual(saved.plan), saved.revision);
  store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { full_body: 'severe' }, cloud_allowed: false }, log.revision, 'test', addDays(today(), 1));
  assert.equal(planTraining(request({ focus: 'chest' }), { date: addDays(today(), 3), history: store.listTraining({ focus: 'chest' }) }).mode, 'recovery');
});

test('overall fatigue affects other muscle days, while soreness stays specific to trained muscles', context => {
  const { store } = fixture(context);
  const saved = store.saveTraining(planTraining(request({ focus: 'chest' })));
  const log = store.saveTrainingLog(saved.id, actual(saved.plan), saved.revision);
  const targetDay = addDays(today(), 3);
  const nextLegDay = () => planTraining(request({ focus: 'legs' }), { date: targetDay, history: store.listTraining() });
  const baseline = planTraining(request({ focus: 'legs' }), { date: targetDay });
  const exhausted = store.saveTrainingRecovery(saved.id, { fatigue: 'exhausted', soreness: { chest: 'none' }, cloud_allowed: false }, log.revision, 'test', addDays(today(), 1));
  assert.equal(nextLegDay().mode, 'recovery');
  const tired = store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { chest: 'none' }, cloud_allowed: false }, exhausted.revision, 'test', addDays(today(), 1));
  assert.equal(nextLegDay().mode, 'training');
  assert.ok(nextLegDay().exercises[0].sets < baseline.exercises[0].sets);
  store.saveTrainingRecovery(saved.id, { fatigue: 'recovered', soreness: { chest: 'severe' }, cloud_allowed: false }, tired.revision, 'test', addDays(today(), 1));
  assert.equal(nextLegDay().mode, 'training');
  assert.equal(nextLegDay().exercises[0].sets, baseline.exercises[0].sets);
});

test('reviewed recovery waits until day after, remains local by default and preserves revisions', async context => {
  const { store, actions } = fixture(context);
  const planned = store.saveTraining(planTraining(request({ focuses: ['chest', 'shoulders'], focus: undefined })));
  const log = store.saveTrainingLog(planned.id, actual(planned.plan), planned.revision);
  const input = { id: log.id, expected_revision: log.revision, fatigue: 'tired', soreness: { chest: 'mild', shoulders: 'moderate' }, notes: '虚构次日记录', cloud_allowed: false };
  assert.throws(() => actions.prepare('training_recovery', input), /第二天/);
  let currentDate = addDays(today(), 1);
  const tomorrow = new LocalActions(store, { trainingDate: () => currentDate });
  const preview = tomorrow.prepare('training_recovery', input);
  assert.equal(store.training(log.id).actual.recovery, undefined);
  assert.match(preview.summary, /肩部：明显酸痛/);
  currentDate = addDays(today(), 2);
  await assert.rejects(tomorrow.commit(preview.id), /跨日/);
  const repeated = tomorrow.prepare('training_recovery', input);
  const saved = (await tomorrow.commit(repeated.id)).record;
  assert.equal(saved.actual.recovery.recorded_date, currentDate);
  assert.equal(saved.cloud_allowed, false); assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  assert.equal(store.trainingHistory(log.id).length, 3);
  assert.match(trainingFeedbackText(saved), /训练后恢复反馈/);
  assert.throws(() => tomorrow.prepare('training_recovery', input), /已改变/);
  assert.throws(() => validateTrainingRecovery({ ...input, notes: 'Bearer abcdefghijklmnopqrstuvwxyz' }, planned.plan, today(), currentDate), /不能包含/);
});

test('validated per-set logs drive later recovery, gentle progression and safety adjustments', context => {
  const { store } = fixture(context); const saved = store.saveTraining(planTraining(request()));
  const log = store.saveTrainingLog(saved.id, actual(saved.plan), saved.revision);
  assert.equal(log.actual.entries[0].sets[1].reps, 9); assert.equal(log.status, 'completed');
  const nextDay = planTraining(request(), { date: addDays(today(), 1), history: store.listTraining({ focus: 'legs' }) });
  assert.equal(nextDay.mode, 'recovery'); assert.match(nextDay.warnings.join(''), /练过腿臀/);
  const later = planTraining(request(), { date: addDays(today(), 3), history: store.listTraining({ focus: 'legs' }) });
  assert.equal(later.mode, 'training'); assert.ok(later.adaptations.some(item => item.suggestion.includes('尚无这次训练的次日')));
  const recovered = store.saveTrainingRecovery(saved.id, { fatigue: 'recovered', soreness: { legs: 'none' }, cloud_allowed: false }, log.revision, 'test', addDays(today(), 1));
  assert.ok(planTraining(request(), { date: addDays(today(), 3), history: store.listTraining({ focus: 'legs' }) }).adaptations.some(item => item.suggestion.includes('1—2次')));
  const revised = store.saveTrainingLog(saved.id, actual(saved.plan, { discomfort: 'pain', energy: 'hard', cloud_allowed: false }), recovered.revision);
  const cautious = planTraining(request(), { date: addDays(today(), 3), history: store.listTraining({ focus: 'legs' }) });
  assert.match(cautious.warnings.join(''), /疼痛/); assert.ok(cautious.exercises[0].sets <= later.exercises[0].sets);
  assert.equal(revised.revision, 4); assert.equal(revised.actual.recovery.fatigue, 'recovered'); assert.equal(store.listMetrics({ metric: 'training_minutes' }).length, 0);
});

test('recording rejects invented completion, unknown exercises, invalid sets and changing data on stale review', async context => {
  const { store, actions } = fixture(context); const plan = planTraining(request()); const prepared = actions.prepare('training_save', request());
  assert.equal(store.listTraining().length, 0);
  const saved = (await actions.commit(prepared.id)).record;
  assert.equal((await actions.commit(prepared.id)).record.id, saved.id);
  assert.throws(() => actions.prepare('training_save', request({ focus: 'chest' })), /已有计划/);
  const invalid = [actual(plan, { entries: [{ exercise_id: 'invented', sets: [{ reps: 8 }] }] }), actual(plan, { duration_minutes: 0 }), actual(plan, { entries: [{ exercise_id: plan.exercises[0].id, sets: [{ reps: 0 }] }] }), actual(plan, { entries: [{ exercise_id: plan.exercises[0].id, sets: [{ reps: 8, load_kg: -1 }] }] }), actual(plan, { status: 'skipped' })];
  for (const item of invalid) assert.throws(() => validateTrainingLog(item, plan));
  const preview = actions.prepare('training_log', { id: saved.id, expected_revision: 1, ...actual(plan) });
  const stale = actions.prepare('training_log', { id: saved.id, expected_revision: 1, ...actual(plan, { notes: '另一窗口' }) });
  assert.equal(store.training(saved.id).actual, null);
  const log = (await actions.commit(preview.id)).record; assert.equal(log.cloud_allowed, false); assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  await assert.rejects(actions.commit(stale.id), /已改变/);
  assert.throws(() => actions.prepare('training_log', { id: saved.id, expected_revision: 1, ...actual(plan) }), /已改变/);
  assert.match(trainingFeedbackText(log), /6kg/); assert.match(trainingFeedbackText(log), /体感：适中；不适：无/);
  assert.equal(store.listMetrics({ metric: 'training_minutes' }).length, 0);
});

test('cloud sharing is opt-in and revoked history stays private; export and deletion include all revisions', async context => {
  const { store, actions } = fixture(context); const row = store.saveTraining(planTraining(request()));
  const shared = (await actions.commit(actions.prepare('training_log', { id: row.id, expected_revision: 1, ...actual(row.plan, { cloud_allowed: true }) }).id)).record;
  assert.equal(store.listTraining({ cloudOnly: true }).length, 1);
  const reviewed = store.saveTrainingRecovery(row.id, { fatigue: 'tired', soreness: { legs: 'mild' }, notes: '仅本地的恢复反馈', cloud_allowed: false }, shared.revision, 'test', addDays(today(), 1));
  assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  const local = (await actions.commit(actions.prepare('training_log', { id: row.id, expected_revision: reviewed.revision, ...actual(row.plan, { cloud_allowed: false, notes: '本地修正' }) }).id)).record;
  assert.equal(local.actual.recovery.fatigue, 'tired'); assert.equal(store.listTraining({ cloudOnly: true }).length, 0); assert.equal(store.trainingHistory(row.id).length, 4);
  assert.ok(store.trainingHistory(row.id).every(version => !version.cloud_allowed));
  const exported = store.exportData(); assert.equal(exported.training_sessions.length, 1); assert.equal(exported.training_versions.length, 4); assert.match(exported.training_sessions[0].actual_json, /仅本地的恢复反馈/);
  const review = actions.prepare('training_delete', { id: row.id, expected_revision: local.revision });
  assert.equal(store.listTraining().length, 1); await actions.commit(review.id);
  assert.deepEqual(store.trainingHistory(row.id), []); assert.deepEqual(store.listTraining(), []);
});

test('time-based core exercises record actual seconds, not fabricated repetition counts', context => {
  const { store } = fixture(context); const session = store.saveTraining(planTraining(request({ focus: 'core', equipment: 'none', experience: 'regular', minutes: 65 })));
  const plank = session.plan.exercises.find(item => item.id === 'side_plank');
  const logged = store.saveTrainingLog(session.id, { status: 'partial', duration_minutes: 22, entries: [{ exercise_id: plank.id, sets: [{ seconds: 20, load_kg: null, rir: null }] }], discomfort: 'none', energy: 'normal', notes: '', cloud_allowed: false }, 1);
  assert.equal(logged.actual.entries[0].sets[0].seconds, 20); assert.equal(logged.actual.entries[0].sets[0].reps, null);
  assert.match(trainingFeedbackText(logged), /20秒/);
  assert.throws(() => validateTrainingLog({ status: 'partial', duration_minutes: 20, entries: [{ exercise_id: plank.id, sets: [{ reps: 20 }] }] }, session.plan), /5—180秒/);
});

test('populated version-3 database migrates with SQLite backup and retains old rows', context => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-training-migrate-')); context.after(() => rmSync(root, { recursive: true, force: true }));
  const old = new LifeStore(root); old.remember({ domain: 'fitness', key: '身高', kind: 'fact', value: '187', unit: 'cm' });
  const oldMemory = JSON.stringify(old.exportData().memory); old.database.exec('DROP TABLE training_versions; DROP TABLE training_sessions; PRAGMA user_version=3'); old.close();
  const upgraded = new LifeStore(root); try {
    assert.equal(upgraded.database.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(JSON.stringify(upgraded.exportData().memory), oldMemory); assert.equal(upgraded.database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.ok(readdirSync(path.join(root, 'backups')).some(file => file.startsWith('pre-schema-v4-')));
    assert.deepEqual(upgraded.listTraining(), []);
  } finally { upgraded.close(); }
});
