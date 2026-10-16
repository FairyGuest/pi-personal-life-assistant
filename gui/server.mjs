import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LifeStore, METRICS, today } from '../store.mjs';
import { METRIC_LABELS, chartPayload } from '../charts.mjs';
import { LIFE_SKILLS } from '../skills.mjs';
import settings from '../workspace.cjs';
import { PiBridge } from './rpc.mjs';
import { applicationRevision, snapshotAssets } from './version.mjs';
import { LocalActions } from '../local-actions.mjs';
import { bmiFromStore, FITNESS_OPTIONS } from '../fitness.mjs';
import { planTraining, FOCUS_LABELS, SPLIT_LABELS, SPLIT_DAYS, RECOVERY_FATIGUE, RECOVERY_SORENESS } from '../training.mjs';
import { DOMAIN_LABELS, KIND_LABELS, PLAN_KIND_LABELS, STATUS_LABELS, PRIVACY_LABELS, METRICS as METRIC_CATALOG, PLAN_STATUSES, JOB_STATUSES, PLAN_PARENT_KINDS } from '../catalog.mjs';

const staticRoot = fileURLToPath(new URL('./public/', import.meta.url));
const exerciseLibrary = JSON.parse(readFileSync(path.join(staticRoot, 'exercise-catalog.json'), 'utf8'));
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/forms.js': ['forms.js', 'text/javascript; charset=utf-8'], '/fitness-tools.js': ['fitness-tools.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
assets['/training-editor.js'] = ['training-editor.js', 'text/javascript; charset=utf-8'];
assets['/training-model.js'] = ['training-model.js', 'text/javascript; charset=utf-8'];
assets['/app-main.js'] = ['app-main.js', 'text/javascript; charset=utf-8'];
for (const exercise of exerciseLibrary.records) for (const image of exercise.images) {
  if (!/^\/exercise-images\/(?:wger-\d+-\d+\.png|everkinetic-\d{4}-(?:relaxation|tension)\.png|workout-guide-machine-lateral-raise-1\.png|plank\.svg)$/.test(image.path)) throw new Error('动作图片清单路径无效。');
  assets[image.path] = [image.path.slice(1), image.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png'];
}
const staticAssets = snapshotAssets(staticRoot, assets);
const revision = applicationRevision();
const maximumBody = 100000;
const equalToken = (first, second) => typeof first === 'string' && /^[a-f0-9]{64}$/.test(first) && first.length === second.length && timingSafeEqual(Buffer.from(first), Buffer.from(second));

export async function readJson(request, limit = maximumBody) {
  if (!String(request.headers['content-type']).startsWith('application/json')) throw new Error('请求需要JSON格式。');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw new Error('请求过大。'); chunks.push(chunk); }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('无效请求。');
  return result;
}

export function safeChartFile(workspace, filename) {
  if (typeof filename !== 'string' || !/^metrics-[a-zA-Z0-9-]+\.(png|svg|csv|html)$/.test(filename)) throw new Error('图表文件名无效。');
  const expectedRoot = path.join(realpathSync(workspace), 'charts');
  const root = realpathSync(expectedRoot);
  if (root.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error('图表目录不能指向其他位置。');
  const file = realpathSync(path.join(root, filename));
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !statSync(file).isFile()) throw new Error('不能读取图表目录以外的文件。');
  if (statSync(file).size > 32 * 1024 * 1024) throw new Error('文件超过32MB，请在本地文件夹查看。');
  return file;
}

