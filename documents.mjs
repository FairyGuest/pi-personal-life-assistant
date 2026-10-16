import path from 'node:path';
import { realpathSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import workspaceSettings from './workspace.cjs';

export function inboxPath(workspace, filename) {
  if (typeof filename !== 'string' || !filename.trim() || path.isAbsolute(filename) || filename.includes(':')) throw new Error('只接受inbox内相对文件名。');
  const canonicalWorkspace = realpathSync(workspace);
  const root = realpathSync(path.join(workspace, 'inbox'));
  const inboxRelative = path.relative(canonicalWorkspace, root);
  if (!inboxRelative || inboxRelative.startsWith('..') || path.isAbsolute(inboxRelative)) throw new Error('inbox不能通过链接指向工作区外。');
  const candidate = realpathSync(path.join(root, filename));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件必须位于独立工作区的inbox内；不允许符号链接越界。');
  if (!['.pdf', '.txt', '.md', '.csv', '.docx'].includes(path.extname(candidate).toLowerCase())) throw new Error('支持PDF、DOCX及纯文本，不读取凭据文件或执行程序。');
  const stat = statSync(candidate);
  if (!stat.isFile() || stat.size > 20_000_000) throw new Error('只允许不超过20MB的普通文档。');
  return candidate;
}

export function listInbox(workspace) {
  return readdirSync(path.join(workspace, 'inbox')).filter(filename => /\.(pdf|txt|md|csv|docx)$/i.test(filename));
}

export async function readDocument(workspace, filename, signal) {
  const candidate = inboxPath(workspace, filename);
  const extension = path.extname(candidate).toLowerCase();
  const bytes = readFileSync(candidate);
  if (['.txt', '.md', '.csv'].includes(extension)) return { filename, text: bytes.toString('utf8').slice(0, 20000), truncated: bytes.toString('utf8').length > 20000 };
  const extractor = fileURLToPath(new URL('./extract-document.py', import.meta.url));
  const python = workspaceSettings.PYTHON;
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE'].includes(name.toUpperCase())));
    const child = spawn(python, [extractor, extension], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal: combined, env: { ...environment, PYTHONIOENCODING: 'utf-8' } });
    const chunks = []; let length = 0;
    child.stdout.on('data', chunk => { length += chunk.length; if (length > 200000) child.kill(); else chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 || length > 200000) { reject(new Error('文档提取失败：可能加密、损坏或无文字层；扫描件需先OCR。')); return; }
      try { resolve({ filename, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { reject(new Error('文档提取未返回有效结果。')); }
    });
    child.stdin.end(bytes);
  });
}
