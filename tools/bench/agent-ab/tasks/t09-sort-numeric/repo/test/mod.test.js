import test from 'node:test';
import assert from 'node:assert/strict';
import { sortNumbers } from '../src/mod.js';
test('sortNumbers', () => {
  const input = [10, 9, 1, 100];
  assert.deepEqual(sortNumbers(input), [1, 9, 10, 100]);
  assert.deepEqual(input, [10, 9, 1, 100]);
});
