import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ageText, freshnessLine } from '../server/graphStamp.js';

/* The graph-age wording, on an injected clock (no wall time). The s2a-session spawn test accepts "N min" under load; the freshness wording itself is held here. */
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MIN = 60_000;

test('a stamp from now, or 59 s ago, reads "under a minute old"', () => {
  assert.equal(ageText(ago(0), NOW), 'under a minute old');
  assert.equal(ageText(ago(59_000), NOW), 'under a minute old');
});

test('5 minutes ago reads "5 min old", 90 minutes "2 h old", 3 days "3 days old"', () => {
  assert.equal(ageText(ago(5 * MIN), NOW), '5 min old');
  assert.equal(ageText(ago(90 * MIN), NOW), '2 h old');
  assert.equal(ageText(ago(72 * 60 * MIN), NOW), '3 days old');
});

test('a future or missing stamp does not read as old; garbage reads "of unknown age"', () => {
  assert.equal(ageText(ago(-5 * MIN), NOW), 'under a minute old');
  assert.equal(ageText(null, NOW), 'of unknown age');
  assert.equal(ageText('not a date', NOW), 'of unknown age');
});

test('the freshness line: commit short sha, then the age; a base graph says so', () => {
  const stamp = { commit: 'abcdef1234567890', scannedAt: ago(5 * MIN) };
  assert.equal(freshnessLine(stamp, { now: NOW }), 'graph at abcdef1, 5 min old');
  assert.equal(freshnessLine({ ...stamp, scannedAt: ago(1000) }, { now: NOW }), 'graph at abcdef1, under a minute old');
  assert.equal(freshnessLine(stamp, { now: NOW, fromBase: true }), 'graph from base abcdef1, 5 min old (this worktree has no graph of its own)');
});
