import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listInterruptedChats, readAgentRuns, readAgentRunsChecked, recordAgentRun, runsForWire, hasRewindBackup, type StoredAgentRun } from '../server/agentChatStore.js';
import { rewindChat } from '../server/agentRewind.js';
import { ensureSessionsMigrated, writeAgentThread } from '../server/sessionsStore.js';
import { SEQUENCE_DIR } from '../server/store.js';
import { temp } from './t3Helpers.js';

/* Package review (next-0.1.4): rewind (Edit from here) stacked on resume (running records, archive, unsaved turns). */

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({
  id: `r${n}`, agentRef: 'codex', prompt: `ask ${n}`, text: `answer ${n}`, status: 'done', error: null, stopReason: 'end_turn',
  startedAt: 1000 * n, endedAt: 1000 * n + 500, model: null, nodeId: null, tools: [], thread: 'thread-1', ...over,
});

function chatWith(root: string, runs: StoredAgentRun[]): string {
  const id = ensureSessionsMigrated(root).activeId;
  for (const r of runs) recordAgentRun(root, id, r);
  writeAgentThread(root, id, 'codex', { id: 'thread-1', kind: 'codex' });
  return id;
}

test('STACK-1 Edit from here on a turn a restart cut off: the rail must stop calling the chat interrupted', () => {
  const root = temp('seq-stack-');
  /* r3 was running when the app was killed: its owner is a dead pid with no heartbeat. */
  const id = chatWith(root, [run(1), run(2), run(3, { status: 'running', owner: { pid: 999_999_999, boot: 'dead-boot' } })]);
  assert.deepStrictEqual(listInterruptedChats(root).map((c) => c.chatId), [id], 'precondition: the rail marks it');
  const out = rewindChat(root, id, 'r3');
  assert.ok(out && out.dropped === 1);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2']);
  assert.ok(!runsForWire(readAgentRuns(root, id)).some((r) => r.status === 'interrupted'), 'the chat itself has no interrupted turn');
  assert.deepStrictEqual(listInterruptedChats(root).map((c) => c.chatId), [], 'the session index still holds runningTurn r3, so GET /api/sessions keeps the "Interrupted by a restart" dot');
});
