import test from 'node:test';
import assert from 'node:assert/strict';
import { range } from '../src/mod.js';
test('range', () => {
  assert.deepEqual(range(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(range(5, 0, -2), [5, 3, 1]);
  assert.deepEqual(range(0, 3, 0), []);
});
