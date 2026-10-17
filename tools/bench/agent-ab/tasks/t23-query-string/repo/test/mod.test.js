import test from 'node:test';
import assert from 'node:assert/strict';
import { toQuery } from '../src/mod.js';
test('toQuery', () => {
  assert.equal(toQuery({ a: 1, b: 'x y' }), 'a=1&b=x%20y');
  assert.equal(toQuery({ a: undefined, b: 2 }), 'b=2');
  assert.equal(toQuery({}), '');
});
