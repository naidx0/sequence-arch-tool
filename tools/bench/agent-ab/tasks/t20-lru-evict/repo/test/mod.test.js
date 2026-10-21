import test from 'node:test';
import assert from 'node:assert/strict';
import { LRU } from '../src/mod.js';
test('LRU', () => {
  const c = new LRU(2);
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1);
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
});
