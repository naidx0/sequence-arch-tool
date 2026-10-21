// Time the code-first discovery on a folder of projects, and count what it visits.
import { discoverCodeFirst } from '../../packages/analyzer/dist/discovery/codefirst.js';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv', 'venv', '.next', '.turbo', 'vendor', '.pytest_cache', '.mypy_cache', 'target', '.gradle', '.claude', '.sequence', 'release', 'server-bundle', 'fixtures', '__fixtures__', 'testdata']);
let dirs = 0, files = 0;
const walk = (d, depth) => {
  if (depth > 4) return;
  dirs++;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (!e.isDirectory()) continue;
    if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
    walk(path.join(d, e.name), depth + 1);
  }
};
walk(repo, 0);

const t0 = performance.now();
const cf = discoverCodeFirst(repo);
const ms = performance.now() - t0;
console.log(JSON.stringify({ repo, discoveryMs: Math.round(ms), services: cf?.discovery.services.length ?? 0, depth4Dirs: dirs }));
