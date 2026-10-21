#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   COLLECT THE RATCHET'S COUNTS, THEN CHECK THEM
   tools/measure/perf-counts.mjs

   Needs the built analyzer and web2 (it measures the shipped bundle) and a
   Chromium for first-board. Calls no model.

     bootJsBytes, bootModules, bootRequests   first-board.mjs --scenario restored-architecture,
                                              three cold reads that must agree
     commitsPerKeystroke, commitsPerStreamChunk
                                              web2 src/chat/perfCounts.test.tsx

   Writes the measured counts to --out (default: a temp file) and runs
   tools/ci/perf-ratchet.mjs on them; the exit code is the ratchet's.

     node tools/measure/perf-counts.mjs [--out measured.json]
   ══════════════════════════════════════════════════════════════════════════ */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOT_KEYS, agreedBootReads } from '../ci/perf-ratchet.mjs';
import { validateBoardSample } from './lib/first-board-scenario.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = process.argv.indexOf('--out');
const OUT = at > 0 ? path.resolve(process.argv[at + 1]) : path.join(os.tmpdir(), `perf-counts-${process.pid}.json`);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-counts-'));

/*
 * THREE COLD READS THAT MUST AGREE. One read could come in low (a boot window
 * that closed before the ELK chunk was requested: ~1,024,500 B in 3 of 12
 * reads before first-board waited for the first layout), and a low read is how
 * a ratchet gets a ceiling nobody can meet. So the boot counts are read three
 * times; any disagreement fails loudly with every read printed, and only an
 * agreed number is handed to the ratchet, tagged `$reads` so it may suggest a
 * lower ceiling.
 */
const READS = 3;
const fb = path.join(work, 'first-board.json');
const board = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'measure', 'first-board.mjs'), '--scenario', 'restored-architecture', '--runs', String(READS), '--cold', '--out', fb], { cwd: ROOT, stdio: 'inherit' });
if (board.status !== 0 || !fs.existsSync(fb)) {
  console.error('perf-counts: first-board did not produce counts');
  process.exit(1);
}
const { summary, rows } = JSON.parse(fs.readFileSync(fb, 'utf8'));
for (const row of rows) validateBoardSample(row, true);
const agreed = agreedBootReads(rows);
if (!agreed.ok) {
  console.error(`perf-counts: FAIL — the ${READS} boot reads disagree (${BOOT_KEYS.join('/')}):`);
  rows.forEach((r, n) => console.error(`  read ${r.run}: ${agreed.keys[n]}  [${(r.requestPaths ?? []).join(', ')}]`));
  console.error('perf-counts: no ceiling may be set from these; find what moves between reads first.');
  process.exit(1);
}

const commits = path.join(work, 'commits.json');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const vt = spawnSync(pnpm, ['--filter', '@sequence/web2', 'exec', 'vitest', 'run', 'src/chat/perfCounts.test.tsx'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PERF_COUNTS_OUT: commits },
});
if (vt.status !== 0 || !fs.existsSync(commits)) {
  console.error('perf-counts: the render-count test did not produce counts');
  process.exit(1);
}

const measured = {
  $reads: READS,
  bootJsBytes: summary.bootJsBytes,
  bootModules: summary.bootModules,
  bootRequests: summary.bootRequests,
  ...JSON.parse(fs.readFileSync(commits, 'utf8')),
};
fs.writeFileSync(OUT, JSON.stringify(measured, null, 2));
fs.rmSync(work, { recursive: true, force: true });
console.log('MEASURED ' + JSON.stringify(measured));
const check = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'ci', 'perf-ratchet.mjs'), OUT], { cwd: ROOT, stdio: 'inherit' });
process.exit(check.status ?? 1);
