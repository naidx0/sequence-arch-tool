import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten } from '../src/mod.js';
test('flatten', () => {
  assert.deepEqual(flatten([1, [2, [3, [4]]], 5]), [1, 2, 3, 4, 5]);
  assert.deepEqual(flatten([]), []);
});
