import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiBridge } from '../gui/rpc.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'pi-life-gui-live-fictional-'));
const fixture = fileURLToPath(new URL('./fixtures/life-test.ts', import.meta.url));
const createBridge = () => new PiBridge({ workspace: root, spawnProcess: (executable, args, options) => spawn(executable, [args[0], '--no-extensions', '--extension', fixture, '--no-context-files', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-builtin-tools', '--provider', 'deepseek', '--model', 'deepseek-flash', '--mode', 'rpc', '--session-dir', path.join(root, 'sessions')], { ...options, env: { ...options.env, PI_LIFE_TEST_WORKSPACE: root } }) });
let bridge;
try {
  bridge = await createBridge().start();
  assert.equal(bridge.state.model.provider, 'deepseek');
  const settled = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('真实模型测试超时。')), 90000);
    const listen = event => { if (event.type === 'agent_settled') { clearTimeout(timer); bridge.off('event', listen); resolve(); } };
    bridge.on('event', listen);
  });
  const accepted = await bridge.command('prompt', { message: '这是虚构界面连通测试，没有真实个人资料。请仅回复“GUI_TEST_842_READY”，不要调用工具。' });
  assert.equal(accepted.disposition, 'started'); await settled; await bridge.refresh();
  assert.ok(bridge.messages.some(message => message.role === 'assistant' && message.text.includes('GUI_TEST_842_READY')));
  assert.ok(!bridge.messages.some(message => message.isError));
  const id = bridge.state.sessionId;
  await bridge.command('rename', { name: '虚构界面持久化测试' });
  assert.ok((await bridge.sessions()).some(item => item.id === id && item.name === '虚构界面持久化测试'));
  await bridge.command('new'); assert.notEqual(bridge.state.sessionId, id); assert.equal(bridge.messages.length, 0);
  await bridge.command('switch', { sessionId: id }); assert.ok(bridge.messages.some(message => message.text.includes('GUI_TEST_842_READY')));
  await bridge.stop(); bridge = await createBridge().start();
  await bridge.command('switch', { sessionId: id }); assert.equal(bridge.state.sessionName, '虚构界面持久化测试'); assert.ok(bridge.messages.some(message => message.text.includes('GUI_TEST_842_READY')));
  console.log('LIVE GUI PASS: personal DeepSeek response streamed; named session survives new/switch and process restart. Only a fictional test prompt sent.');
} finally { await bridge?.stop(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
