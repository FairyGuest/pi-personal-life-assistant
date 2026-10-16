import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LifeStore, validateMetric } from '../store.mjs';
import { metricPoints, chartPayload, renderMetricChart } from '../charts.mjs';
import { LIFE_SKILLS, scenarioInstructions, readLifeSkill } from '../skills.mjs';

function fixture(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pi-life-chart-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const metric = overrides => ({ metric: 'weight_kg', value: 70, unit: 'kg', measured_date: '2026-01-01', ...overrides });

test('schema upgrade preserves earlier measurements and initializes new time/method fields', context => {
  const root = fixture(context);
  mkdirSync(path.join(root, 'data'));
  const old = new DatabaseSync(path.join(root, 'data', 'personal.sqlite'));
  old.exec('CREATE TABLE metrics(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,metric TEXT NOT NULL,value REAL NOT NULL,unit TEXT NOT NULL,measured_date TEXT NOT NULL,note TEXT NOT NULL,cloud_allowed INTEGER NOT NULL,correction_of TEXT,is_current INTEGER NOT NULL,created_at TEXT NOT NULL)');
  old.prepare('INSERT INTO metrics(id,metric,value,unit,measured_date,note,cloud_allowed,correction_of,is_current,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('old-test', 'weight_kg', 72, 'kg', '2026-01-01', '', 0, null, 1, 'test');
  old.close();
  const store = new LifeStore(root);
  assert.equal(store.listMetrics()[0].value, 72);
  assert.equal(store.listMetrics()[0].measured_time, '');
  assert.equal(store.listMetrics()[0].method, '');
  store.close();
});

test('batches are atomic, keep time/method, reject invalid dates and never overwrite other days', context => {
  const store = new LifeStore(fixture(context));
  const records = store.addMetrics([metric({ measured_time: '07:30', method: '同一体重秤' }), metric({ value: 71, measured_date: '2026-01-02' }), { metric: 'waist_cm', value: 82, unit: 'cm', measured_date: '2026-01-02' }]);
  assert.equal(store.listMetrics({ history: true }).length, 3);
  assert.equal(store.metricSeries({ metric: 'weight_kg' })[0].measured_time, '07:30');
  assert.throws(() => store.addMetrics([metric({ value: 73 }), metric({ value: 74, correction_of: 'nonexistent' })]), /更正对象/);
  assert.equal(store.listMetrics({ history: true }).length, 3);
  store.addMetric(metric({ value: 69, measured_time: '07:30', method: '同一体重秤', correction_of: records[0].id }));
  assert.equal(store.metricSeries({ metric: 'weight_kg' }).length, 2);
  assert.equal(store.metricSeries({ metric: 'weight_kg' })[0].value, 69);
  assert.equal(store.listMetrics({ history: true }).length, 4);
  assert.throws(() => validateMetric(metric({ measured_time: '25:00' })), /HH:MM/);
  store.close();
});

test('full history beyond100 records, ranges, pagination and cloud-only scopes are correct', context => {
  const store = new LifeStore(fixture(context));
  for (let index = 0; index < 130; index++) {
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    store.addMetric(metric({ measured_date: date, value: 70 + index / 100, cloud_allowed: index % 2 === 0 }));
  }
  assert.equal(store.metricSeries({ metric: 'weight_kg' }).length, 130);
  assert.equal(store.metricSeries({ metric: 'weight_kg', cloudOnly: true }).length, 65);
  assert.equal(store.listMetrics({ metric: 'weight_kg', limit: 100, offset: 100 }).length, 30);
  const ranged = store.metricSeries({ metric: 'weight_kg', start_date: '2026-01-02', end_date: '2026-01-04' });
  assert.equal(ranged.length, 3);
  const chart = chartPayload(store, { metrics: ['weight_kg'] });
  assert.equal(chart.panels[0].summary.records, 130);
  assert.equal(chart.panels[0].points[0].date, '2026-01-01');
  assert.throws(() => chartPayload(store, { metrics: ['weight_kg'], start_date: '2026-03-01', end_date: '2026-01-01' }), /开始日期/);
  store.close();
});

test('daily means are explicit, missing dates are not filled, rolling window uses calendar days', () => {
  const rows = [{ measured_date: '2026-01-01', value: 70 }, { measured_date: '2026-01-01', value: 72 }, { measured_date: '2026-01-02', value: 69 }, { measured_date: '2026-01-10', value: 65 }];
  const series = metricPoints(rows);
  assert.equal(series.points.length, 3);
  assert.equal(series.points[0].value, 71);
  assert.equal(series.points[0].count, 2);
  assert.equal(series.missing_days, 7);
  assert.equal(series.averages[1].value, 70);
  assert.equal(series.averages[2].value, null);
  assert.equal(metricPoints(rows, 'raw', 0).points.length, 4);
});

test('local renderer produces PNG SVG CSV and offline HTML, correct units and no external scripts', async context => {
  const root = fixture(context);
  const store = new LifeStore(root);
  store.addMetrics([metric(), metric({ value: 71, measured_date: '2026-01-02' }), metric({ value: 69, measured_date: '2026-01-10' }), { metric: 'waist_cm', value: 84, unit: 'cm', measured_date: '2026-01-01' }]);
  const chart = await renderMetricChart(root, chartPayload(store, { metrics: ['weight_kg', 'waist_cm'] }));
  assert.equal(readFileSync(chart.files.png).subarray(1, 4).toString(), 'PNG');
  const page = readFileSync(chart.files.html, 'utf8');
  assert.ok(page.includes('体重'));
  assert.ok(page.includes('腰围'));
  assert.ok(!page.includes('<script'));
  assert.ok(page.includes("default-src 'none'"));
  assert.equal(readFileSync(chart.files.csv, 'utf8').trim().split('\n').length, 5);
  assert.equal(chart.cloud_data_shared, false);
  assert.throws(() => chartPayload(store, { metrics: ['weight_kg'], start_date: '2026-10-01' }), /没有有效/);
  store.close();
});

test('renderer refuses output directory junction escape', async context => {
  const root = fixture(context); const outside = fixture(context);
  symlinkSync(outside, path.join(root, 'charts'), 'junction');
  await assert.rejects(renderMetricChart(root, { panels: [] }), /链接/);
});

test('six real skills load by allowlist and auto route only matching scenario', () => {
  assert.equal(LIFE_SKILLS.length, 6);
  for (const skill of LIFE_SKILLS) assert.ok(readLifeSkill(skill.name).instructions.includes(`name: ${skill.name}`));
  assert.throws(() => readLifeSkill('../../secret'), /只允许/);
  const fitness = scenarioInstructions(['general', 'fitness'], '记录今天的体重');
  assert.ok(fitness.includes('fitness-tracking'));
  assert.ok(fitness.includes('life_chart'));
  assert.ok(!fitness.includes('career-search'));
  assert.ok(scenarioInstructions(['general'], '/skill:learning-research 读论文').includes('learning-research'));
});
