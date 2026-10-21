import test from 'node:test';
import assert from 'node:assert/strict';
import { retry } from '../src/mod.js';
test('retry', () => {
  let calls = 0;
  assert.equal(retry(() => { calls++; if (calls < 3) throw new Error('x'); return 'ok'; }, 3), 'ok');
  let n = 0;
  assert.throws(() => retry(() => { n++; throw new Error('boom'); }, 2), /boom/);
  assert.equal(n, 2);
});
