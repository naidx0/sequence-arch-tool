import test from 'node:test';
import assert from 'node:assert/strict';
import { unique } from '../src/mod.js';
test('unique', () => {
  assert.deepEqual(unique([3, 1, 3, 2, 1]), [3, 1, 2]);
  assert.deepEqual(unique([]), []);
});
