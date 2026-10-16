import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applicationRevision, snapshotAssets } from '../gui/version.mjs';
import { ensureLifeService, runningService } from '../gui/launcher.mjs';
import { createLifeServer } from '../gui/server.mjs';

const token = 'a'.repeat(64);
const currentRevision = 'b'.repeat(64);
const temporary = () => { const root = mkdtempSync(path.join(tmpdir(), 'life-startup-test-')); mkdirSync(path.join(root, 'data')); return root; };

async function runtime(root, { revision = currentRevision, connected = true, healthStatus = 200, hang = false } = {}) {
  const requests = []; let stopped = false;
  const server = http.createServer((request, response) => {
    requests.push({ route: request.url, headers: request.headers });
    if (request.url === '/api/health') {
      if (hang) return;
      response.writeHead(healthStatus, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ service: 'pi-life-ui', connected, ...(revision ? { revision } : {}) }));
    } else if (request.url === '/api/shutdown') {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"stopped":true}');
      stopped = true; setTimeout(() => { server.close(); server.closeAllConnections(); }, 20);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const info = { service: 'pi-life-ui', origin: `http://127.0.0.1:${server.address().port}`, token, revision: currentRevision };
  writeFileSync(path.join(root, 'data', 'life-ui-runtime.json'), JSON.stringify(info));
  return { info, requests, get stopped() { return stopped; }, close: () => { server.close(); server.closeAllConnections(); } };
}

test('code revisions detect edits while assets remain paired with their starting backend', () => {
  const root = temporary();
  try {
    mkdirSync(path.join(root, 'gui', 'public'), { recursive: true });
    const frontend = path.join(root, 'gui', 'public', 'app.js'); writeFileSync(frontend, 'old-ui');
    writeFileSync(path.join(root, 'gui', 'server.mjs'), 'old-server');
    const before = applicationRevision(root);
    const assets = snapshotAssets(path.join(root, 'gui', 'public'), { '/app.js': ['app.js', 'text/javascript'] });
    writeFileSync(path.join(root, 'data', 'fictional-records.json'), '{"fictional":true}');
    assert.equal(applicationRevision(root), before);
    writeFileSync(frontend, 'new-ui');
    assert.notEqual(applicationRevision(root), before);
    assert.equal(assets.get('/app.js').body.toString(), 'old-ui');
    assert.equal(snapshotAssets(path.join(root, 'gui', 'public'), { '/app.js': ['app.js', 'text/javascript'] }).get('/app.js').body.toString(), 'new-ui');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('launcher reuses only the authenticated current connected backend', async () => {
  const root = temporary(); const service = await runtime(root);
  try {
    const info = await ensureLifeService({ workspace: root, revision: currentRevision, confirmRestart: () => assert.fail('should not prompt'), startService: () => assert.fail('should not spawn') });
    assert.equal(info.origin, service.info.origin);
    assert.equal(service.requests[0].headers.authorization, `Bearer ${token}`);
    assert.equal(service.stopped, false);
  } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy and disconnected backends require confirmation even when runtime metadata looks current', async () => {
  for (const options of [{ revision: null }, { connected: false }, { revision: 'c'.repeat(64) }]) {
    const root = temporary(); const service = await runtime(root, options); let prompts = 0;
    try {
      await assert.rejects(ensureLifeService({ workspace: root, revision: currentRevision, confirmRestart: message => { prompts++; assert.match(message, /保存其他窗口/); return false; }, startService: () => assert.fail('must not spawn') }), /未重启/);
      assert.equal(prompts, 1); assert.equal(service.stopped, false);
    } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('confirmed upgrade gracefully stops only the matching backend before starting its replacement', async () => {
  const root = temporary(); const old = await runtime(root, { revision: null }); let next; let starts = 0;
  try {
    const result = await ensureLifeService({ workspace: root, revision: currentRevision, confirmRestart: async () => true, startService: async workspace => {
      assert.equal(workspace, root); assert.equal(old.stopped, true); starts++;
      next = await runtime(root); const child = new EventEmitter(); child.kill = () => next.close(); return child;
    } });
    assert.equal(starts, 1); assert.equal(result.origin, next.info.origin);
    const shutdown = old.requests.find(request => request.route === '/api/shutdown');
    assert.equal(shutdown.headers.origin, old.info.origin);
    assert.equal(shutdown.headers.cookie, `life_session=${token}`);
    assert.equal(shutdown.headers['x-life-token'], token);
  } finally { old.close(); next?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('unresponsive, unauthenticated and invalid services never trigger a duplicate backend', async () => {
  for (const options of [{ hang: true }, { healthStatus: 401 }]) {
    const root = temporary(); const service = await runtime(root, options);
    try {
      await assert.rejects(ensureLifeService({ workspace: root, revision: currentRevision, confirmRestart: () => assert.fail('must not confirm unverified server'), startService: () => assert.fail('must not spawn') }), /未启动第二个后台/);
      assert.equal(service.stopped, false);
    } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
  }
  const root = temporary();
  try {
    writeFileSync(path.join(root, 'data', 'life-ui-runtime.json'), JSON.stringify({ service: 'pi-life-ui', origin: 'https://example.com', token }));
    await assert.rejects(runningService(root), /无效/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('server exposes its running revision only through authenticated health and serves every boot module', async () => {
  class FakeBridge extends EventEmitter { async start() { return this; } stop() { this.closed = true; } }
  const root = temporary(); const app = await createLifeServer({ workspace: root, bridge: new FakeBridge() });
  try {
    assert.equal((await fetch(`${app.origin}/api/health`)).status, 401);
    const health = await fetch(`${app.origin}/api/health`, { headers: { Authorization: `Bearer ${app.token}` } });
    assert.equal((await health.json()).revision, app.revision);
    for (const route of ['/app.js', '/app-main.js', '/forms.js', '/fitness-tools.js', '/training-editor.js', '/training-model.js']) {
      const response = await fetch(app.origin + route); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
    }
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
