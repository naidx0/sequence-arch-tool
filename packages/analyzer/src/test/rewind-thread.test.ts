import assert from 'node:assert';
import { test } from 'node:test';

import type { AcpAgentClient } from '@sequence/acp';

import { hasRewindBackup, readAgentRuns, recordAgentRun, type StoredAgentRun } from '../server/agentChatStore.js';
import { rewindChat, seededPrompt, seedFromRuns, settleRewind, undoRewind } from '../server/agentRewind.js';
import { ensureSessionsMigrated, readAgentThread, writeAgentThread } from '../server/sessionsStore.js';
import { call, serve, temp } from './t3Helpers.js';

/** Edit from here: the saved turns are cut at the server's own turn id, and the provider thread is told to follow. */

const run = (n: number, over: Partial<StoredAgentRun> = {}): StoredAgentRun => ({
  id: `r${n}`, agentRef: 'codex', prompt: `ask ${n}`, text: `answer ${n}`, status: 'done', error: null, stopReason: 'end_turn',
  startedAt: 1000 * n, endedAt: 1000 * n + 500, model: null, nodeId: null, tools: [], thread: 'thread-1', ...over,
});

function chatWith(root: string, runs: StoredAgentRun[], agentRef = 'codex'): string {
  const id = ensureSessionsMigrated(root).activeId;
  for (const r of runs) recordAgentRun(root, id, { ...r, agentRef: r.agentRef === 'codex' ? agentRef : r.agentRef });
  writeAgentThread(root, id, agentRef, { id: 'thread-1', kind: agentRef === 'codex' ? 'codex' : 'acp' });
  return id;
}

test('edit from turn r3 of 4: the saved turns are cut at that id, and the thread is marked to drop 2 turns with the kept chat as its seed', () => {
  const root = temp('seq-rewind-');
  const id = chatWith(root, [1, 2, 3, 4].map((n) => run(n)));
  const out = rewindChat(root, id, 'r3')!;
  assert.deepStrictEqual({ kept: out.kept, dropped: out.dropped, agents: out.agents }, { kept: 2, dropped: 2, agents: ['codex'] });
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2']);
  const ref = readAgentThread(root, id, 'codex')!;
  assert.strictEqual(ref.rewind?.dropTurns, 2);
  assert.match(ref.rewind!.seed, /ask 1[\s\S]*answer 1[\s\S]*ask 2[\s\S]*answer 2/);
  assert.doesNotMatch(ref.rewind!.seed, /ask 3/);
});

test('the cut follows the server\'s ids, not positions: a compaction turn in between is cut with what follows it, counted as a provider turn, and never read as a chat message', () => {
  const root = temp('seq-rewind-');
  const id = chatWith(root, [run(1), run(2, { id: 'c2', prompt: '/compact', compact: true }), run(3), run(4)]);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r3', 'r4'], 'a compaction is not a message');
  const out = rewindChat(root, id, 'r3')!;
  assert.deepStrictEqual([out.kept, out.dropped], [1, 2]);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1']);
  /* Editing r1 drops the compaction too: it is a turn in the codex thread. */
  const root2 = temp('seq-rewind-');
  const id2 = chatWith(root2, [run(1), run(2, { id: 'c2', prompt: '/compact', compact: true }), run(3)]);
  rewindChat(root2, id2, 'r1');
  assert.strictEqual(readAgentThread(root2, id2, 'codex')?.rewind?.dropTurns, 3);
});

test('turns that never reached the provider, or ran on another thread, are not counted as turns to roll back', () => {
  const root = temp('seq-rewind-');
  const id = chatWith(root, [run(1), run(2, { reached: false }), run(3, { thread: 'thread-0' }), run(4)]);
  rewindChat(root, id, 'r2');
  assert.strictEqual(readAgentThread(root, id, 'codex')?.rewind?.dropTurns, 1, 'only r4 is in thread-1');
});

test('an id the server does not have is refused (null), and changes nothing; null means the page had nothing saved to cut', () => {
  const root = temp('seq-rewind-');
  const id = chatWith(root, [run(1), run(2)]);
  assert.strictEqual(rewindChat(root, id, 'page-run-7'), null);
  assert.strictEqual(rewindChat(root, 'nope', 'r1'), null);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2']);
  const none = rewindChat(root, id, null)!;
  assert.strictEqual(none.dropped, 0);
  assert.strictEqual(readAgentThread(root, id, 'codex')?.rewind, undefined);
});

