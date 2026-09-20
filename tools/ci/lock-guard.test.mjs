import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { foreignLaneHolds } from './lock-guard.mjs';

/**
 * THE SEAT'S CARD GUARD — planted cases, built from the foreign lock line that
 * was actually on disk when a seat read spent another lane's GPU.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const FOREIGN =
  'lane=mlharness host=a-machine since=2026-09-06T11:12:20Z pid=31104 born=134331667399341176 what=the SEEDED sentinel pair, seed=20260906 temperature=0, 144 calls\n';

const withLock = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-guard-'));
  const p = path.join(dir, 'gpu.lock');
  if (body !== null) fs.writeFileSync(p, body);
  return { dir, p };
};

test('a FOREIGN lock line names its holder — the shape of the line from the night it was needed', () => {
  const { dir, p } = withLock(FOREIGN);
  try {
    assert.strictEqual(foreignLaneHolds(p, 'sequence'), 'mlharness');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('our own lock is not foreign — a lane may spend the card it holds', () => {
  const { dir, p } = withLock('lane=sequence since=2026-09-06T12:00:00Z pid=1 born=x what=mine\n');
  try {
    assert.strictEqual(foreignLaneHolds(p, 'sequence'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no lock file and no configured path both mean go ahead', () => {
  const { dir, p } = withLock(null);
  try {
    assert.strictEqual(foreignLaneHolds(p, 'sequence'), null, 'no file');
    assert.strictEqual(foreignLaneHolds('', 'sequence'), null, 'not configured');
    assert.strictEqual(foreignLaneHolds(undefined, 'sequence'), null, 'undefined');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock with no lane is UNREADABLE, not permission', () => {
  /*
   * Cannot-be-decided is not a yes. The same rule as the reaper that refuses to
   * clear a lock it cannot decide, and the build stamp that reports nulls rather
   * than a guessed freshness.
   */
  const { dir, p } = withLock('this is not a lock line\n');
  try {
    assert.strictEqual(foreignLaneHolds(p, 'sequence'), 'unreadable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the seat consults the guard BEFORE it types, and refuses with exit 3', () => {
  /*
   * Source-scanned, because what matters is WHERE the check sits: after the
   * typing it would be a report rather than a guard. The ask is typed by
   * `page.fill`/`type` further down; this asserts the lock read comes first.
   */
  const seat = fs.readFileSync(path.join(HERE, 'scripted-seat.mjs'), 'utf8');
  const guardAt = seat.indexOf('foreignLaneHolds(process.env.SEQUENCE_GPU_LOCK');
  assert.ok(guardAt > 0, 'the seat reads the lock');
  assert.match(seat.slice(guardAt, guardAt + 1200), /process\.exit\(3\)/, 'and refuses with exit 3');
  const typeAt = seat.indexOf('composerType');
  if (typeAt > 0) assert.ok(guardAt < typeAt, 'the lock is read before anything is typed');
});
