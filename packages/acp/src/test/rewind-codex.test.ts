/**
 * EDIT FROM HERE, CODEX: the thread is rolled back, not re-seeded. Replays
 * built from T3 Code's CodexThreadRevert.ts shapes (not run live).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { CodexAppServerClient, RollbackShortError } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { codexLegacyRollbackFixture, codexRevertFixture, codexShortThreadFixture } from '../replay/codexRewindFixtures.js';
import { SILENT_TOOL_THREAD } from '../replay/codexS1Fixtures.js';
import type { Fixture, Json } from '../replay/fixture.js';

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

async function rolledBack(fixture: Fixture, n: number) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-rewind-'));
  const h = replaySpawn(fixture, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'autoEdit', spawn: h.spawn });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.resumeSession(SILENT_TOOL_THREAD, cwd));
    await driven(() => h.drain(), client.rollbackTurns(n));
    return h.replay;
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('codex rewind (not run live): the last two turns are dropped with thread/revert before the older one', async () => {
  const replay = await rolledBack(codexRevertFixture(), 2);
  const revert = replay.received.find((m) => m.method === 'thread/revert') as Json;
  assert.deepEqual(revert.params, { threadId: SILENT_TOOL_THREAD, beforeTurnId: 'turn-2' });
  assert.equal(replay.received.some((m) => m.method === 'thread/start'), false, 'the same thread, not a new one');
  assert.deepEqual(replay.state.divergences, []);
});

test('codex rewind (not run live): an app-server without thread/turns/list rolls back by count', async () => {
  const replay = await rolledBack(codexLegacyRollbackFixture(), 2);
  const rb = replay.received.find((m) => m.method === 'thread/rollback') as Json;
  assert.deepEqual(rb.params, { threadId: SILENT_TOOL_THREAD, numTurns: 2 });
  assert.deepEqual(replay.state.divergences, []);
});

test('codex rewind: rolling back nothing sends nothing', async () => {
  const fx = codexRevertFixture();
  fx.frames = fx.frames.slice(0, 5);
  const replay = await rolledBack(fx, 0);
  assert.equal(replay.received.some((m) => m.method === 'thread/turns/list' || m.method === 'thread/revert'), false);
});

test('codex rewind: asked to drop more turns than the thread holds, it refuses instead of reverting part of them', async () => {
  await assert.rejects(() => rolledBack(codexShortThreadFixture(), 2), (e: unknown) => e instanceof RollbackShortError);
});
