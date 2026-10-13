import test from 'node:test';
import assert from 'node:assert/strict';
import { sameSet } from '../src/mod.js';
test('sameSet', () => {
  assert.equal(sameSet([1, 2, 3], [3, 2, 1]), true);
  assert.equal(sameSet([1, 1, 2], [2, 1]), true);
  assert.equal(sameSet([1, 2], [1, 3]), false);
});
