import test from 'node:test';
import assert from 'node:assert/strict';
import { titleCase } from '../src/mod.js';
test('titleCase', () => {
  assert.equal(titleCase('hello big WORLD'), 'Hello Big World');
  assert.equal(titleCase('x'), 'X');
});
