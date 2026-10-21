import test from 'node:test';
import assert from 'node:assert/strict';
import { countWords } from '../src/mod.js';
test('countWords', () => {
  assert.equal(countWords('one two  three'), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('  lone '), 1);
});
