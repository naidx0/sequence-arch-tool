import assert from 'node:assert/strict';
import { test } from 'node:test';

import { uniqueSessionId } from '../server/sessionsStore.js';
import { isCheckpointSessionId } from '../server/checkpointStore.js';

/**
 * A FRESH SESSION ID NEVER REPEATS ACROSS ROOTS.
 *
 * `defaultSessionId()` is seconds modulo 10,000 — the space wraps every
 * 2 h 46 m — and `uniqueSessionId` only knows ONE root's index. The client keys
 * its localStorage pads by id alone, so a New Chat in `~` could mint the id of
 * a deleted thread, or of a thread in another repo, and open onto its AI
 * Canvas drawing (owner walk 2026-09-17). The tail makes that a 36^4 : 1 event
 * per second instead of a certainty every few hours.
 */
test('every minted id carries a random tail, even with no collision in sight', () => {
  const id = uniqueSessionId(new Set());
  assert.match(id, /^session-\d{4}-[a-z0-9]{4}$/, `expected a tailed id, got ${id}`);
  assert.ok(isCheckpointSessionId(id), 'the tailed form must still be a valid path segment');
});

test('two ids minted in the same second differ', () => {
  const a = uniqueSessionId(new Set());
  const b = uniqueSessionId(new Set([a]));
  assert.notEqual(a, b);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) seen.add(uniqueSessionId(new Set()));
  assert.ok(seen.size > 190, `200 mints in one second produced only ${seen.size} distinct ids`);
});
