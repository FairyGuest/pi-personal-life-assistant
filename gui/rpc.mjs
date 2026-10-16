import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import launcher from '../../deepseek-only.cjs';
import settings from '../workspace.cjs';

export function jsonLines(onValue, onError) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  return chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 16 * 1024 * 1024) { buffer = ''; onError(new Error('Pi事件超过大小限制。')); return; }
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (!line) continue;
      try { onValue(JSON.parse(line)); } catch (error) { onError(error); }
    }
  };
}

export function messageView(message) {
  if (!['user', 'assistant', 'toolResult'].includes(message?.role)) return null;
  const text = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (!text && message.role !== 'assistant') return null;
  return { role: message.role, text, timestamp: message.timestamp, toolName: message.toolName, isError: message.isError || message.stopReason === 'error' };
}

export class PiBridge extends EventEmitter {
  constructor({ workspace = settings.WORKSPACE, spawnProcess = spawn, requestTimeout = 3600000 } = {}) {
    super();
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.requestTimeout = requestTimeout;
    this.pending = new Map();
    this.dialogs = new Map();
    this.dialogTimers = new Map();
    this.messages = [];
    this.notifications = [];
    this.streamingText = '';
    this.busy = false;
    this.operation = null;
    this.closed = false;
    this.state = {};
  }

