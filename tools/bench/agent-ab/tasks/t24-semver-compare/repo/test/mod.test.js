import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/mod.js';
test('compareVersions', () => {
  assert.equal(compareVersions('1.10.0', '1.2.0'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});
