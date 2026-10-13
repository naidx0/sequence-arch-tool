import test from 'node:test';
import assert from 'node:assert/strict';
import { sumRange } from '../src/mod.js';
test('sumRange', () => {
  assert.equal(sumRange(1, 4), 10);
  assert.equal(sumRange(3, 3), 3);
  assert.equal(sumRange(0, 0), 0);
});
