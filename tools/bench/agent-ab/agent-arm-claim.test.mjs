import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsSuccess } from './agent-arm.mjs';

test('claim detector: affirmative claims count', () => {
  for (const s of ['All tests pass.', 'Fixed. The tests pass now.', 'I fixed the bug.', 'the suite passes']) assert.equal(claimsSuccess(s), true, s);
});

test('claim detector: negated claims are not claims', () => {
  for (const s of ['It is not fixed.', "This isn't fixed yet.", 'The tests do not pass.', "tests don't pass", 'still not fixed', 'never passes', 'I could not get the tests to pass.', "couldn't fix it"]) assert.equal(claimsSuccess(s), false, s);
});
