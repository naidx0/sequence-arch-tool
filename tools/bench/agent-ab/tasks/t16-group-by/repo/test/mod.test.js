import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBy } from '../src/mod.js';
test('groupBy', () => {
  assert.deepEqual(groupBy([1, 2, 3, 4, 5], (n) => (n % 2 ? 'odd' : 'even')), { odd: [1, 3, 5], even: [2, 4] });
  assert.deepEqual(groupBy([], (x) => x), {});
});
