import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { REBUILD, staleHalves } from './lock-guard.mjs';

/**
 * WHICH HALF IS BEHIND, AND WHO FIXES IT.
 *
 * `restart:app` reported success each time it ran on 2026-09-06 while the client
 * bundle stayed a night old, because a restart reloads what is on disk and
 * cannot rebuild a bundle. Six hours of a missing refusal followed, and the ask
 * it should have refused reached a model on another lane's card.
 *
 * So the two callers that act on staleness read it the same way, and one case
 * per half proves each is named and each is fixed by the right step.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const stamp = (server, client, processStale = false) => ({
  startedAt: '2026-09-06T12:00:00.000Z',
  builtAt: '2026-09-06T11:00:00.000Z',
  stale: processStale || server.stale || client.stale,
  server,
  client,
});
const half = (builtAt, sourceAt) => ({ builtAt, sourceAt, stale: sourceAt > builtAt });

const NIGHT = '2026-09-05T23:23:53.000Z';
const MORNING = '2026-09-06T12:11:47.000Z';

test('the CLIENT half behind its source is named, and it is the shape that hid the defect', () => {
  const h = staleHalves(stamp(half(MORNING, '2026-09-06T12:10:00.000Z'), half(NIGHT, MORNING)));
  assert.strictEqual(h.client, true);
  assert.strictEqual(h.server, false);
  assert.match(h.why, /client bundle built 2026-09-05T23:23/, 'the why names the bundle and its two times');
  assert.deepStrictEqual(REBUILD.client, ['--filter', '@sequence/web2', 'build'], 'and a restart alone will not fix it');
});

test('the SERVER half behind its source is named too — neither half is privileged', () => {
  const h = staleHalves(stamp(half(NIGHT, MORNING), half(MORNING, '2026-09-06T12:10:00.000Z')));
  assert.strictEqual(h.server, true);
  assert.strictEqual(h.client, false);
  assert.match(h.why, /server built 2026-09-05T23:23/);
  assert.deepStrictEqual(REBUILD.server, ['--filter', '@sequence/analyzer', 'build']);
});

test('both halves current reports neither, and no why to print', () => {
  const h = staleHalves(stamp(half(MORNING, NIGHT), half(MORNING, NIGHT)));
  assert.strictEqual(h.server, false);
  assert.strictEqual(h.client, false);
  assert.strictEqual(h.why, null);
});

test('a process that loaded before its own code is a RESTART, not a rebuild', () => {
  /*
   * The third kind of stale, and the only one a restart actually fixes. Kept
   * distinct so the advice matches the fault: rebuilding would do nothing here.
   */
  const h = staleHalves(stamp(half(MORNING, NIGHT), half(MORNING, NIGHT), true));
  assert.strictEqual(h.process, true);
  assert.strictEqual(h.server, false);
  assert.strictEqual(h.client, false);
});

test('an unreadable stamp is not evidence of freshness', () => {
  assert.strictEqual(staleHalves(null), null);
  assert.strictEqual(staleHalves(undefined), null);
});

test('restart:app rebuilds the stale half before it restarts', () => {
  /*
   * Source-scanned, because the property is ORDER: a rebuild after the restart
   * would restart into the old bundle and report success, which is exactly what
   * happened for six hours.
   */
  const src = fs.readFileSync(path.join(HERE, 'restart-if-stale.mjs'), 'utf8');
  const rebuildAt = src.indexOf('REBUILD[which]');
  assert.ok(rebuildAt > 0, 'it rebuilds the named half');
  const restartAt = src.indexOf('spawn(', rebuildAt);
  assert.ok(restartAt > rebuildAt, 'and the rebuild comes first');
  assert.match(src, /not restarting into a half-built tree/, 'a failed rebuild does not restart');
});

test('the seat names the stale half in its refusal', () => {
  const seat = fs.readFileSync(path.join(HERE, 'scripted-seat.mjs'), 'utf8');
  assert.match(seat, /CLIENT BUNDLE is behind its source/, 'the client case says a restart will not fix it');
  assert.match(seat, /SERVER build is behind its source/);
  assert.match(seat, /staleHalves\(stamp\)/, 'and it reads the halves from the same helper');
});
