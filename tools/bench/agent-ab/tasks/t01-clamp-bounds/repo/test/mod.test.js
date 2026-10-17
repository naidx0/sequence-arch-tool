import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/mod.js';
test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
});
