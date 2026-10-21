import assert from 'node:assert';
import { test } from 'node:test';

import { readAgentRunsForWire, recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { temp } from './t3Helpers.js';

/* A compaction turn is a turn in the provider's thread. The chat used to drop it from the wire, so after a reload
   nothing said the conversation had been compacted, how much it covered, or what the summary was. */

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({
  id: `r${n}`, agentRef: 'claude', prompt: `ask ${n}`, text: `answer ${n}`, status: 'done', error: null, stopReason: 'end_turn',
  startedAt: 1000 * n, endedAt: 1000 * n + 500, model: null, nodeId: null, tools: [], ...over,
});

test('compaction marker: the wire carries the compaction in order, with how many turns it summarized', () => {
  const root = temp('seq-compact-wire-');
  const id = ensureSessionsMigrated(root).activeId;
  for (const r of [run(1), run(2), run(3)]) recordAgentRun(root, id, r);
  recordAgentRun(root, id, run(4, { prompt: '', text: 'Earlier work: the API moved to v2.', compact: true }));
  recordAgentRun(root, id, run(5));
  const wire = readAgentRunsForWire(root, id).runs;
  assert.deepStrictEqual(wire.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5'], 'in order, after the turns it covers');
  const marker = wire.find((r) => r.id === 'r4')!;
  assert.strictEqual(marker.compact, true);
  assert.strictEqual(marker.summarizedTurns, 3, 'three real turns came before it');
  assert.strictEqual(marker.text, 'Earlier work: the API moved to v2.', 'the summary is readable');
  assert.strictEqual(wire.find((r) => r.id === 'r1')!.summarizedTurns, undefined, 'only a compaction carries the count');
});

test('compaction marker: a failed compaction is on the wire with its error, and counts as no summarized turns lost', () => {
  const root = temp('seq-compact-wire-');
  const id = ensureSessionsMigrated(root).activeId;
  recordAgentRun(root, id, run(1));
  recordAgentRun(root, id, run(2, { prompt: '', text: '', status: 'failed', error: 'agent exited', compact: true }));
  const marker = readAgentRunsForWire(root, id).runs.find((r) => r.id === 'r2')!;
  assert.strictEqual(marker.status, 'failed');
  assert.strictEqual(marker.error, 'agent exited');
});