export async function createLifeServer({ workspace = settings.WORKSPACE, bridge = new PiBridge({ workspace }), token = randomBytes(32).toString('hex'), port = 0 } = {}) {
  for (const folder of ['data', 'sessions', 'charts', 'inbox', 'exports']) mkdirSync(path.join(workspace, folder), { recursive: true });
  const store = new LifeStore(workspace);
  const actions = new LocalActions(store);
  const clients = new Set();
  let origin;
  let closing = false;
  const send = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
  const emit = value => {
    const frame = `data: ${JSON.stringify(value)}\n\n`;
    for (const response of clients) { if (response.writableLength > 2 * 1024 * 1024) response.destroy(); else response.write(frame); }
  };
  bridge.on('event', emit);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) { send(response, 403, { error: '只允许本地生活助手窗口访问。' }); return; }
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && staticAssets.has(url.pathname)) {
        const { body, mime } = staticAssets.get(url.pathname);
        response.writeHead(200, { 'Content-Type': mime }); response.end(body); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/connect') {
        const body = await readJson(request);
        if (!equalToken(body.token, token)) { send(response, 401, { error: '窗口授权已失效，请重新双击启动生活助手。' }); return; }
        response.setHeader('Set-Cookie', `life_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        send(response, 200, { connected: true }); return;
      }
      const cookie = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('life_session='))?.slice('life_session='.length);
      const healthToken = url.pathname === '/api/health' ? request.headers.authorization?.replace(/^Bearer /, '') : undefined;
      if (!equalToken(cookie ?? healthToken, token)) { send(response, 401, { error: '请重新打开生活助手窗口。' }); return; }
      if (request.method !== 'GET' && (!equalToken(request.headers['x-life-token'], token) || request.headers.origin !== origin)) { send(response, 403, { error: '操作来源校验失败。' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/health') { send(response, 200, { service: 'pi-life-ui', connected: !bridge.closed, revision }); return; }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify({ type: 'snapshot', ...bridge.snapshot() })}\n\n`);
        clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/sessions') { send(response, 200, await bridge.sessions()); return; }
      if (request.method === 'GET' && url.pathname === '/api/fitness') { send(response, 200, { today: today(), bmi: bmiFromStore(store), options: { ...FITNESS_OPTIONS, focus: FOCUS_LABELS, splits: SPLIT_LABELS, days: SPLIT_DAYS, recoveryFatigue: RECOVERY_FATIGUE, recoverySoreness: RECOVERY_SORENESS, exerciseLibrary }, height: store.currentMemory('fitness', '身高', 'fact'), splitPreference: store.currentMemory('fitness', '训练分化', 'preference'), training: store.listTraining({ limit: 100 }), localOnly: true }); return; }
      if (request.method === 'POST' && url.pathname === '/api/fitness/bmi') { const body = await readJson(request); send(response, 200, bmiFromStore(store, body)); return; }
      if (request.method === 'POST' && url.pathname === '/api/fitness/workout') { const body = await readJson(request); send(response, 200, planTraining(body, { history: store.listTraining({ limit: 100 }) })); return; }
      if (request.method === 'GET' && url.pathname === '/api/training-history') { send(response, 200, store.trainingHistory(url.searchParams.get('id'))); return; }
      if (request.method === 'GET' && url.pathname === '/api/dashboard') {
        send(response, 200, { workspace, today: today(), counts: store.counts(), summary: store.dashboardSummary(), pendingRecovery: store.listTraining({ limit: 100 }).filter(row => row.actual && ['completed', 'partial'].includes(row.status) && row.date < today() && !row.actual.recovery).length, latestMetrics: store.latestMetrics(), memory: store.listMemory({ history: url.searchParams.get('history') === 'true', limit: 100 }), plans: store.listPlans({ limit: 100 }), metrics: store.listMetrics({ limit: 14 }), skills: LIFE_SKILLS, metricLabels: METRIC_LABELS, metricUnits: Object.fromEntries(Object.entries(METRICS).map(([key, value]) => [key, value.display_unit])), catalog: { metrics: METRIC_CATALOG, domains: DOMAIN_LABELS, kinds: KIND_LABELS, planKinds: PLAN_KIND_LABELS, statuses: STATUS_LABELS, privacy: PRIVACY_LABELS, planStatuses: PLAN_STATUSES, jobStatuses: JOB_STATUSES, parentKinds: PLAN_PARENT_KINDS }, localOnly: true }); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/metrics') {
        const metric = url.searchParams.get('metric') || 'weight_kg';
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const filter = { metric, history: url.searchParams.get('history') === 'true', start_date: url.searchParams.get('start') || undefined, end_date: url.searchParams.get('end') || undefined };
        const rows = store.listMetrics({ ...filter, limit: 50, offset });
        send(response, 200, { rows, offset, hasMore: store.listMetrics({ ...filter, limit: 1, offset: offset + 50 }).length > 0 }); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/metric-history') { send(response, 200, store.metricHistory(url.searchParams.get('recordId'))); return; }
      if (request.method === 'GET' && url.pathname === '/api/plan-history') { send(response, 200, store.planHistory(url.searchParams.get('id'))); return; }
      if (request.method === 'POST' && url.pathname === '/api/local/prepare') { const body = await readJson(request, 1000000); send(response, 200, actions.prepare(body.action, body.input)); return; }
      if (request.method === 'POST' && url.pathname === '/api/local/commit') { const body = await readJson(request); const result = await actions.commit(body.id); emit({ type: 'data_changed' }); send(response, 200, result); return; }
      if (request.method === 'POST' && url.pathname === '/api/local/cancel') { const body = await readJson(request); actions.cancel(body.id); send(response, 200, { cancelled: true }); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/series') {
        const metrics = (url.searchParams.get('metrics') || 'weight_kg,waist_cm').split(',');
        send(response, 200, chartPayload(store, { metrics, start_date: url.searchParams.get('start') || undefined, end_date: url.searchParams.get('end') || undefined }, { allowEmpty: true })); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/charts') {
        const expectedRoot = path.join(realpathSync(workspace), 'charts');
        if (realpathSync(expectedRoot).toLowerCase() !== expectedRoot.toLowerCase()) throw new Error('图表目录不能指向其他位置。');
        const files = readdirSync(expectedRoot).filter(name => /^metrics-[a-zA-Z0-9-]+\.(png|svg|csv|html)$/.test(name)).flatMap(name => { try { const file = safeChartFile(workspace, name); return [{ name, modified: statSync(file).mtime.toISOString() }]; } catch { return []; } }).sort((first, second) => second.modified.localeCompare(first.modified)).slice(0, 100);
        send(response, 200, files); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/chart/')) {
        const filename = decodeURIComponent(url.pathname.slice('/api/chart/'.length));
        const file = safeChartFile(workspace, filename);
        const mime = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        response.setHeader('Content-Disposition', `${mime.startsWith('image/') ? 'inline' : 'attachment'}; filename="${filename}"`);
        response.writeHead(200, { 'Content-Type': mime }); response.end(readFileSync(file)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/command') { const body = await readJson(request); send(response, 200, { result: await bridge.command(body.type, body) }); return; }
      if (request.method === 'POST' && url.pathname === '/api/dialog') { const body = await readJson(request); bridge.respond(body.id, body); send(response, 200, { answered: true }); return; }
      if (request.method === 'POST' && url.pathname === '/api/abort') { await readJson(request); await bridge.abort(); send(response, 200, { stopped: true }); return; }
      if (request.method === 'POST' && url.pathname === '/api/shutdown') { await readJson(request); send(response, 200, { stopped: true }); setTimeout(() => close(), 50); return; }
      send(response, 404, { error: '没有这个页面。' });
    } catch (error) { if (!response.headersSent) send(response, 400, { error: error.message }); else response.end(); }
  });
  const heartbeat = setInterval(() => { actions.prune(); for (const response of clients) response.write(': keepalive\n\n'); }, 15000);
  heartbeat.unref();
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    bridge.off('event', emit);
    for (const response of clients) response.end();
    clients.clear(); actions.close(); await bridge.stop(); store.close();
    server.close(); server.closeAllConnections();
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    await bridge.start();
  } catch (error) { await close(); throw error; }
  return { server, origin, token, bridge, close, revision };
}

async function main() {
  const infoFile = path.join(settings.WORKSPACE, 'data', 'life-ui-runtime.json');
  const application = await createLifeServer();
  writeFileSync(infoFile, JSON.stringify({ service: 'pi-life-ui', origin: application.origin, token: application.token, pid: process.pid, revision: application.revision }), { mode: 0o600 });
  const cleanup = async () => {
    await application.close();
    if (existsSync(infoFile)) {
      try { if (JSON.parse(readFileSync(infoFile, 'utf8')).pid === process.pid) unlinkSync(infoFile); } catch {}
    }
  };
  process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
  application.server.on('close', cleanup);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.stderr.write('生活助手启动失败，请检查pi安装、DeepSeek配置和D盘工作区。\n'); process.exitCode = 1; });
