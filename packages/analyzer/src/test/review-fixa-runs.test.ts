/**
 * Review finding: a compaction turn cut off by a restart was offered as "continuable" (continuing a summary makes
 * no sense), and the ?older archive page did not mark compaction turns the way the main page does.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { interruptedRun, readAgentRunsForWire, readArchivePageForWire, recordAgentRun, writeAgentRunsBulk, type StoredAgentRun } from '../server/agentChatStore.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({ id: `r${n}`, agentRef: 'claude', prompt: `p${n}`, text: `t${n}`, status: 'done', error: null, stopReason: 'end_turn', startedAt: n, endedAt: n + 1, model: null, nodeId: null, tools: [], ...over });
function chat() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fixa-runs-')));
  return { root, chatId: ensureSessionsMigrated(root).activeId };
}

test('a cut-off compaction turn is interrupted but never continuable', () => {
  const c = chat();
  recordAgentRun(c.root, c.chatId, run(1));
  recordAgentRun(c.root, c.chatId, run(2, { compact: true, status: 'running', endedAt: 0 }));
  assert.strictEqual(interruptedRun([run(1), run(2, { compact: true, status: 'running' })], new Set()), null);
  const wire = readAgentRunsForWire(c.root, c.chatId).runs;
  const cutOff = wire.find((r) => r.id === 'r2')!;
  assert.strictEqual(cutOff.status, 'interrupted');
  assert.strictEqual(cutOff.continuable, undefined, 'a compaction is not offered as continuable');
});

test('positive control: a cut-off ordinary turn is still continuable', () => {
  const c = chat();
  recordAgentRun(c.root, c.chatId, run(1));
  recordAgentRun(c.root, c.chatId, run(2, { status: 'running', endedAt: 0 }));
  const cutOff = readAgentRunsForWire(c.root, c.chatId).runs.find((r) => r.id === 'r2')!;
  assert.strictEqual(cutOff.status, 'interrupted');
  assert.strictEqual(cutOff.continuable, true);
});

test('the ?older archive page marks a compaction turn with the turns it summarized, like the main page, and offers nothing to continue', async () => {
  const c = chat();
  const many = Array.from({ length: 260 }, (_, i) => run(i + 1, i === 4 ? { compact: true } : i === 59 ? { status: 'running' as const, endedAt: 0 } : {}));
  assert.ok(await writeAgentRunsBulk(c.root, c.chatId, many));
  const all = readArchivePageForWire(c.root, c.chatId, 0, 500);
  assert.strictEqual(all.runs.length, 60);
  const compaction = all.runs.find((r) => r.id === 'r5')!;
  assert.strictEqual(compaction.summarizedTurns, 4, 'four real turns came before it');
  assert.ok(all.runs.every((r) => r.continuable === undefined), 'an archived turn is never continuable');
  /* A later page counts the turns of the earlier pages too. */
  const tail = readArchivePageForWire(c.root, c.chatId, 0, 10);
  assert.deepStrictEqual(tail.runs.map((r) => r.id), ['r51', 'r52', 'r53', 'r54', 'r55', 'r56', 'r57', 'r58', 'r59', 'r60']);
  assert.strictEqual(tail.remaining, 50);
  const head = readArchivePageForWire(c.root, c.chatId, 55, 10);
  assert.strictEqual(head.runs.find((r) => r.id === 'r5')!.summarizedTurns, 4);
});
