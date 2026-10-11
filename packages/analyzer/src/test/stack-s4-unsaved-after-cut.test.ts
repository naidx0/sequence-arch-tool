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

test('STACK-3 a finished turn whose write failed (served from memory) comes back after Edit from here cut it', () => {
  const root = temp('seq-stack-');
  const id = chatWith(root, [run(1), run(2)]);
  const file = path.join(root, SEQUENCE_DIR, 'sessions', id, 'agent-runs.json');
  /* r3's closing write fails: the file is replaced by a directory, so the atomic rename cannot land. */
  const saved = fs.readFileSync(file, 'utf8');
  fs.rmSync(file);
  fs.mkdirSync(file);
  recordAgentRun(root, id, run(3));
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, saved);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2', 'r3'], 'precondition: r3 served from memory (resume)');
  const out = rewindChat(root, id, 'r2');
  assert.ok(out && out.dropped === 2);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1'], 'the unsaved map is not cleared by truncate, so r3 returns on every read');
});
