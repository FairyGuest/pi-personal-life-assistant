import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { LIFE_SKILLS } from '../skills.mjs';
import workspaceSettings from '../workspace.cjs';

const require = createRequire(import.meta.url);
const launcher = path.join(process.env.USERPROFILE, '.pi', 'agent', 'deepseek-only.cjs');
const { createLifeArguments, createPiEnvironment } = require(launcher);

test('launcher forces life tools and blocks external code/context injection', () => {
  const args = createLifeArguments([]);
  assert.ok(args.includes('--no-extensions'));
  assert.ok(args.includes('--no-mcp'));
  assert.ok(args.includes('--no-skills'));
  assert.ok(args.includes('--no-context-files'));
  assert.ok(args.includes('--no-builtin-tools'));
  assert.ok(args.some(value => value.endsWith('life-assistant.ts')));
  assert.ok(args.some(value => value.endsWith('life-ui.ts')));
  assert.ok(!args.some(value => value.includes('pi-native-app')));
  assert.throws(() => createLifeArguments(['--extension', 'evil.js']), /外部/);
  assert.throws(() => createLifeArguments(['--system-prompt', 'fake']), /外部/);
  assert.throws(() => createLifeArguments(['@secret.txt']), /附件/);
  assert.throws(() => createLifeArguments(['--provider', 'anthropic']), /DeepSeek/);
  assert.deepEqual(createLifeArguments(['auth', 'check', '--provider', 'deepseek']), ['auth', 'check', '--provider', 'deepseek']);
});

test('credential filtering leaves other applications environment unchanged', () => {
  const original = { ANTHROPIC_API_KEY: 'fictional', OPENAI_API_KEY: 'fictional', DEEPSEEK_API_KEY: 'fictional-personal', PATH: 'path' };
  const sanitized = createPiEnvironment(original);
  assert.equal(sanitized.ANTHROPIC_API_KEY, undefined);
  assert.equal(sanitized.OPENAI_API_KEY, undefined);
  assert.equal(sanitized.DEEPSEEK_API_KEY, 'fictional-personal');
  assert.equal(original.ANTHROPIC_API_KEY, 'fictional');
});

test('real offline RPC loads life commands without reading personal records', async () => {
  const child = spawn(process.execPath, [launcher, '--offline', '--mode', 'rpc', '--no-session'], { cwd: process.cwd(), env: createPiEnvironment(process.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map(); let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  lines.on('line', line => {
    try {
      const event = JSON.parse(line);
      if (event.type === 'response' && pending.has(event.id)) { const resolve = pending.get(event.id); pending.delete(event.id); resolve(event); }
    } catch {}
  });
  const request = (id, type, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${errors.slice(0, 500)}`)), 20000);
    pending.set(id, response => { clearTimeout(timer); resolve(response); });
    child.stdin.write(`${JSON.stringify({ id, type, ...params })}\n`);
  });
  try {
    const state = await request('state', 'get_state');
    assert.equal(state.success, true);
    assert.equal(state.data.model.provider, 'deepseek');
    const commands = await request('commands', 'get_commands');
    const names = commands.data.commands.map(command => command.name);
    for (const name of ['life', 'profile', 'metrics', 'plans', 'skills', 'app']) assert.ok(names.includes(name));
    assert.deepEqual(names.filter(name => name.startsWith('skill:')).sort(), LIFE_SKILLS.map(skill => `skill:${skill.name}`).sort());
    const bash = await request('shell-denial', 'bash', { command: 'echo SHOULD_NOT_EXECUTE' });
    assert.equal(bash.success, false);
    assert.match(bash.error, /关闭|生活模式/);
    assert.equal(workspaceSettings.WORKSPACE, 'D:\\PersonalAgent');
    assert.ok(!errors.includes('Failed to load extension'));
  } finally {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 2000); child.once('close', () => { clearTimeout(timer); resolve(); }); });
  }
});
