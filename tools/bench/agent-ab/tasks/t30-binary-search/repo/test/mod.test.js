import test from 'node:test';
import assert from 'node:assert/strict';
import { binarySearch } from '../src/mod.js';
test('binarySearch', () => {
  const a = [1, 3, 5, 7, 9];
  assert.equal(binarySearch(a, 9), 4);
  assert.equal(binarySearch(a, 1), 0);
  assert.equal(binarySearch(a, 4), -1);
  assert.equal(binarySearch([], 1), -1);
  assert.equal(binarySearch([2], 2), 0);
});
