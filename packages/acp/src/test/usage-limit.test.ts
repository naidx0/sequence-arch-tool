import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A SPENT USAGE LIMIT SAYS WAIT, NOT RETRY.
 *
 * Played against codex-question/plan-question-usage-limit, the live Plan turn
 * of 2026-10-06 (gate4): codex asked two questions through
 * request_user_input, took the answer, then failed the turn with
 * `usageLimitExceeded` and "try again at Oct 12th, 2026 4:36 PM". Before this
 * change that failure was classified `retry`, and the chat offered a Retry
 * that could only fail the same way for six days.
 */

import { CodexAppServerClient, resetCodexExperimentalCache } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import {
  LIVE_USAGE_LIMIT_ERROR,
  LIVE_USAGE_QUESTION,
  LIVE_USAGE_RESETS_AT_S,
  USAGE_LIMIT_ANSWERS,
  USAGE_LIMIT_PROMPT,
} from '../replay/codexQuestionFixtures.js';
import { readFixture, type Json } from '../replay/fixture.js';
import type { AgentQuestionRequest } from '../questions.js';
import { AgentTurnError, TurnHungError, recoveryFor, recoveryOf, resetTimeInMessage } from '../recovery.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'replay', 'codex-question', 'plan-question-usage-limit.jsonl');

async function driven<T>(drain: () => Promise<void>, step: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  step.then(
    (v) => ((done = true), (value = v)),
    (e) => ((done = true), (error = e)),
  );
  for (let i = 0; i < 1000 && !done; i++) await drain();
  if (!done) throw new Error('the adapter did not settle while the replay drained');
  if (error) throw error;
  return value as T;
}

test('usage limit (live frames): the question is relayed, the answer goes back in the recorded shape, and the failed turn carries the reset time', async () => {
  resetCodexExperimentalCache();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-usage-'));
  const h = replaySpawn(readFixture(FILE), { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const asked: AgentQuestionRequest[] = [];
  const client = new CodexAppServerClient({
    command: 'codex',
    cwd,
    accessMode: 'plan',
    spawn: h.spawn,
    onQuestion: async (q) => {
      asked.push(q);
      return Object.fromEntries(q.questions.map((x) => [x.id, [x.options[0].label]]));
    },
  });
  let failure: unknown;
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    await driven(() => h.drain(), client.prompt(USAGE_LIMIT_PROMPT)).catch((e) => (failure = e));
    for (let i = 0; i < 5; i++) await h.drain();
    assert.deepStrictEqual(h.replay.divergences, []);
    assert.ok(h.replay.state.finished, 'every recorded frame played');
    /* Both questions, with their three options each, as codex sent them. */
    const live = (LIVE_USAGE_QUESTION.params as Json).questions as Json[];
    assert.deepStrictEqual(
      asked[0]?.questions.map((q) => [q.id, q.options.map((o) => o.label)]),
      live.map((q) => [q.id, (q.options as Json[]).map((o) => o.label)]),
    );
    /* The answer reached codex exactly as it did live. */
    const sent = h.replay.received.find((m) => m.id === LIVE_USAGE_QUESTION.id && m.method === undefined);
    assert.deepStrictEqual(sent?.result, { answers: Object.fromEntries(Object.entries(USAGE_LIMIT_ANSWERS).map(([k, v]) => [k, { answers: v }])) });
    /* The turn failed on the limit, and says when it resets: wait, never retry. */
    assert.ok(failure instanceof AgentTurnError, 'the turn failed');
    assert.strictEqual((failure as AgentTurnError).info, 'usageLimitExceeded');
    assert.deepStrictEqual(recoveryOf(failure), { kind: 'wait', resetsAt: LIVE_USAGE_RESETS_AT_S * 1000, cause: 'usageLimit' });
    assert.strictEqual(recoveryFor(failure), 'wait');
  } finally {
    await client.dispose();
    resetCodexExperimentalCache();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('usage limit without codex rate-limit windows: the reset time is read from codex’s own message', () => {
  const e = new AgentTurnError(`codex turn failed: ${String(LIVE_USAGE_LIMIT_ERROR.message)}`, 'usageLimitExceeded');
  assert.deepStrictEqual(recoveryOf(e), { kind: 'wait', resetsAt: new Date(2026, 9, 12, 16, 36).getTime(), cause: 'usageLimit' });
  assert.strictEqual(resetTimeInMessage(String(LIVE_USAGE_LIMIT_ERROR.message)), new Date(2026, 9, 12, 16, 36).getTime());
});

test('usage limit with no reset time anywhere is still a wait (a retry would fail the same way)', () => {
  assert.deepStrictEqual(recoveryOf(new AgentTurnError('codex turn failed: usage limit reached', { usageLimitExceeded: {} })), { kind: 'wait', cause: 'usageLimit' });
});

test('a rate or quota error that names its reset time is a wait; the agent’s message is enough', () => {
  assert.deepStrictEqual(recoveryOf(new Error('Rate limit exceeded, try again at Jan 3rd, 2027 9:05 AM.')), {
    kind: 'wait',
    cause: 'usageLimit',
    resetsAt: new Date(2027, 0, 3, 9, 5).getTime(),
  });
});

test('transient failures still retry: a rate limit with no reset time, a dead process, a hung turn', () => {
  assert.strictEqual(recoveryFor(new AgentTurnError('codex turn failed: slow down', 'rateLimitExceeded')), 'retry');
  assert.strictEqual(recoveryFor(new Error('429 Too Many Requests')), 'retry');
  assert.strictEqual(recoveryFor(new Error('codex app-server exited (code=1 signal=null)')), 'retry');
  assert.strictEqual(recoveryFor(new TurnHungError(60_000)), 'retry');
  assert.deepStrictEqual(recoveryOf(new Error('stream disconnected before completion')), { kind: 'retry', cause: 'unknown' });
});
