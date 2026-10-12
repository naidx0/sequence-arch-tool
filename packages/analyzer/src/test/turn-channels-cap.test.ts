import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_KEPT_BYTES, TurnChannel, type TurnClock } from '../server/turnChannels.js';

/*
 * 0.1.5 review: a channel kept up to 20,000 EVENTS for a page that comes back, whatever their size (up to ~160 MB
 * for one turn), and the `truncated` flag it set was read by nobody. The cap is now on the bytes kept, and a page that
 * comes back to a trimmed turn is told so first (acp:replay-truncated), so it can say so and rebuild from the record.
 */

const clock: TurnClock = { setTimeout: () => null, clearTimeout: () => {} };
const info = { turnId: 't', chatId: 'c', agentRef: 'codex', prompt: 'go', startedAt: 0 };
const size = (e: Record<string, unknown>) => Buffer.byteLength(JSON.stringify(e), 'utf8');

function follow(ch: TurnChannel): Record<string, unknown>[] {
  const got: Record<string, unknown>[] = [];
  ch.attach({ send: (e) => got.push(e), end: () => {} });
  return got;
}

test('a turn of a few large events is trimmed by bytes, not let through by count', () => {
  const ch = new TurnChannel(info, { clock, graceMs: 1000 });
  const big = 'x'.repeat(1024 * 1024);
  const n = Math.ceil((MAX_KEPT_BYTES * 2) / big.length);
  for (let i = 0; i < n; i += 1) ch.push({ type: 'acp:update', i, text: big });
  const got = follow(ch);
  const kept = got.filter((e) => e.type === 'acp:update');
  const bytes = kept.reduce((s, e) => s + size(e), 0);
  assert.ok(bytes <= MAX_KEPT_BYTES, `kept ${bytes} bytes, cap ${MAX_KEPT_BYTES}`);
  assert.ok(kept.length < n, 'some of the oldest were dropped');
  /* The newest are the ones kept, in order. */
  assert.equal(kept[kept.length - 1]!.i, n - 1);
  assert.deepEqual(kept.map((e) => e.i), [...kept.keys()].map((k) => n - kept.length + k));
  assert.equal(ch.truncated, true);
  /* The page that comes back hears first that the start is missing, and how much. */
  assert.equal(got[0]!.type, 'acp:replay-truncated');
  assert.equal(got[0]!.dropped, n - kept.length);
});

test('a turn under the cap is replayed whole, with no truncation notice', () => {
  const ch = new TurnChannel(info, { clock, graceMs: 1000 });
  for (let i = 0; i < 25_000; i += 1) ch.push({ type: 'acp:update', i });
  const got = follow(ch);
  /* Many small events are within the byte cap: none is dropped (the count cap used to drop 5,000 of these). */
  assert.equal(got.length, 25_000);
  assert.equal(ch.truncated, false);
  assert.equal(got[0]!.type, 'acp:update');
});

test('the turn id survives trimming: it is the first thing a page needs and is always replayed', () => {
  const ch = new TurnChannel(info, { clock, graceMs: 1000 });
  ch.push({ type: 'acp:turn-id', turnId: 't' });
  const big = 'x'.repeat(1024 * 1024);
  for (let i = 0; i < Math.ceil((MAX_KEPT_BYTES * 2) / big.length); i += 1) ch.push({ type: 'acp:update', i, text: big });
  const got = follow(ch);
  assert.deepEqual(got.slice(0, 2).map((e) => e.type), ['acp:replay-truncated', 'acp:turn-id']);
});
