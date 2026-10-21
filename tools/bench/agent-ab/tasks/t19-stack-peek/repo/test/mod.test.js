import test from 'node:test';
import assert from 'node:assert/strict';
import { Stack } from '../src/mod.js';
test('Stack', () => {
  const s = new Stack();
  assert.equal(s.peek(), undefined);
  s.push(1); s.push(2);
  assert.equal(s.peek(), 2);
  assert.equal(s.size, 2);
  assert.equal(s.pop(), 2);
});
