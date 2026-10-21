import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agree, droppedFrames, median, percentile, summarize } from './stats.mjs';

test('median: odd, even, unsorted, empty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([10]), 10);
  assert.equal(median([]), null);
});

test('percentile is nearest-rank on 1..20', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 0.95), 19);
  assert.equal(percentile(xs, 0.5), 10);
  assert.equal(percentile(xs, 1), 20);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([], 0.95), null);
});

test('p95 of 10 runs is the 10th value; of 60 keystrokes the 57th', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.95), 100);
  const keys = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.equal(percentile(keys, 0.95), 57);
});

test('summarize ignores non-finite values and reports n', () => {
  const s = summarize([9, 1, NaN, 5, undefined, 3]);
  assert.deepEqual(s, { n: 4, median: 4, p95: 9, min: 1, max: 9 });
  assert.deepEqual(summarize([]), { n: 0, median: null, p95: null, min: null, max: null });
});

test('droppedFrames counts the frames a long delta swallowed', () => {
  assert.deepEqual(droppedFrames([16.7, 16.6, 50, 16.7]), { frames: 4, dropped: 2, over: 1 });
  assert.deepEqual(droppedFrames([16.7, 20, 24]), { frames: 3, dropped: 0, over: 1 });
  assert.equal(droppedFrames([100]).dropped, 5);
});

test('droppedFrames honours the display period', () => {
  assert.equal(droppedFrames([18, 18, 18, 18], 18).dropped, 0);
  assert.equal(droppedFrames([18, 18, 18, 18], 16.7).dropped, 0);
  assert.equal(droppedFrames([18, 54, 18], 18).dropped, 2);
});

test('agree: medians inside each other ranges; a clear shift disagrees', () => {
  const a = summarize([100, 110, 120, 130, 140]);
  const b = summarize([105, 115, 125, 135, 145]);
  assert.equal(agree(a, b), true);
  assert.equal(agree(a, summarize([400, 410, 420])), false);
});
