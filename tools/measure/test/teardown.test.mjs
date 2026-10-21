/* Teardown of board-legibility's temp dirs: retried, then a warning, never a red gate on valid measurements. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exitCode, removeDirPatiently } from '../lib/teardown.mjs';

const fail = (code) => () => { throw Object.assign(new Error(code), { code }); };
const noSleep = async () => {};

test('a busy directory is retried until it goes (positive control)', async () => {
  let n = 0;
  const rm = () => { if (++n < 4) fail('EBUSY')(); };
  const r = await removeDirPatiently('x', { rm, sleep: noSleep, warn: () => assert.fail('no warning expected') });
  assert.deepEqual([r.removed, r.attempts], [true, 4]);
});

test('EPERM and ENOTEMPTY are retried too', async () => {
  for (const code of ['EPERM', 'ENOTEMPTY']) {
    let n = 0;
    const r = await removeDirPatiently('x', { rm: () => { if (++n < 2) fail(code)(); }, sleep: noSleep });
    assert.equal(r.removed, true, code);
  }
});

test('backoff doubles and is bounded', async () => {
  const waits = [];
  const r = await removeDirPatiently('x', { rm: fail('EBUSY'), retries: 3, delayMs: 10, sleep: async (ms) => waits.push(ms), warn: () => {} });
  assert.deepEqual(waits, [10, 20, 40]);
  assert.deepEqual([r.removed, r.attempts, r.code], [false, 4, 'EBUSY']);
});

test('a directory that never goes warns loudly and does not throw', async () => {
  const warnings = [];
  const r = await removeDirPatiently('C:/tmp/stuck', { rm: fail('EBUSY'), retries: 2, sleep: noSleep, warn: (m) => warnings.push(m) });
  assert.equal(r.removed, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WARNING.*C:\/tmp\/stuck.*EBUSY/);
});

test('an unexpected error is reported once, not retried, and does not throw', async () => {
  let calls = 0;
  const warnings = [];
  const r = await removeDirPatiently('x', { rm: () => { calls++; fail('EACCES')(); }, sleep: noSleep, warn: (m) => warnings.push(m) });
  assert.deepEqual([calls, r.removed, warnings.length], [1, false, 1]);
});

test('really removes a directory (positive control on disk)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'teardown-test-'));
  fs.writeFileSync(path.join(d, 'a.txt'), 'x');
  const r = await removeDirPatiently(d);
  assert.equal(r.removed, true);
  assert.equal(fs.existsSync(d), false);
});

test('verdict: a measurement failure is red whatever teardown did; a stuck teardown alone is green', async () => {
  const stuck = await removeDirPatiently('x', { rm: fail('EBUSY'), retries: 1, sleep: noSleep, warn: () => {} });
  const clean = await removeDirPatiently('x', { rm: () => {}, sleep: noSleep });
  assert.equal(exitCode({ failed: false }), 0, 'valid measurements, stuck teardown');
  assert.equal(stuck.removed, false);
  assert.equal(exitCode({ failed: true }), 1, 'failed measurement, clean teardown (negative control)');
  assert.equal(clean.removed, true);
  assert.equal(exitCode({ failed: true }), 1, 'failed measurement, stuck teardown');
});

test('the tool routes its temp dirs through the patient teardown and its exit through exitCode', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'board-legibility.mjs'), 'utf8');
  assert.match(src, /removeDirPatiently\(home\)/);
  assert.match(src, /removeDirPatiently\(scanRoot\)/);
  assert.doesNotMatch(src, /fs\.rmSync\((home|scanRoot)/);
  assert.match(src, /process\.exit\(exitCode\(\{ failed \}\)\)/);
});
