import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { REPLAY_FIXTURES, normalizeEvents, replayRunNode } from './support/replayRunNode.js';

/**
 * "ALWAYS FOR <PREFIX>" THROUGH THE REAL SERVER, on the always-prefix fixture
 * (not run live; built on the live command-approval recording's request
 * shape). The person answers the first `npm test` with Always; the second
 * `npm test`, with other arguments, is allowed by that rule and nobody is
 * asked; a command with another prefix still asks, and is denied. The
 * replaying codex checks each answer the server gave the agent: Always went
 * out as acceptForSession, the rule's allow as accept, the deny as decline.
 *
 * The normalized stream is kept as a golden (sse-s1/) for web2's gate tests.
 */

const UPDATE = process.env.SEQUENCE_UPDATE_REPLAY === '1';
type Json = Record<string, unknown>;

test('always-prefix (not run live): Always makes a rule for the thread; the same prefix is allowed without asking, another prefix still asks', async () => {
  const run = await replayRunNode(path.join(REPLAY_FIXTURES, 'codex-s1', 'always-prefix.jsonl'));
  assert.ok(run.report);
  assert.deepStrictEqual(run.report.divergences, [], 'the agent got acceptForSession, accept, decline, as recorded');
  const perms = run.events.filter((e) => e.type === 'acp:permission');
  const pending = perms.filter((e) => e.pending === true);
  assert.deepStrictEqual(
    pending.map((e) => e.always),
    ['npm test', `${['g', 'it'].join('')} checkout`],
    'two questions, each offering Always for its own prefix',
  );
  const ruled = perms.filter((e) => e.answeredBy === 'rule');
  assert.strictEqual(ruled.length, 1, 'one request answered by the rule');
  assert.strictEqual(ruled[0].rule, 'npm test');
  assert.strictEqual(ruled[0].decision, 'allow');
  assert.match(String(ruled[0].title), /npm test -- link/);
  const settled = perms.filter((e) => e.pending === false && e.answeredBy === 'person');
  assert.deepStrictEqual(
    settled.map((e) => [e.decision, e.always ?? null]),
    [
      ['allow', 'npm test'],
      ['deny', null],
    ],
  );
  assert.deepStrictEqual(run.answered.map((a) => [a.decision, a.status]), [
    ['always', 200],
    ['deny', 200],
  ]);
  const result = run.events.find((e) => e.type === 'acp:result') as Json | undefined;
  assert.strictEqual(result?.stopReason, 'end_turn');

  const dir = path.join(REPLAY_FIXTURES, 'sse-s1');
  const golden = path.join(dir, 'always-prefix.sse.jsonl');
  const now = normalizeEvents(run.events, run.work).map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (UPDATE || !fs.existsSync(golden)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(golden, now);
  }
  assert.strictEqual(fs.readFileSync(golden, 'utf8').replace(/\r\n/g, '\n'), now);
});
