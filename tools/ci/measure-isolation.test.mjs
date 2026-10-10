import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isolatedEnv, unisolatedCliSpawns } from '../measure/lib/isolatedEnv.mjs';

/* A measurement must never run the app against the real ~/.sequence: on
   2026-10-05 board-legibility overwrote the real last-place.json. Every
   spawn of the CLI under tools/measure goes through isolatedEnv. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEASURE = path.join(ROOT, 'tools', 'measure');

function measureFiles(dir = MEASURE) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'fixtures' && e.name !== 'node_modules') out.push(...measureFiles(p));
    else if (/\.m?js$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every spawn of the CLI under tools/measure passes env: isolatedEnv(...)', () => {
  const files = measureFiles();
  /* The scan has subjects: these tools start the app. */
  const spawning = files.filter((f) => /cli\.js/.test(fs.readFileSync(f, 'utf8')) && /\bspawn(Sync)?\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(spawning.length >= 4, `expected the app-spawning tools, found ${spawning.map((f) => path.basename(f))}`);
  const bad = files.flatMap((f) => unisolatedCliSpawns(fs.readFileSync(f, 'utf8')).map((line) => `${path.relative(ROOT, f)}:${line}`));
  assert.deepEqual(bad, []);
});

test('the scan catches a planted spawn that only sets SEQUENCE_HOME (negative control)', () => {
  const planted = [
    "const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');",
    "const cliArgs = [CLI, 'app', '--no-open'];",
    'const child = spawn(process.execPath, cliArgs, {',
    '  env: { ...process.env, SEQUENCE_HOME: home },',
    '});',
    "const ok = spawn(process.execPath, [CLI, 'app'], { env: isolatedEnv() });",
    "const other = spawn('git', ['status']);",
  ].join('\n');
  assert.deepEqual(unisolatedCliSpawns(planted), [3]);
});

test('isolatedEnv points the user store at a temp dir and refuses the real one', () => {
  const env = isolatedEnv({ PATH: 'x' });
  assert.ok(env.SEQUENCE_USER_DIR.startsWith(os.tmpdir()));
  assert.equal(env.SEQUENCE_HOME, env.SEQUENCE_USER_DIR);
  assert.equal(env.PATH, 'x');
  assert.throws(() => isolatedEnv({}, { userDir: path.join(os.homedir(), '.sequence') }), /refusing the real user store/);
});
