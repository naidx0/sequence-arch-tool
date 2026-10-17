import test from 'node:test';
import assert from 'node:assert/strict';
import { capitalize } from '../src/mod.js';
test('capitalize', () => {
  assert.equal(capitalize('hello'), 'Hello');
  assert.equal(capitalize('a'), 'A');
  assert.equal(capitalize(''), '');
});
