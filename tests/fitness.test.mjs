import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LifeStore, today, validateMemory } from '../store.mjs';
import { calculateBmi, bmiFromStore, planWorkout, workoutPlanRecord, FITNESS_OPTIONS } from '../fitness.mjs';
import { LocalActions } from '../local-actions.mjs';

function fixture(context) { const root = mkdtempSync(path.join(tmpdir(), 'life-fitness-')); const store = new LifeStore(root); context.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { root, store, actions: new LocalActions(store) }; }
const height = overrides => ({ domain: 'fitness', key: '身高', kind: 'fact', value: '187', unit: 'cm', cloud_allowed: false, ...overrides });
const weight = overrides => ({ metric: 'weight_kg', value: 80, unit: 'kg', measured_date: today(), cloud_allowed: false, ...overrides });

test('BMI formula and adult standards classify unrounded boundaries consistently', () => {
  assert.equal(calculateBmi({ height_cm: 187, weight_kg: 80 }).bmi, 22.9);
  for (const [value, category] of [[18.49, '偏低'], [18.5, '正常范围'], [23.99, '正常范围'], [24, '超重范围'], [27.99, '超重范围'], [28, '肥胖范围']]) assert.equal(calculateBmi({ height_cm: 200, weight_kg: value * 4 }).category, category);
  assert.equal(calculateBmi({ height_cm: 200, weight_kg: 96, standard: 'who' }).category, '正常范围');
  assert.equal(calculateBmi({ height_cm: 200, weight_kg: 100, standard: 'who' }).category, '超重范围');
  assert.equal(calculateBmi({ height_cm: 200, weight_kg: 120, standard: 'who' }).category, '肥胖范围');
  for (const input of [{ height_cm: 0, weight_kg: 80 }, { height_cm: 187, weight_kg: NaN }, { height_cm: '187', weight_kg: 80 }, { height_cm: 187, weight_kg: 80, standard: 'other' }]) assert.throws(() => calculateBmi(input));
});

test('height is a validated versioned fact in cm, survives reopening, and does not fabricate weight', context => {
  const { store, root } = fixture(context);
  for (const values of [{ value: '187cm' }, { unit: 'm' }, { value: 'NaN' }, { value: '0' }, { value: '999' }, { value: '' }]) assert.throws(() => validateMemory(height(values)), /身高/);
  store.remember(height());
  assert.deepEqual(bmiFromStore(store).missing, ['体重（kg）']);
  const reopened = new LifeStore(root); try { assert.equal(reopened.currentMemory('fitness', '身高', 'fact').value, '187'); assert.equal(reopened.listMemory({ cloudOnly: true }).length, 0); } finally { reopened.close(); }
  assert.equal(store.listMetrics().length, 0);
});

test('local BMI uses latest actual measurement, tracks stale sources and temporary inputs never write', context => {
  const { store } = fixture(context); store.remember(height());
  store.addMetric(weight({ measured_date: '2026-01-01', value: 80 })); store.addMetric(weight({ measured_date: '2026-01-01', measured_time: '08:00', value: 84 }));
  const before = JSON.stringify(store.exportData());
  const result = bmiFromStore(store, {}, { asOf: '2026-02-03' }); assert.equal(result.weight_kg, 84); assert.equal(result.stale, true); assert.equal(result.weight_age_days, 33); assert.match(result.weight_source, /08:00/);
  const temporary = bmiFromStore(store, { height_cm: 180, weight_kg: 70 }); assert.equal(temporary.weight_age_days, null); assert.match(temporary.weight_source, /未保存/);
  const after = JSON.parse(JSON.stringify(store.exportData())); assert.deepEqual(after.memory, JSON.parse(before).memory); assert.deepEqual(after.metrics, JSON.parse(before).metrics);
});

test('derived BMI never reads local-only height or weight when returning to model', context => {
  const { store } = fixture(context); store.remember(height()); store.addMetric(weight());
  const hidden = bmiFromStore(store, {}, { cloudOnly: true }); assert.equal(hidden.status, 'missing'); assert.equal(hidden.height_cm, null); assert.equal(hidden.weight_kg, null);
  store.remember(height({ cloud_allowed: true })); assert.deepEqual(bmiFromStore(store, {}, { cloudOnly: true }).missing, ['体重（kg）']);
  store.addMetric(weight({ value: 82, measured_date: '2026-01-01', cloud_allowed: true }));
  assert.equal(bmiFromStore(store, {}, { cloudOnly: true }).weight_kg, 82); assert.equal(bmiFromStore(store).weight_kg, 80);
  store.remember(height({ cloud_allowed: false })); assert.equal(bmiFromStore(store, {}, { cloudOnly: true }).height_cm, null);
});

test('all training templates fit their time budget, default conservatively and make no diagnosis', () => {
  for (const goal of Object.keys(FITNESS_OPTIONS.goals)) for (const experience of Object.keys(FITNESS_OPTIONS.experience)) for (const equipment of Object.keys(FITNESS_OPTIONS.equipment)) for (const minutes of [10, 15, 30, 40, 60, 90]) {
    const plan = planWorkout({ goal, experience, equipment, minutes, readiness: 'normal', yesterday: 'rest' });
    assert.equal(plan.blocks.reduce((sum, block) => sum + block.minutes, 0), plan.total_minutes); assert.ok(plan.total_minutes <= minutes); assert.ok(plan.blocks.every(block => Number.isInteger(block.minutes) && block.minutes > 0)); assert.equal(plan.can_save, true); assert.equal(workoutPlanRecord(plan).status, 'planned'); assert.ok(workoutPlanRecord(plan).detail.length <= 1200);
  }
  assert.equal(planWorkout().mode, 'recovery'); assert.equal(planWorkout().total_minutes, 20);
  assert.equal(planWorkout({ readiness: 'tired', yesterday: 'rest' }).mode, 'recovery');
  assert.equal(planWorkout({ readiness: 'normal', yesterday: 'hard' }).mode, 'recovery');
  for (const readiness of ['pain', 'ill', 'red_flags']) { const plan = planWorkout({ readiness }); assert.equal(plan.total_minutes, 0); assert.equal(plan.can_save, false); assert.throws(() => workoutPlanRecord(plan), /不适合/); }
  assert.match(planWorkout({ readiness: 'red_flags' }).warnings[0], /120/);
  for (const input of [{ minutes: 9 }, { minutes: 30.5 }, { equipment: 'fake' }, { readiness: 'fake' }]) assert.throws(() => planWorkout(input));
});

test('reviewed training saves only a task, preserves privacy, avoids duplicate commits and duplicate proposals', async context => {
  const { store, actions } = fixture(context); const input = { minutes: 30, goal: 'strength', readiness: 'normal', yesterday: 'rest' };
  const preview = actions.prepare('workout_save', input); const concurrent = actions.prepare('workout_save', input);
  assert.equal(store.listPlans().length, 0); assert.match(preview.summary, /不记录实际训练分钟/);
  const [first, second] = await Promise.all([actions.commit(preview.id), actions.commit(preview.id)]); assert.equal(first.record.id, second.record.id); assert.equal(store.listPlans().length, 1); assert.equal(store.listMetrics().length, 0); assert.equal(Boolean(first.record.cloud_allowed), false);
  await assert.rejects(actions.commit(concurrent.id), /已加入/); assert.throws(() => actions.prepare('workout_save', input), /不重复/);
  assert.throws(() => actions.prepare('workout_save', { readiness: 'pain' }), /不适合/);
});
