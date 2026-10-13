import test from 'node:test';
import assert from 'node:assert/strict';
import { average } from '../src/mod.js';
test('average', () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([]), 0);
});
