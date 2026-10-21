import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* The pre-push hook must not hand git's hook variables (GIT_DIR and friends) to the counting gate:
   tests that build throwaway repos would act on this repo instead. Reproduced 2026-10-12: with GIT_DIR
   set, the gate failed 10 tests that pass in a plain shell. */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'pre-push.mjs'), 'utf8').replace(/\r\n/g, '\n');

test('the counting gate runs with GIT_* variables removed from its environment', () => {
  assert.match(src, /const gateEnv = Object\.fromEntries\(Object\.entries\(process\.env\)\.filter\(\(\[k\]\) => !\/\^GIT_\/i\.test\(k\)\)\)/);
  const call = src.slice(src.indexOf("const gate = spawnSync("), src.indexOf("const gate = spawnSync(") + 300);
  assert.match(call, /env: gateEnv/);
});

test('the filter drops git hook variables and keeps the rest (control)', () => {
  const env = { GIT_DIR: 'x', GIT_INDEX_FILE: 'y', git_work_tree: 'z', PATH: 'p', HOME: 'h' };
  const kept = Object.fromEntries(Object.entries(env).filter(([k]) => !/^GIT_/i.test(k)));
  assert.deepEqual(kept, { PATH: 'p', HOME: 'h' });
});
