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

test('STACK-4 a running turn owned by another live server process can be cut, and its next progress write undoes the cut and the undo', () => {
  const root = temp('seq-stack-');
  const boot = `other-${process.pid}-${Date.now()}`;
  const live = path.join(os.tmpdir(), 'sequence-live');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, boot), String(process.ppid));
  const running = run(3, { status: 'running', owner: { pid: process.ppid, boot } });
  const id = chatWith(root, [run(1), run(2), running]);
  assert.strictEqual(runsForWire(readAgentRuns(root, id)).at(-1)?.status, 'running', 'precondition: live in another process (resume)');
  /* chatBusy (repoServer.ts) only asks this process, so the route lets the rewind through. The store should refuse. */
  const out = rewindChat(root, id, 'r2');
  /* What happens next: the other process writes progress for r3. */
  recordAgentRun(root, id, { ...running, text: 'more' }, new Date(), { touch: false });
  const after = readAgentRuns(root, id).map((r) => r.id);
  const backup = hasRewindBackup(root, id);
  fs.rmSync(path.join(live, boot), { force: true });
  assert.deepStrictEqual({ refused: out === null, after, backup }, { refused: true, after: ['r1', 'r2', 'r3'], backup: false }, 'the cut goes through, then r3 reappears after r1 (r2 stays cut) and Undo is gone');
});
