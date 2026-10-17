import test from 'node:test';
import assert from 'node:assert/strict';
import { describe } from '../src/server.js';
test('describe uses the configured port', () => {
  assert.equal(describe(), 'http://localhost:8080');
});
