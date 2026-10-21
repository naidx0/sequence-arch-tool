import test from 'node:test';
import assert from 'node:assert/strict';
import { omit } from '../src/mod.js';
test('omit', () => {
  const o = { a: 1, b: 2, c: 3 };
  assert.deepEqual(omit(o, ['a', 'c']), { b: 2 });
  assert.deepEqual(o, { a: 1, b: 2, c: 3 });
});
