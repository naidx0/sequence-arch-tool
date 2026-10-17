import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/mod.js';
test('formatDuration', () => {
  assert.equal(formatDuration(3661), '1h 1m 1s');
  assert.equal(formatDuration(61), '1m 1s');
  assert.equal(formatDuration(5), '5s');
  assert.equal(formatDuration(0), '0s');
});
