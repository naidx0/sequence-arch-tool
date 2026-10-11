import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listInterruptedChats, readAgentRuns, readAgentRunsChecked, readArchivePage, recordAgentRun, runsForWire, hasRewindBackup, type StoredAgentRun } from '../server/agentChatStore.js';
import { undoRewind, rewindChat } from '../server/agentRewind.js';
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

test('STACK-2 Edit from here on a turn the archive pager loaded (chat over 200 turns) is refused as "no saved turn with that id"', () => {
  const root = temp('seq-stack-');
  const id = chatWith(root, Array.from({ length: 205 }, (_, i) => run(i + 1)));
  assert.strictEqual(readAgentRunsChecked(root, id).archived, 5, 'precondition: r1..r5 are in the archive, shown by "Show older turns"');
  /* The page holds r3 (via loadOlderRuns -> fromSavedRun, turnId 'r3') and offers Edit from here on it. */
  const out = rewindChat(root, id, 'r3');
  assert.notStrictEqual(out, null, 'rewindChat returns null -> the route answers 409 "Reload the chat and try again", which a reload cannot fix');
  assert.strictEqual(out!.dropped, 203);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2']);
  assert.strictEqual(readArchivePage(root, id, 0).runs.length, 0, 'nothing is left twice in the archive');
  assert.strictEqual(readAgentRunsChecked(root, id).archived, 0);
  /* Undo puts back all 205, the oldest five in the archive again. */
  assert.deepStrictEqual(undoRewind(root, id), { restored: 205 });
  assert.strictEqual(readAgentRuns(root, id).length, 200);
  assert.strictEqual(readAgentRunsChecked(root, id).archived, 5);
  assert.deepStrictEqual(readArchivePage(root, id, 0).runs.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('STACK-2b a cut in the archive that still leaves more than 200 turns keeps the newest 200 in the file and the rest archived once', () => {
  const root = temp('seq-stack-');
  const id = chatWith(root, Array.from({ length: 450 }, (_, i) => run(i + 1)));
  assert.strictEqual(readAgentRunsChecked(root, id).archived, 250);
  const out = rewindChat(root, id, 'r230');
  assert.ok(out && out.dropped === 221 && out.kept === 229);
  assert.strictEqual(readAgentRuns(root, id).length, 200);
  assert.strictEqual(readAgentRunsChecked(root, id).archived, 29);
  assert.deepStrictEqual(readArchivePage(root, id, 0, 500).runs.map((r) => r.id).slice(-2), ['r28', 'r29']);
});
