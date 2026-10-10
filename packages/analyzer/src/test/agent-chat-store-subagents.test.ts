import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAgentRuns, recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/* A saved turn keeps its subagent link, parent and per-step times (R10); an old record without them still reads. */
test('agent chat store: subagent, parentId and step times round-trip; old tool records still read', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-r10-store-')));
  const chatId = ensureSessionsMigrated(root).activeId;
  const run: StoredAgentRun = {
    id: 'a', agentRef: 'claude', prompt: 'p', text: 'done', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1000, endedAt: 9000, model: null, nodeId: null,
    tools: [
      { id: 'task', title: 'Task', toolKind: 'other', status: 'done', subagent: 'Explore: find auth', startedAt: 1100, endedAt: 6100 },
      { id: 'read', title: 'Read a.ts', toolKind: 'read', status: 'done', parentId: 'task', startedAt: 1200, endedAt: 2400 },
    ],
  };
  assert.ok(recordAgentRun(root, chatId, run));
  const [back] = readAgentRuns(root, chatId);
  assert.deepStrictEqual(back!.tools, run.tools);

  const old: StoredAgentRun = { ...run, id: 'b', startedAt: 2000, tools: [{ id: 'r', title: 'Read x', toolKind: 'read', status: 'done' }] };
  assert.ok(recordAgentRun(root, chatId, old));
  const got = readAgentRuns(root, chatId).find((r) => r.id === 'b')!;
  assert.deepStrictEqual(got.tools, [{ id: 'r', title: 'Read x', toolKind: 'read', status: 'done' }]);
});
