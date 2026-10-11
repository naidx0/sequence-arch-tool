import assert from 'node:assert';
import { test } from 'node:test';

import { listDrawings, readDrawing, saveDrawing } from '../drawings/drawingStore.js';
import { recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { rewindChat, undoRewind } from '../server/agentRewind.js';
import { ensureSessionsMigrated, writeAgentThread } from '../server/sessionsStore.js';
import { temp } from './t3Helpers.js';

/* Package review (next-0.1.4) S7: Edit from here must take the drawings of the cut turns with it, as it takes their files. */

const run = (n: number): StoredAgentRun => ({
  id: `r${n}`, agentRef: 'codex', prompt: `ask ${n}`, text: `answer ${n}`, status: 'done', error: null, stopReason: 'end_turn',
  startedAt: 1_000_000 * n, endedAt: 1_000_000 * n + 500, model: null, nodeId: null, tools: [], thread: 'thread-1',
});
const svg = (label: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${label}</title><rect width="5" height="5"/></svg>`;

function setup() {
  const root = temp('seq-stack-');
  const chat = ensureSessionsMigrated(root).activeId;
  for (const n of [1, 2, 3]) recordAgentRun(root, chat, run(n));
  writeAgentThread(root, chat, 'codex', { id: 'thread-1', kind: 'codex' });
  /* d1 drawn in r1; d2 drawn in r2 and updated (v2) in r3; d3 drawn in r3. */
  const d1 = saveDrawing(root, { chat, turn: 'r1', at: 1_000_000, kind: 'svg', source: svg('one') }).drawing.id;
  const d2 = saveDrawing(root, { chat, turn: 'r2', at: 2_000_000, kind: 'svg', source: svg('two') }).drawing.id;
  saveDrawing(root, { chat, turn: 'r3', at: 3_000_000, kind: 'svg', source: svg('two, changed'), id: d2 });
  const d3 = saveDrawing(root, { chat, turn: 'r3', at: 3_000_000, kind: 'svg', source: svg('three') }).drawing.id;
  return { root, chat, d1, d2, d3 };
}

test('S7 Edit from here hides the drawings the cut turns made; Undo brings them back', () => {
  const { root, chat, d1, d2, d3 } = setup();
  assert.ok(rewindChat(root, chat, 'r3'));
  assert.deepStrictEqual(listDrawings(root, { chat }).map((d) => d.id).sort(), [d1, d2].sort(), 'd3 only existed in the cut turn');
  assert.strictEqual(readDrawing(root, d3), null, '@drawing:d3 cannot attach a turn that never happened');
  assert.strictEqual(readDrawing(root, d2)?.version.v, 1, 'd2 is back to the version r2 made');
  assert.strictEqual(listDrawings(root, { chat }).find((d) => d.id === d2)!.versions.length, 1);
  /* A block with d2's id after the edit is a new version, and the cut one's file is not overwritten. */
  const again = saveDrawing(root, { chat, turn: 'r3', at: 9_000_000, kind: 'svg', source: svg('two, redone'), id: d2 });
  assert.strictEqual(readDrawing(root, d2)?.source.includes('redone'), true);
  assert.ok(again.version > 2, 'the cut v2 keeps its number and file');
  assert.ok(undoRewind(root, chat));
  const back = listDrawings(root, { chat });
  assert.deepStrictEqual(back.map((d) => d.id).sort(), [d1, d2, d3].sort());
  assert.strictEqual(back.find((d) => d.id === d2)!.versions.length, 3);
  assert.ok(readDrawing(root, d3));
});

test('S7 a drawing saved when an imported chat is first viewed is not taken by a cut at a later turn', () => {
  const { root, chat, d1 } = setup();
  /* Saved now (created is today) but shown by r1, which started long before the cut. */
  assert.ok(rewindChat(root, chat, 'r3'));
  assert.ok(readDrawing(root, d1), 'd1 belongs to r1, which stands');
});
