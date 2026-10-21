import test from 'node:test';
import assert from 'node:assert/strict';
import { maxBy } from '../src/mod.js';
test('maxBy', () => {
  assert.equal(maxBy([{ n: 1 }, { n: 5 }, { n: 3 }], (o) => o.n).n, 5);
  assert.equal(maxBy([], (x) => x), undefined);
});
