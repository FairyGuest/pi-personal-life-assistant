import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationRoot = fileURLToPath(new URL('../', import.meta.url));

export function applicationRevision(root = applicationRoot) {
  const hash = createHash('sha256');
  for (const directory of ['', 'gui', 'gui/public']) {
    const folder = path.join(root, directory);
    const files = readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(?:mjs|cjs|js|json|html|css|svg)$/.test(entry.name)).map(entry => entry.name).sort();
    for (const filename of files) hash.update(`${directory}/${filename}\0`).update(readFileSync(path.join(folder, filename))).update('\0');
  }
  return hash.digest('hex');
}

export function snapshotAssets(root, manifest) {
  return new Map(Object.entries(manifest).map(([route, [filename, mime]]) => [route, { body: readFileSync(path.join(root, filename)), mime }]));
}
