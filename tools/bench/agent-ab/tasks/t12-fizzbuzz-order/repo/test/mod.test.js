import test from 'node:test';
import assert from 'node:assert/strict';
import { fizzbuzz } from '../src/mod.js';
test('fizzbuzz', () => {
  assert.equal(fizzbuzz(3), 'Fizz');
  assert.equal(fizzbuzz(5), 'Buzz');
  assert.equal(fizzbuzz(15), 'FizzBuzz');
  assert.equal(fizzbuzz(7), '7');
});
