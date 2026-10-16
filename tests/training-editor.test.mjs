import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { TRAINING_LIMITS, entryFocuses, expandSetGroup, setsSummary } from '../gui/public/training-model.js';
import { validateTrainingLog, performedFocuses, trainingFeedbackText, planTraining } from '../training.mjs';
import { validateTrainingRecords } from '../training-import.mjs';
import { LifeStore, today } from '../store.mjs';
import { MACHINE_EXERCISES } from '../scripts/machine-exercises.mjs';
import { IMAGE_SUPPLEMENTS, withImageSupplements } from '../scripts/supplemental-exercise-images.mjs';

const entry = overrides => ({ exercise_id: 'custom', name: '坐姿绳索划船', catalog_id: 'wger-394', primary_focuses: ['back'], secondary_focuses: ['arms'], tracking_unit: 'reps', load_basis: 'machine', set_groups: [{ count: 4, reps: 10, load_kg: 40 }], ...overrides });
const log = entries => validateTrainingLog({ status: 'completed', independent: true, duration_minutes: 60, entries }, { mode: 'recorded', exercises: [] });

test('multiplication expands actual sets and preserves unknown values and durations', () => {
  const sets = expandSetGroup({ count: 4, reps: 10, load_kg: 40 });
  assert.equal(sets.length, 4); assert.equal(sets[0].load_kg, 40); assert.equal(sets[0].rir, null);
  sets[0].reps = 8; assert.equal(sets[1].reps, 10);
  assert.equal(setsSummary(sets), '40kg × 8次 × 1组；40kg × 10次 × 3组');
  const timed = expandSetGroup({ count: 3, seconds: 45 }, 'seconds');
  assert.equal(setsSummary(timed), '负重未记 × 45秒 × 3组');
  assert.equal(log([entry()]).entries[0].sets.length, 4);
  for (const group of [{ count: 0, reps: 10 }, { count: 51, reps: 10 }, { count: 1.5, reps: 10 }, { count: 2, reps: 10, seconds: 5 }, { count: 2, reps: 10, load_kg: -1 }, { count: 2, reps: 10, rir: 11 }]) assert.throws(() => expandSetGroup(group));
});

test('more than eight actions and sets are allowed without duplicate multiplication', () => {
  const entries = Array.from({ length: 12 }, (_, index) => entry({ name: `实际动作${index}`, set_groups: [{ count: 12, reps: 8 }] }));
  const actual = log(entries); assert.equal(actual.entries.length, 12); assert.equal(actual.entries.reduce((sum, item) => sum + item.sets.length, 0), 144);
  assert.equal(actual.entries[0].set_groups, undefined);
  assert.throws(() => log([entry({ sets: [{ reps: 10 }] })]), /只能填写一种/);
  assert.throws(() => log([entry({ set_groups: [{ count: 26, reps: 8 }, { count: 25, reps: 8 }] })]), /1—50/);
  assert.throws(() => log(Array.from({ length: TRAINING_LIMITS.exercises + 1 }, (_, index) => entry({ name: `动作${index}` }))), /30个/);
  assert.throws(() => validateTrainingRecords(Array.from({ length: 6 }, (_, index) => ({ date: `2026-01-0${index + 1}`, duration_minutes: 60, entries: Array.from({ length: 30 }, (_, motion) => entry({ name: `动作${motion}`, set_groups: [{ count: 50, reps: 8 }] })) }))), /5000组/);
});

test('multi-muscle entries retain primary and secondary groups without double counting', () => {
  const actual = log([entry()]); const row = actual.entries[0];
  assert.deepEqual(row.primary_focuses, ['back']); assert.deepEqual(row.secondary_focuses, ['arms']); assert.deepEqual(row.focuses, ['back', 'arms']);
  assert.deepEqual(entryFocuses(row), ['back', 'arms']); assert.deepEqual(performedFocuses({ exercises: [] }, actual), ['back', 'arms']);
  assert.equal(row.sets.length, 4); assert.equal(row.focus, 'back');
  assert.match(trainingFeedbackText({ date: today(), plan: { exercises: [] }, actual }), /主练：背部；协同：手臂/);
  assert.throws(() => log([entry({ secondary_focuses: ['back'] })]), /同时标/);
  assert.throws(() => log([entry({ primary_focuses: ['full_body'] })]), /全身/);
  assert.throws(() => log([entry({ primary_focuses: ['fake'] })]), /选项无效/);
  assert.throws(() => log([entry({ primary_focuses: [] })]), /训练部位/);
  const legacy = log([{ exercise_id: 'custom', name: '旧动作', focus: 'chest', sets: [{ reps: 8 }] }]);
  assert.deepEqual(legacy.entries[0].primary_focuses, ['chest']); assert.deepEqual(legacy.entries[0].secondary_focuses, []);
});