test('the edit can be undone until the next turn is recorded; then it cannot', () => {
  const root = temp('seq-rewind-');
  const id = chatWith(root, [run(1), run(2), run(3)]);
  rewindChat(root, id, 'r2');
  assert.ok(hasRewindBackup(root, id));
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1']);
  assert.deepStrictEqual(undoRewind(root, id), { restored: 3 });
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.strictEqual(readAgentThread(root, id, 'codex')?.rewind, undefined, 'the thread was never touched, so nothing is pending');
  rewindChat(root, id, 'r2');
  recordAgentRun(root, id, run(9));
  assert.strictEqual(undoRewind(root, id), null);
  assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r9']);
});

function fake(opts: { rollback?: boolean; rollbackFails?: boolean }) {
  const calls: string[] = [];
  const client: AcpAgentClient = {
    start: async () => {},
    newSession: async () => (calls.push('new'), 'thread-2'),
    resumeSession: async (id) => (calls.push(`resume ${id}`), id),
    prompt: async () => ({ stopReason: 'end_turn', text: '' }),
    dispose: async () => {},
    ...(opts.rollback ? { rollbackTurns: async (n: number) => { calls.push(`rollback ${n}`); if (opts.rollbackFails) throw new Error('boom'); } } : {}),
  };
  return { client, calls };
}
const ref = { id: 'thread-1', kind: 'codex' as const, at: 'x' };

test('settle: an agent that can roll back resumes the same thread and drops the turns, owing no seed', async () => {
  const { client, calls } = fake({ rollback: true });
  const r = await settleRewind(client, ref, { dropTurns: 2, seed: 'S' }, undefined);
  assert.deepStrictEqual(calls, ['resume thread-1', 'rollback 2']);
  assert.deepStrictEqual({ id: r.threadId, how: r.how, seed: r.seed }, { id: 'thread-1', how: 'rolled-back', seed: '' });
});

test('settle: a failed rollback, or an agent with none (the Claude bridge), starts a new thread and owes the seed', async () => {
  for (const o of [{ rollback: true, rollbackFails: true }, {}]) {
    const { client, calls } = fake(o);
    const r = await settleRewind(client, ref, { dropTurns: 2, seed: 'S' }, undefined);
    assert.ok(calls.includes('new'));
    assert.deepStrictEqual({ id: r.threadId, how: r.how, seed: r.seed }, { id: 'thread-2', how: 'reseeded', seed: 'S' });
    assert.ok(r.reason);
  }
});

test('the seed goes ahead of the next prompt; the oldest exchanges fall off first; an over-long reply is cut from its front and keeps its question; another agent is named', () => {
  assert.strictEqual(seededPrompt('', 'hi'), 'hi');
  assert.match(seededPrompt('User: a\n\nAssistant: b', 'now this'), /User: a[\s\S]*now this$/);
  const long = [1, 2, 3].map((n) => run(n, { text: 'x'.repeat(100) }));
  const seed = seedFromRuns(long, 250);
  assert.doesNotMatch(seed, /ask 1/);
  assert.match(seed, /ask 3/);
  const huge = seedFromRuns([run(1, { text: 'y'.repeat(500) })], 200);
  assert.match(huge, /^User: ask 1/);
  assert.ok(huge.length <= 200);
  assert.match(seedFromRuns([run(1, { agentRef: 'claude' })], 1000, 'codex'), /claude: answer 1/);
});

test('POST /api/sessions/:id/rewind cuts at the turn id and marks the thread; a made-up id is a 409 that changes nothing; undo restores', async () => {
  const root = temp('seq-rewind-');
  const store = temp('seq-rewind-store-');
  const { base, close } = await serve(root, store);
  try {
    const id = chatWith(root, [run(1), run(2), run(3)]);
    const post = (p: string, body: unknown) => call(base, `/api/sessions/${id}${p}`, body);
    assert.strictEqual((await post('/rewind', {})).status, 400);
    assert.strictEqual((await post('/rewind', { fromTurnId: 4 })).status, 400);
    assert.strictEqual((await post('/rewind', { fromTurnId: 'page-id' })).status, 409);
    assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2', 'r3']);
    const ok = await post('/rewind', { fromTurnId: 'r2' });
    assert.deepStrictEqual([ok.status, ok.json], [200, { kept: 1, dropped: 2, agents: ['codex'] }]);
    assert.strictEqual(readAgentThread(root, id, 'codex')?.rewind?.dropTurns, 2);
    assert.strictEqual((await post('/rewind/undo', {})).status, 200);
    assert.deepStrictEqual(readAgentRuns(root, id).map((r) => r.id), ['r1', 'r2', 'r3']);
    assert.strictEqual((await call(base, '/api/sessions/nope/rewind', { fromTurnId: 'r1' })).status, 404);
  } finally {
    await close();
  }
});
