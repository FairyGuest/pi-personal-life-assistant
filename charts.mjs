import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { METRICS, today, checkedDate } from './store.mjs';
import workspaceSettings from './workspace.cjs';
import { METRIC_LABELS } from './catalog.mjs';

export { METRIC_LABELS };
const millisecondsPerDay = 86400000;
const dayNumber = value => Date.parse(`${value}T00:00:00Z`) / millisecondsPerDay;

export function metricPoints(rows, aggregation = 'daily', rollingDays = 7, dailyRule = 'mean') {
  if (!['daily', 'raw'].includes(aggregation)) throw new Error('aggregation只能为daily或raw。');
  if (![0, 7].includes(rollingDays)) throw new Error('滚动均值仅支持0（关闭）或7个日历日。');
  const grouped = new Map();
  for (const row of rows) {
    const entries = grouped.get(row.measured_date) ?? [];
    entries.push(row); grouped.set(row.measured_date, entries);
  }
  const daily = [...grouped].sort(([first], [second]) => first.localeCompare(second)).map(([date, records]) => ({ date, value: dailyRule === 'latest' ? records.at(-1).value : records.reduce((sum, record) => sum + record.value, 0) / records.length, count: records.length }));
  const points = aggregation === 'daily' ? daily : rows.map(row => ({ date: row.measured_date, time: row.measured_time || '', value: row.value, count: 1 }));
  const averages = [];
  let windowStart = 0; let windowSum = 0;
  if (rollingDays) for (let index = 0; index < daily.length; index++) {
    const point = daily[index]; windowSum += point.value;
    while (dayNumber(point.date) - dayNumber(daily[windowStart].date) >= rollingDays) { windowSum -= daily[windowStart].value; windowStart++; }
    const samples = index - windowStart + 1;
    averages.push({ date: point.date, value: samples >= 2 ? windowSum / samples : null, observed_days: samples });
  }
  return { points, daily, averages, missing_days: daily.length ? dayNumber(daily.at(-1).date) - dayNumber(daily[0].date) + 1 - daily.length : 0 };
}

export function chartPayload(store, input, { cloudOnly = false, allowEmpty = false } = {}) {
  const metrics = input.metrics ?? ['weight_kg', 'waist_cm'];
  if (!Array.isArray(metrics) || !metrics.length || metrics.length > 3 || new Set(metrics).size !== metrics.length || metrics.some(metric => !METRICS[metric])) throw new Error('请选1—3个不同的支持指标。');
  if (input.start_date) checkedDate(input.start_date);
  if (input.end_date) checkedDate(input.end_date);
  if (input.start_date && input.end_date && input.start_date > input.end_date) throw new Error('开始日期不能晚于结束日期。');
  const panels = metrics.map(metric => {
    const rows = store.metricSeries({ metric, start_date: input.start_date, end_date: input.end_date, cloudOnly });
    const series = metricPoints(rows, input.aggregation ?? 'daily', input.rolling_days ?? 7, METRICS[metric].daily_rule);
    const first = series.points[0]; const latest = series.points.at(-1);
    return { metric, label: METRIC_LABELS[metric], unit: METRICS[metric].display_unit, storage_unit: METRICS[metric].unit, daily_rule: METRICS[metric].daily_rule, daily_label: METRICS[metric].daily_rule === 'latest' ? '当日最新总量' : '同日日均', ...series, raw_points: rows.map(row => ({ date: row.measured_date, time: row.measured_time, value: row.value })), summary: { records: rows.length, days: series.daily.length, first_date: first?.date ?? null, latest_date: latest?.date ?? null, first_value: first?.value ?? null, latest_value: latest?.value ?? null, change: latest && first ? latest.value - first.value : null, methods: [...new Set(rows.map(row => row.method).filter(Boolean))].slice(0, 20) } };
  });
  if (!allowEmpty && !panels.some(panel => panel.points.length)) throw new Error('指定范围没有有效测量记录，不会编造数据或画空趋势。');
  return { title: '身体与生活指标趋势', generated_date: today(), aggregation: input.aggregation ?? 'daily', rolling_days: input.rolling_days ?? 7, panels, scope: cloudOnly ? '仅已授权云端的有效记录' : '本地全部有效记录（不自动上云）', warning: '更正旧值不重复计入；同日均值/原始点按所选模式；缺测不补零，非诊断或预测。' };
}

export async function renderMetricChart(workspace, payload, signal) {
  const root = realpathSync(workspace);
  const output = path.join(root, 'charts');
  mkdirSync(output, { recursive: true });
  if (realpathSync(output).toLowerCase() !== output.toLowerCase()) throw new Error('charts不能通过链接指向其他位置。');
  const basename = `metrics-${today()}-${randomUUID()}`;
  const script = fileURLToPath(new URL('./render-chart.py', import.meta.url));
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].includes(name.toUpperCase())));
  const files = await new Promise((resolve, reject) => {
    const child = spawn(workspaceSettings.PYTHON, [script, output, basename], { windowsHide: true, signal: combined, stdio: ['pipe', 'pipe', 'pipe'], env: { ...environment, PYTHONIOENCODING: 'utf-8' } });
    const chunks = []; let length = 0;
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 20000) child.kill(); else chunks.push(chunk); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 || length > 20000) { reject(new Error('图表生成失败；检查本机Python与matplotlib。没有把数据发送给外部绘图服务。')); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('绘图程序未返回有效结果。')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
  for (const filename of Object.values(files)) if (path.dirname(path.resolve(filename)).toLowerCase() !== output.toLowerCase()) throw new Error('绘图输出越界。');
  return { saved: true, files, cloud_data_shared: false, warning: '图表和CSV包含个人指标，未加密；删除数据库记录不会清理这些图表副本。' };
}

export function openLocalChart(filename) {
  if (!filename || path.extname(filename).toLowerCase() !== '.html') throw new Error('只能打开已生成的本地图表HTML。');
  const child = spawn(path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'explorer.exe'), [filename], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}
