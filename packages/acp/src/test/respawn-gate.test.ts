import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRespawnGate } from '../respawnGate.js';

test('a failing agent is started again only after a growing wait, then not at all after the cap', () => {
  let t = 0;
  const gate = createRespawnGate({ baseMs: 1000, maxMs: 3000, cap: 3, now: () => t });
  assert.deepEqual(gate.check('codex'), { allowed: true });

  gate.fail('codex', new Error('exited (code 1)'));
  let v = gate.check('codex');
  assert.equal(v.allowed, false);
  assert.equal(!v.allowed && v.retryInMs, 1000);
  t = 999;
  assert.equal(gate.check('codex').allowed, false);
  t = 1000;
  assert.equal(gate.check('codex').allowed, true);

  gate.fail('codex', 'second');
  t = 2999;
  assert.equal(gate.check('codex').allowed, false, 'the second wait is double the first');
  t = 3000;
  assert.equal(gate.check('codex').allowed, true);

  gate.fail('codex', 'third');
  t = 1_000_000;
  v = gate.check('codex');
  assert.equal(v.allowed, false, 'after the cap no amount of time starts it again');
  assert.equal(!v.allowed && v.gaveUp, true);
  assert.equal(!v.allowed && v.lastError, 'third');

  gate.reset('codex');
  assert.deepEqual(gate.check('codex'), { allowed: true }, 'a person asking again opens the gate');
});

test('the wait never exceeds maxMs, a success clears the record, keys are separate', () => {
  let t = 0;
  const gate = createRespawnGate({ baseMs: 1000, maxMs: 1500, cap: 10, now: () => t });
  for (let i = 0; i < 5; i++) gate.fail('a', 'x');
  const v = gate.check('a');
  assert.equal(!v.allowed && v.retryInMs, 1500);
  assert.deepEqual(gate.check('b'), { allowed: true });
  gate.succeed('a');
  assert.deepEqual(gate.check('a'), { allowed: true });
});