  async start() {
    const packageRoot = path.join(process.env.APPDATA, 'npm', 'node_modules', '@earendil-works', 'pi-coding-agent');
    const module = await import(pathToFileURL(path.join(packageRoot, 'dist', 'core', 'session-manager.js')).href);
    this.SessionManager = module.SessionManager;
    const environment = launcher.createLifeEnvironment(process.env);
    environment.PI_CODING_AGENT_SESSION_DIR = path.join(this.workspace, 'sessions');
    this.child = this.spawnProcess(process.execPath, [path.join(packageRoot, 'dist', 'bundle', 'cli.js'), ...launcher.createLifeArguments(['--mode', 'rpc', '--session-dir', path.join(this.workspace, 'sessions')])], { cwd: this.workspace, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const fail = error => {
      this.busy = false;
      this.closed = true;
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
      this.pending.clear();
      this.clearDialogs();
      this.emit('event', { type: 'bridge_error', message: 'Pi连接中断，请关闭服务后重新打开生活助手。' });
    };
    this.child.on('error', fail);
    this.child.on('exit', () => fail(new Error('Pi进程已退出。')));
    this.child.stdin.on('error', fail);
    this.child.stdout.on('data', jsonLines(value => this.receive(value), () => fail(new Error('Pi返回了无效事件。'))));
    this.child.stderr.on('data', () => {});
    await this.refresh();
    if (this.state.model?.provider !== 'deepseek') { this.stop(); throw new Error('界面只允许个人DeepSeek模型。'); }
    return this;
  }

  request(type, fields = {}) {
    if (this.closed) return Promise.reject(new Error('Pi连接已关闭。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Pi操作超时；请检查界面中的待确认对话框。')); }, type === 'prompt' ? this.requestTimeout : 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ ...fields, id, type })}\n`);
    });
  }

  receive(value) {
    if (value.type === 'response') {
      const task = this.pending.get(value.id);
      if (task) { clearTimeout(task.timer); this.pending.delete(value.id); value.success ? task.resolve(value.data) : task.reject(new Error(value.error || 'Pi操作失败。')); }
      return;
    }
    if (value.type === 'agent_start') { this.busy = true; this.streamingText = ''; }
    if (value.type === 'message_start' && value.message?.role === 'assistant') this.streamingText = '';
    if (value.type === 'message_update' && value.assistantMessageEvent?.type === 'text_delta') this.streamingText += value.assistantMessageEvent.delta;
    if (value.type === 'message_end') {
      const view = messageView(value.message);
      if (view) this.messages.push(view);
      if (value.message?.role === 'assistant') this.streamingText = '';
    }
    if (value.type === 'agent_settled') { this.busy = false; this.streamingText = ''; this.refresh().then(() => this.emit('event', { type: 'snapshot', ...this.snapshot() })).catch(() => {}); }
    if (value.type === 'extension_ui_request') {
      if (['confirm', 'select', 'input', 'editor'].includes(value.method)) {
        const timeout = Math.min(value.timeout ?? 600000, 600000);
        const dialog = { ...value, expiresAt: Date.now() + timeout };
        this.dialogs.set(value.id, dialog);
        this.dialogTimers.set(value.id, setTimeout(() => {
          this.respond(value.id, { cancelled: true });
          this.emit('event', { type: 'dialog_expired', id: value.id });
        }, timeout));
        value = dialog;
      }
      if (value.method === 'notify') { this.notifications.push(value); this.notifications = this.notifications.slice(-20); }
    }
    this.emit('event', value);
  }

  respond(id, answer) {
    const dialog = this.dialogs.get(id);
    if (!dialog) throw new Error('确认已经失效，请重新操作。');
    let response;
    if (answer.cancelled === true) response = { cancelled: true };
    else if (dialog.method === 'confirm' && typeof answer.confirmed === 'boolean') response = { confirmed: answer.confirmed };
    else if (['input', 'editor', 'select'].includes(dialog.method) && typeof answer.value === 'string' && answer.value.length <= 16000 && (dialog.method !== 'select' || dialog.options.includes(answer.value))) response = { value: answer.value };
    else throw new Error('无效的确认答复。');
    this.child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id, ...response })}\n`);
    this.dialogs.delete(id);
    clearTimeout(this.dialogTimers.get(id));
    this.dialogTimers.delete(id);
    this.emit('event', { type: 'dialog_answered', id });
  }

  clearDialogs() {
    for (const timer of this.dialogTimers.values()) clearTimeout(timer);
    this.dialogTimers.clear(); this.dialogs.clear();
  }

  async refresh() {
    const [state, result] = await Promise.all([this.request('get_state'), this.request('get_messages')]);
    this.state = state;
    this.messages = (result.messages ?? []).map(messageView).filter(Boolean);
    this.busy = Boolean(state.isStreaming);
  }

  snapshot() {
    return { state: { sessionId: this.state.sessionId, sessionName: this.state.sessionName, model: this.state.model?.id ?? this.state.model?.modelId ?? 'deepseek-flash', provider: this.state.model?.provider, busy: this.busy, operation: Boolean(this.operation), connected: !this.closed }, messages: this.messages, streamingText: this.streamingText, dialogs: [...this.dialogs.values()], notifications: this.notifications };
  }

  async sessions() {
    const root = path.join(this.workspace, 'sessions');
    const rows = await this.SessionManager.list(this.workspace, root);
    const items = rows.filter(row => path.resolve(row.cwd).toLowerCase() === path.resolve(this.workspace).toLowerCase()).map(row => ({ id: row.id, name: row.name || row.firstMessage?.slice(0, 40) || '新对话', modified: row.modified, messageCount: row.messageCount }));
    if (this.state.sessionId && !items.some(row => row.id === this.state.sessionId)) items.unshift({ id: this.state.sessionId, name: this.state.sessionName || '新对话', modified: new Date().toISOString(), messageCount: this.messages.length });
    return items;
  }

  async command(type, fields = {}) {
    if (fields.expectedSessionId && fields.expectedSessionId !== this.state.sessionId) throw new Error('当前会话已在其他窗口切换，请刷新确认后重试。');
    if (this.operation || this.busy || this.dialogs.size) throw new Error('请先完成当前对话或取消待确认操作。');
    this.operation = type;
    this.emit('event', { type: 'operation_start' });
    try {
      let result;
      if (type === 'switch') {
        if (typeof fields.sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(fields.sessionId)) throw new Error('会话标识无效。');
        if (fields.sessionId === this.state.sessionId) return;
        const root = realpathSync(path.join(this.workspace, 'sessions'));
        const candidate = this.SessionManager.findById(this.workspace, fields.sessionId, root);
        if (!candidate) throw new Error('此工作区中没有该会话。');
        const sessionPath = realpathSync(candidate);
        const relative = path.relative(root, sessionPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('拒绝工作区以外的会话。');
        if (path.resolve(this.SessionManager.open(sessionPath, root).getCwd()).toLowerCase() !== path.resolve(this.workspace).toLowerCase()) throw new Error('只能打开当前生活工作区的会话。');
        result = await this.request('switch_session', { sessionPath });
      } else if (type === 'new') result = await this.request('new_session');
      else if (type === 'rename') {
        if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 100) throw new Error('会话名称应为1—100字。');
        result = await this.request('set_session_name', { name: fields.name.trim() });
      } else if (type === 'prompt') {
        if (typeof fields.message !== 'string' || !fields.message.trim() || fields.message.length > 20000) throw new Error('请输入1—20000字。');
        const message = fields.message.trim();
        if (/^[!@]/.test(message) || (message.startsWith('/') && !/^\/(?:life|profile|metrics|plans|skills)(?:\s|$)|^\/skill:(?:life-planning|fitness-tracking|finance-planning|career-search|learning-research|emotional-support)(?:\s|$)/.test(message))) throw new Error('生活界面不接受系统命令、外部附件或其他扩展命令。');
        result = await this.request('prompt', { message });
        if (result?.disposition === 'started') this.busy = true;
      } else throw new Error('不支持此操作。');
      if (result?.cancelled) throw new Error('Pi取消了会话切换。');
      if (type !== 'prompt') { this.notifications = []; this.streamingText = ''; }
      if (type !== 'prompt' || result?.disposition !== 'started') await this.refresh();
      return result;
    } finally { this.operation = null; this.emit('event', { type: 'snapshot', ...this.snapshot() }); }
  }

  async abort() {
    for (const id of [...this.dialogs.keys()]) this.respond(id, { cancelled: true });
    await this.request('clear_queue');
    await this.request('abort');
    await this.refresh();
    this.emit('event', { type: 'snapshot', ...this.snapshot() });
  }

  async stop() {
    this.closed = true;
    this.clearDialogs();
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('服务已关闭。')); }
    this.pending.clear();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise(resolve => { const timer = setTimeout(resolve, 3000); this.child.once('close', () => { clearTimeout(timer); resolve(); }); this.child.kill(); });
    }
  }
}
