import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBatcher } from '../src/mod.js';
test('batcher', () => {
  const seen = [];
  const b = makeBatcher((xs) => seen.push([...xs]));
  b.add(1); b.add(2); b.done();
  b.add(3); b.done();
  assert.deepEqual(seen, [[1, 2], [3]]);
});
