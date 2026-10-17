import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHex } from '../src/mod.js';
test('parseHex', () => {
  assert.equal(parseHex('ff'), 255);
  assert.equal(parseHex('0xFF'), 255);
  assert.equal(parseHex('10'), 16);
});
