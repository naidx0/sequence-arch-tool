import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmail } from '../src/mod.js';
test('isEmail', () => {
  assert.equal(isEmail('a@b.co'), true);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('a b@c.com'), false);
  assert.equal(isEmail('a@@c.com'), false);
});
