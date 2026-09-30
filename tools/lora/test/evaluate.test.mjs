/**
 * The eval harness, exercised entirely against stub clients. No endpoint is
 * contacted by this file, and `createOpenAICompatibleClient` is asserted to
 * refuse to exist without the owner's deliberate env var.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadValidator } from '../lib/engine.mjs';
import { EVAL_ENV, compareArms, createOpenAICompatibleClient, createStubClient, runEvalArm } from '../lib/evaluate.mjs';
import { REJECT_REASONS } from '../lib/filter.mjs';
import * as C from '../fixtures/candidates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'graph.json'), 'utf8'));
const validate = await loadValidator();

const items = [
  { id: 'i0', repoId: 'robot-shop', prompt: 'p0', graph, request: 'add a cache' },
  { id: 'i1', repoId: 'robot-shop', prompt: 'p1', graph, request: 'retire it' },
  { id: 'i2', repoId: 'vite', prompt: 'p2', graph, request: 'split it' },
  { id: 'i3', repoId: 'vite', prompt: 'p3', graph, request: 'add a queue' },
];

const byPrompt = (map) => createStubClient('stub', async (prompt) => map[prompt] ?? C.NO_FENCE);

test('the metric is the validator pass rate, denominated in requests ATTEMPTED', async () => {
  const client = byPrompt({ p0: C.GOOD, p1: C.GOOD_REMOVE, p2: C.MALFORMED, p3: C.UNREAL_ANCHOR });
  const arm = await runEvalArm({ items, client, validate, sampling: { temperature: 0.2 } });
  assert.equal(arm.attempted, 4);
  assert.equal(arm.passed, 2);
  assert.equal(arm.passRate, 0.5);
  assert.deepEqual(arm.reasonCounts, { [REJECT_REASONS.BAD_JSON]: 1, [REJECT_REASONS.UNREAL_ANCHOR]: 1 });
});

test('per-repo pass rates come out too, so one bad repo cannot hide in the average', async () => {
  const client = byPrompt({ p0: C.GOOD, p1: C.GOOD_REMOVE, p2: C.MALFORMED, p3: C.NO_FENCE });
  const arm = await runEvalArm({ items, client, validate, sampling: {} });
  assert.deepEqual(arm.perRepo['robot-shop'], { attempted: 2, passed: 2, passRate: 1 });
  assert.deepEqual(arm.perRepo['vite'], { attempted: 2, passed: 0, passRate: 0 });
});

test('a transport failure is counted as a failure, but not as a FORMAT failure', async () => {
  const client = createStubClient('flaky', async (prompt) => {
    if (prompt === 'p2') throw new Error('ECONNREFUSED');
    return C.GOOD;
  });
  const arm = await runEvalArm({ items, client, validate, sampling: {} });
  assert.equal(arm.completed, 3);
  assert.equal(arm.transportErrors.length, 1);
  assert.equal(arm.passed, 3);
  // Denominator is still 4: an unanswered request is a failed request.
  assert.equal(arm.passRate, 0.75);
  assert.equal(Object.keys(arm.reasonCounts).length, 0, 'a dead socket must not be recorded as a format reject');
});

test('the tuned-vs-untuned verdict applies a stop rule decided before the run', async () => {
  const untuned = await runEvalArm({ items, client: byPrompt({ p0: C.GOOD }), validate, sampling: { temperature: 0.2 } });
  const tuned = await runEvalArm({
    items,
    client: byPrompt({ p0: C.GOOD, p1: C.GOOD_REMOVE, p2: C.GOOD, p3: C.GOOD }),
    validate,
    sampling: { temperature: 0.2 },
  });
  const cmp = compareArms({ untuned, tuned, minImprovement: 0.15 });
  assert.equal(cmp.untuned.passRate, 0.25);
  assert.equal(cmp.tuned.passRate, 1);
  assert.equal(cmp.delta, 0.75);
  assert.match(cmp.verdict, /^PASS/);

  const weak = compareArms({ untuned, tuned: untuned, minImprovement: 0.15 });
  assert.match(weak.verdict, /^FAIL/, 'no improvement must read as a failure, not as a shrug');
});

test('comparing arms sampled differently is reported INVALID, never scored', async () => {
  const a = await runEvalArm({ items, client: byPrompt({ p0: C.GOOD }), validate, sampling: { temperature: 0.2 } });
  const b = await runEvalArm({ items, client: byPrompt({ p0: C.GOOD, p1: C.GOOD_REMOVE }), validate, sampling: { temperature: 0.9 } });
  const cmp = compareArms({ untuned: a, tuned: b });
  assert.equal(cmp.sameSampling, false);
  assert.match(cmp.verdict, /^INVALID/);
});

test('the live client refuses to exist without the owner\'s deliberate opt-in', () => {
  assert.throws(
    () => createOpenAICompatibleClient({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'x', env: {} }),
    /is OFF/
  );
  // Opted in, it constructs — but is still never CALLED here, and takes an
  // injected fetch so nothing can reach the network from a test.
  const client = createOpenAICompatibleClient({
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:7b',
    env: { [EVAL_ENV.enable]: '1' },
    fetchImpl: () => {
      throw new Error('no network in tests');
    },
  });
  assert.equal(client.name, 'qwen2.5-coder:7b');
});
