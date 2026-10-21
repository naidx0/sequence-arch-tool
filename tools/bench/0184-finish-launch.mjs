// Preserve real source structure while excluding secrets and all existing app state.
// Usage: node tools/bench/0184-finish-launch.mjs <real-source> <new-owned-output> <label>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { IGNORE_DIRS } from '../../packages/analyzer/dist/ignoreDirs.js';

const [input, output, label = 'finish-current'] = process.argv.slice(2);
if (!input || !output) throw Error('usage: <real-source> <new-owned-output> <label>');
const source = fs.realpathSync(input);
const out = path.resolve(output);
if (fs.existsSync(out)) throw Error('refusing an existing output directory');
if (out === source || out.startsWith(source + path.sep)) throw Error('specimen must be outside the real source');
const repo = path.join(out, 'sequence');
fs.mkdirSync(repo, { recursive: true });
const files = [];
const hash = createHash('sha256');
function copy(from, to, prefix = '') {
  for (const e of fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || (e.isDirectory() && (IGNORE_DIRS.has(e.name) || e.name === 'workspaces'))) continue;
    const src = path.join(from, e.name);
    const dest = path.join(to, e.name);
    const rel = `${prefix}${e.name}`;
    if (e.isDirectory()) { fs.mkdirSync(dest); copy(src, dest, `${rel}/`); }
    else if (e.isFile()) { const bytes = fs.readFileSync(src); fs.writeFileSync(dest, bytes); files.push(rel); hash.update(rel).update('\0').update(bytes); }
  }
}
copy(source, repo);
fs.writeFileSync(path.join(out, '.0184-launch-specimen'), 'Disposable safe source snapshot; created by 0184-finish-launch.mjs\n');
fs.writeFileSync(path.join(out, 'specimen.json'), JSON.stringify({ source, files: files.length, sha256: hash.digest('hex'), excludes: 'all dot entries including every .env variant, symlinks, scanner ignored directories, workspaces' }, null, 2));
const run = spawnSync(process.execPath, ['tools/bench/0184-launch.mjs', out, label, source], { cwd: process.cwd(), stdio: 'inherit' });
process.exit(run.status ?? 1);
