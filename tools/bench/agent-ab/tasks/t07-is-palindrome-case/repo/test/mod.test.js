import test from 'node:test';
import assert from 'node:assert/strict';
import { isPalindrome } from '../src/mod.js';
test('isPalindrome', () => {
  assert.equal(isPalindrome('racecar'), true);
  assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true);
  assert.equal(isPalindrome('hello'), false);
});
