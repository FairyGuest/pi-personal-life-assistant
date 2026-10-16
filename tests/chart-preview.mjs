import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chartPayload, renderMetricChart } from '../charts.mjs';
import workspaceSettings from '../workspace.cjs';

const samples = { weight_kg: [74.8, 74.6, 74.7, 74.3, 74.4, 74.1, 74.0, 74.2, 73.9, 73.8, 73.7, 73.9], waist_cm: [86.0, 85.8, 85.9, 85.5, 85.4, 85.3, 85.2, 85.3, 85.0, 84.9, 84.8, 84.9] };
const fixture = { metricSeries: ({ metric }) => samples[metric].map((value, index) => ({ measured_date: `2026-09-${String(index + 1 + (index > 6 ? 1 : 0)).padStart(2, '0')}`, measured_time: '07:30', value, method: '虚构示例，同一设备' })) };
const workspace = path.join(workspaceSettings.WORKSPACE, 'examples');
mkdirSync(workspace, { recursive: true });
const payload = chartPayload(fixture, { metrics: ['weight_kg', 'waist_cm'] });
payload.title = '折线图示例 · 全部为虚构数据';
payload.scope = '仅用于展示，不代表你的体重或腰围，未写入个人数据库';
console.log(JSON.stringify(await renderMetricChart(workspace, payload), null, 2));
