/**
 * The money guard.
 *
 * Phase 0 is parked until the owner green-lights it in person, so the property
 * under test here is a safety property: no default path, and no test, can reach
 * a paid inference endpoint. The API teacher must refuse to be constructed
 * unless the owner deliberately set the env var, and must never fire a request
 * without one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TEACHER_ENV, createFixtureTeacher, createTeacher } from '../lib/teacher.mjs';
import { GOOD } from '../fixtures/candidates.mjs';

test('the fixture teacher is the default and returns canned completions', async () => {
  const t = createTeacher('fixture', { fixtures: { 'fx#0': GOOD, '*': 'fallback' } });
  assert.equal(t.name, 'fixture');
  assert.equal(await t.generateProposal('prompt', { request: { id: 'fx#0' } }), GOOD);
  assert.equal(await t.generateProposal('prompt', { request: { id: 'unknown' } }), 'fallback');
});

test('a fixture teacher with nothing to say fails loudly rather than emitting empty training data', async () => {
  const t = createFixtureTeacher({});
  await assert.rejects(() => t.generateProposal('p', { request: { id: 'x' } }), /no completion for request/);
});

test('the API teacher REFUSES to construct without the deliberate env var', () => {
  assert.throws(() => createTeacher('api', { env: {} }), /is OFF/);
  assert.throws(() => createTeacher('api', { env: {} }), /costs money/);
});

test('enabled but unconfigured is an error, not a silent default endpoint', () => {
  assert.throws(() => createTeacher('api', { env: { [TEACHER_ENV.enable]: '1' } }), /unconfigured/);
});

test('when fully enabled it sends ONE user message and no system role — the layout inference uses', async () => {
  // Fully stubbed fetch: this asserts the request SHAPE without a network call.
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), headers: init.headers };
    return { ok: true, json: async () => ({ choices: [{ message: { content: GOOD } }] }) };
  };
  const t = createTeacher('api', {
    env: {
      [TEACHER_ENV.enable]: '1',
      [TEACHER_ENV.baseUrl]: 'https://example.invalid/v1',
      [TEACHER_ENV.model]: 'teacher-model',
      [TEACHER_ENV.key]: 'sk-not-a-real-key',
    },
    fetchImpl,
  });
  assert.equal(await t.generateProposal('the prompt'), GOOD);
  assert.equal(seen.url, 'https://example.invalid/v1/chat/completions');
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'the prompt' }]);
  assert.equal(seen.body.messages.length, 1, 'production sends one user message; training data must match');
});

test('an unknown teacher name is refused rather than defaulting to a paid one', () => {
  assert.throws(() => createTeacher('gpt'), /unknown teacher/);
});
