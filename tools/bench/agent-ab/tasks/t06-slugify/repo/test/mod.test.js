import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/mod.js';
test('slugify', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  A  --  B!! '), 'a-b');
  assert.equal(slugify('x'), 'x');
});