test('load basis never doubles dumbbell values or interprets body mass as added weight', () => {
  const row = log([entry({ load_basis: 'per_hand' })]).entries[0];
  assert.equal(row.sets[0].load_kg, 40); assert.equal(row.load_basis, 'per_hand');
  assert.throws(() => log([entry({ load_basis: 'bodyweight' })]), /徒手口径/);
  assert.equal(log([entry({ load_basis: 'bodyweight', set_groups: [{ count: 3, reps: 8, load_kg: 0 }] })]).entries[0].sets[0].load_kg, 0);
  assert.throws(() => log([entry({ load_basis: 'fake' })]), /口径/);
});

test('secondary muscles participate in retrieval and recovery while legacy plans stay unchanged', context => {
  const root = mkdtempSync(path.join(tmpdir(), 'life-muscles-test-')); const store = new LifeStore(root);
  context.after(() => { store.close(); const relative = path.relative(tmpdir(), root); if (relative.startsWith('life-muscles-test-') && !relative.includes(path.sep)) rmSync(root, { recursive: true, force: true }); });
  const planned = store.saveTraining(planTraining({ split: 'five', day: 'legs', minutes: 40, readiness: 'normal', yesterday: 'rest' }));
  const saved = store.saveTrainingRecords([{ date: today(), duration_minutes: 60, entries: [entry()] }])[0];
  assert.deepEqual(saved.plan, planned.plan); assert.equal(store.listTraining({ focus: 'arms' })[0].id, saved.id); assert.equal(store.listTraining({ cloudOnly: true }).length, 0);
  const tomorrow = new Date(Date.parse(`${today()}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.throws(() => store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { back: 'mild' } }, saved.revision, 'test', tomorrow), /分别填写/);
  const recovery = store.saveTrainingRecovery(saved.id, { fatigue: 'tired', soreness: { back: 'mild', arms: 'moderate' } }, saved.revision, 'test', tomorrow);
  assert.deepEqual(Object.keys(recovery.actual.recovery.soreness), ['back', 'arms']);
});

test('catalog assets are local, attributed source images with integrity hashes', () => {
  const root = new URL('../gui/public/', import.meta.url); const catalog = JSON.parse(readFileSync(new URL('exercise-catalog.json', root), 'utf8'));
  assert.equal(catalog.records.length, 22 + MACHINE_EXERCISES.length); assert.equal(new Set(catalog.records.map(row => row.id)).size, catalog.records.length);
  const equipment = new Set();
  for (const exercise of catalog.records) {
    equipment.add(exercise.equipment); assert.ok(exercise.primary_focuses.length);
    if (!exercise.images.length) { assert.ok(exercise.guide); assert.ok(exercise.aliases.length); assert.match(exercise.source, /^https:\/\/wger.de\/api\/v2\/exerciseinfo\/\d+\/$/); }
    for (const asset of exercise.images) {
      assert.match(asset.path, /^\/exercise-images\/[\w-]+\.(png|svg)$/);
      const bytes = readFileSync(new URL(asset.path.slice(1), root));
      if (asset.path.endsWith('.png')) {
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
        if (asset.path.startsWith('/exercise-images/wger-')) {
          assert.equal(asset.author, exercise.id === 'wger-543' ? 'wger.de' : 'Everkinetic'); assert.equal(asset.license, 'CC BY-SA 3.0');
          assert.equal(asset.license_url, 'https://creativecommons.org/licenses/by-sa/3.0/');
        } else {
          const supplement = IMAGE_SUPPLEMENTS.records.find(record => record.id === exercise.id);
          assert.deepEqual(asset, supplement?.images.find(image => image.path === asset.path));
          assert.equal(asset.license, 'CC BY-SA 4.0'); assert.equal(asset.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
          const provider = IMAGE_SUPPLEMENTS.sources[supplement.provider];
          assert.ok(asset.source.startsWith(`${provider.repository}/blob/${provider.revision}/`));
          assert.equal(asset.author, supplement.provider === 'everkinetic' ? 'Everkinetic（Greg Priday）' : 'Bryl Lim');
          if (asset.git_blob) assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), asset.git_blob);
          assert.ok(asset.caption); assert.ok(asset.modifications);
        }
      } else {
        assert.equal(exercise.id, 'local-plank'); assert.equal(asset.path, '/exercise-images/plank.svg');
        assert.doesNotMatch(bytes.toString(), /<script|onload=|<foreignObject/);
      }
    }
  }
  assert.equal(equipment.size, 5);
});

test('fixed machines cover all muscle groups with verified identities, aliases and no invented image matches', () => {
  const catalog = JSON.parse(readFileSync(new URL('../gui/public/exercise-catalog.json', import.meta.url), 'utf8'));
  const machines = catalog.records.filter(exercise => exercise.equipment === 'machine');
  assert.equal(machines.length, 19);
  assert.deepEqual([...new Set(machines.flatMap(exercise => exercise.primary_focuses))].sort(), ['arms', 'back', 'chest', 'core', 'legs', 'shoulders']);
  for (const definition of MACHINE_EXERCISES) {
    const exercise = catalog.records.find(item => item.id === `wger-${definition.id}`);
    assert.equal(exercise.name, definition.name); assert.equal(exercise.english, definition.english); assert.equal(exercise.equipment, definition.equipment);
    assert.equal(exercise.source, `https://wger.de/api/v2/exerciseinfo/${definition.id}/`);
    assert.deepEqual(exercise.aliases, definition.aliases); assert.equal(exercise.guide, definition.guide);
    assert.deepEqual(exercise.images.filter(image => image.path.startsWith('/exercise-images/wger-')).map(image => Number(image.path.match(/-(\d+)\.png$/)[1])).sort((first, second) => first - second), [...definition.image_ids].sort((first, second) => first - second));
    const supplement = IMAGE_SUPPLEMENTS.records.find(record => record.id === exercise.id);
    assert.deepEqual(exercise.images.filter(image => !image.path.startsWith('/exercise-images/wger-')), supplement?.images || []);
  }
  assert.equal(catalog.records.filter(exercise => exercise.images.length).length, 35);
  const records = log(MACHINE_EXERCISES.map(exercise => entry({ name: exercise.name, catalog_id: `wger-${exercise.id}`, primary_focuses: exercise.primary_focuses, secondary_focuses: exercise.secondary_focuses })));
  assert.equal(records.entries.length, MACHINE_EXERCISES.length);
  assert.ok(records.entries.every(exercise => exercise.exercise_id === 'custom' && exercise.sets.length === 4));
});

test('reviewed supplements match machine identities and preserve catalog refreshes', () => {
  const catalog = JSON.parse(readFileSync(new URL('../gui/public/exercise-catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.fromEntries(IMAGE_SUPPLEMENTS.records.map(record => [record.id, record.upstream.id])), {
    'wger-379': '0066', 'wger-369': '0142', 'wger-371': '0127', 'wger-12': '0157', 'wger-1672': '0156',
    'wger-590': '0279', 'wger-1424': '0236', 'wger-661': '0210', 'wger-355': '0093', 'wger-1744': 'exercise-machine-lateral-raise',
  });
  assert.equal(IMAGE_SUPPLEMENTS.records.flatMap(record => record.images).length, 19);
  assert.deepEqual(catalog.records.filter(record => !record.images.length).map(record => record.id), ['wger-380', 'wger-1775', 'wger-172', 'wger-2623']);
  const refreshed = structuredClone(catalog.records);
  for (const exercise of refreshed) {
    if (IMAGE_SUPPLEMENTS.records.some(record => record.id === exercise.id)) { exercise.images = []; delete exercise.image_note; }
  }
  const previous = structuredClone(refreshed);
  assert.deepEqual(withImageSupplements(refreshed), catalog.records); assert.deepEqual(refreshed, previous);
  assert.deepEqual(withImageSupplements(catalog.records), catalog.records);
  const changed = structuredClone(refreshed); changed.find(record => record.id === 'wger-355').equipment = 'machine';
  assert.throws(() => withImageSupplements(changed), /identity needs review/);
  assert.throws(() => withImageSupplements(refreshed.filter(record => record.id !== 'wger-371')), /identity needs review/);
  assert.throws(() => withImageSupplements(refreshed, { readAsset: () => Buffer.from('not a PNG') }), /integrity failed/);
  assert.throws(() => withImageSupplements(refreshed, { readAsset: assetPath => {
    const bytes = readFileSync(new URL(`../gui/public${assetPath}`, import.meta.url)); bytes[bytes.length - 1] ^= 1; return bytes;
  } }), /integrity failed/);
  assert.match(catalog.records.find(record => record.id === 'wger-355').image_note, /反握.*并非挂片/);
  assert.equal(catalog.records.find(record => record.id === 'wger-1744').images[0].rendering, 'invert');
});
