#!/usr/bin/env node
/*
 * desktop-zip-smoke — extract the portable Windows zip somewhere it was not
 * built, and run it.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * Owner, 2026-09-19, relaying a friend's report of the published 0.1.0
 * installer: "the actual package is broken... make sure people can just fresh
 * download with nothing else, no worries of anything else, and just literally
 * run the product from wherever."
 *
 * `tools/desktop-smoke.mjs --packaged` runs `release/win-unpacked/Sequence.exe`
 * — which is the right check for "does the packaged app work" and the wrong
 * one for "does it work somewhere else". It runs inside the build tree, so a
 * path baked in at build time passes it. That is not a hypothetical: the Tauri
 * shell in this project's history did exactly that, and the binary pointed at
 * the checkout it was built in.
 *
 * So this extracts the ZIP — the artifact a person downloads — to a directory
 * that is not the build tree and whose name contains a SPACE, and runs it
 * there. A space because `%ProgramFiles%`, `C:\Users\First Last` and
 * `~/Downloads/Sequence 0.1.0` all have one, and an unquoted spawn survives
 * every path in a repository and dies on the first real machine.
 *
 * ── MEASURED ──────────────────────────────────────────────────────────────
 *
 * 2026-09-19, on `Sequence-0.1.0-win.zip` (143.0 MB), extracted to
 * "…/scratchpad/Fresh Download Test": PASS — the child server came up on
 * 127.0.0.1 and the window settled on `composer`.
 *
 * ── CONTRACT ──────────────────────────────────────────────────────────────
 *
 * The same one `desktop-smoke.mjs` holds, and for the same reason: the real
 * `main.ts` under `SEQUENCE_DESKTOP_SMOKE=1` prints exactly one
 * `SEQUENCE_DESKTOP_SMOKE` line and exits. NO LINE IS A FAILURE, NEVER A PASS
 * — an exit code of 0 with nothing reported is what a shell that quits before
 * creating its window looks like.
 *
 * Usage:
 *   node tools/desktop-zip-smoke.mjs              # find, extract and run the zip
 *   node tools/desktop-zip-smoke.mjs <dir>        # run an already-extracted copy
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'packages', 'desktop', 'release');

/* A SPACE IN THE NAME IS PART OF THE TEST, not decoration. */
const EXTRACT_TO = path.join(os.tmpdir(), 'Sequence Zip Smoke');

function skip(reason) {
  console.log(`SKIP  desktop-zip-smoke — ${reason}`);
  process.exit(0);
}

function sevenZip() {
  /* electron-builder depends on 7zip-bin, so after `pnpm install` this is
     already on disk. Resolved rather than shelled out to, because the machine
     may have no 7-Zip of its own and Expand-Archive takes minutes on 143 MB. */
  const base = path.join(ROOT, 'node_modules', '.pnpm');
  if (!fs.existsSync(base)) return null;
  const dir = fs.readdirSync(base).find((d) => d.startsWith('7zip-bin@'));
  if (!dir) return null;
  const exe = path.join(base, dir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  return fs.existsSync(exe) ? exe : null;
}

function findZip() {
  if (!fs.existsSync(RELEASE)) return null;
  const hit = fs.readdirSync(RELEASE).find((f) => /-win\.zip$/.test(f));
  return hit ? path.join(RELEASE, hit) : null;
}

function extract() {
  if (process.platform !== 'win32') skip('the portable zip is a Windows artifact');
  const zip = findZip();
  if (!zip) skip('no *-win.zip under packages/desktop/release — run `pnpm desktop:dist` first');
  const sz = sevenZip();
  if (!sz) skip('7za.exe not found under node_modules/.pnpm — run `pnpm install`');

  fs.rmSync(EXTRACT_TO, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_TO, { recursive: true });
  const un = spawnSync(sz, ['x', '-y', `-o${EXTRACT_TO}`, zip], { stdio: 'ignore' });
  if (un.status !== 0) {
    console.error(`FAIL  desktop-zip-smoke — could not extract ${path.basename(zip)}`);
    process.exit(1);
  }
  console.log(`      extracted  ${path.basename(zip)} -> ${EXTRACT_TO}`);
  return EXTRACT_TO;
}

const dir = process.argv[2] ? path.resolve(process.argv[2]) : extract();
const bin = path.join(dir, 'Sequence.exe');
if (!fs.existsSync(bin)) {
  console.error(`FAIL  desktop-zip-smoke — no Sequence.exe in ${dir}`);
  process.exit(1);
}

const child = spawn(bin, ['.'], {
  cwd: dir,
  env: { ...process.env, SEQUENCE_DESKTOP_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (b) => { out += b.toString(); });
child.stderr.on('data', (b) => { out += b.toString(); });

const kill = setTimeout(() => {
  console.error('FAIL  desktop-zip-smoke — the extracted app did not exit within 150s');
  child.kill('SIGKILL');
  process.exit(1);
}, 150000);

child.on('exit', (code) => {
  clearTimeout(kill);
  const line = out.split(/\r?\n/).find((l) => l.startsWith('SEQUENCE_DESKTOP_SMOKE '));
  if (!line) {
    console.error(`FAIL  desktop-zip-smoke — exited ${code} without reporting`);
    console.error(out.split(/\r?\n/).slice(-25).join('\n'));
    process.exit(1);
  }
  const detail = JSON.parse(line.slice(line.indexOf('{')));
  if (!line.startsWith('SEQUENCE_DESKTOP_SMOKE PASS') || code !== 0) {
    console.error('FAIL  desktop-zip-smoke');
    console.error('      ' + JSON.stringify(detail, null, 2).split('\n').join('\n      '));
    process.exit(1);
  }
  console.log('PASS  desktop-zip-smoke — the portable copy ran outside the build tree');
  console.log(`      from       ${dir}`);
  console.log(`      url        ${detail.href}`);
  console.log(`      settled on ${detail.state ?? JSON.stringify(detail)}`);
});
