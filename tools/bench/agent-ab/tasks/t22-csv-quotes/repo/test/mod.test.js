import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvLine } from '../src/mod.js';
test('parseCsvLine', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(parseCsvLine(''), ['']);
});
