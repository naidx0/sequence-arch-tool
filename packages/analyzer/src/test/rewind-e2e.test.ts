import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { addAgent } from '../server/agentsStore.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { createSession, readAgentThread } from '../server/sessionsStore.js';
import { REPO_ROOT, call, repo, serve, temp, turn, type Json } from './t3Helpers.js';

/* ══════════════════════════════════════════════════════════════════════════
   EDIT FROM HERE, THROUGH THE REAL SERVER. The agent is a fake codex app-server
   that keeps its threads on disk across processes and logs every request, so
   what is asserted is what the NEXT turn really sent to the provider: the
   thread was rolled back (or started again from the kept chat), the seed went
   out once and only once, and the edited turn is gone from the provider's
   thread and from the saved chat after a reload. Mutation check: with the
   settle in openThread or the seed disabled these fail.
   ══════════════════════════════════════════════════════════════════════════ */

const FAKE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');

interface Logged {
  method: string;
  params: Json;
}

async function scenario(env: Record<string, string>) {
  const dir = repo();
  const store = temp('seq-rw-store-');
  const state = path.join(store, 'state.json');
  const log = path.join(store, 'log.jsonl');
  const saved = { ...process.env };
  Object.assign(process.env, { REWIND_STATE: state, REWIND_LOG: log, ...env });
  addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE], cwd: dir });
  const { base, close } = await serve(dir, store);
  const chat = createSession(dir).id;
  const send = async (prompt: string) => {
    const events = await turn(base, { agentRef: 'codex', prompt, permissionMode: 'autoEdit', interactivePermissions: true, chatId: chat });
    const marks = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
    return { events, marks };
  };
  const logged = (): Logged[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Logged) : []);
  const threads = (): Record<string, { id: string; text: string }[]> => (JSON.parse(fs.readFileSync(state, 'utf8')) as { threads: Record<string, { id: string; text: string }[]> }).threads;
  const finish = async () => {
    await close();
    for (const k of Object.keys(env)) delete process.env[k];
    delete process.env.REWIND_STATE;
    delete process.env.REWIND_LOG;
    void saved;
  };
  return { dir, base, chat, send, logged, threads, finish };
}

const turnIds = (events: Json[]): string[] => events.filter((e) => e.type === 'acp:turn-id').map((e) => String(e.turnId));

describe('edit from here, end to end', () => {
  test('codex: the next turn resumes the same thread, rolls it back to before the edited turn, and sends the new prompt alone; the edited turn is gone after a reload', async () => {
    const s = await scenario({});
    try {
      const sent: Json[][] = [];
      for (const p of ['p1', 'p2', 'p3']) sent.push((await s.send(p)).events);
      const ids = sent.map((e) => turnIds(e)[0]!);
      assert.ok(ids.every(Boolean), 'the page is told each turn\'s server id');
      assert.deepStrictEqual(readAgentRuns(s.dir, s.chat).map((r) => r.id), ids, 'the ids the page was told are the saved ones');
      const thread = readAgentThread(s.dir, s.chat, 'codex')!.id;
      const providerTurns = s.threads()[thread]!.map((t) => t.id);

      const cut = await call(s.base, `/api/sessions/${s.chat}/rewind`, { fromTurnId: ids[1] });
      assert.deepStrictEqual([cut.status, cut.json.dropped], [200, 2]);

      const before = s.logged().length;
      const next = await s.send('p4');
      const since = s.logged().slice(before);
      assert.deepStrictEqual(since.map((m) => m.method).filter((m) => m !== 'initialize'), ['thread/resume', 'thread/revert', 'turn/start']);
      assert.strictEqual(since.find((m) => m.method === 'thread/revert')!.params.beforeTurnId, providerTurns[1], 'rolled back to before p2, the provider\'s own turn');
      const start = since.find((m) => m.method === 'turn/start')!;
      assert.strictEqual(JSON.stringify(start.params.input).includes('p2'), false);
      assert.strictEqual((start.params.input as { text: string }[])[0]!.text, 'p4', 'no seed: the thread itself was rolled back');
      assert.strictEqual(next.events.find((e) => e.type === 'acp:session')?.rewound, 'rolled-back');
      assert.deepStrictEqual(s.threads()[thread]!.map((t) => t.text), ['p1', 'p4']);

      const again = s.logged().length;
      await s.send('p5');
      assert.strictEqual(s.logged().slice(again).some((m) => m.method === 'thread/revert'), false, 'rolled back once');

      /* a reload: the saved chat has no p2 or p3, and the provider thread does not either */
      assert.deepStrictEqual(readAgentRuns(s.dir, s.chat).map((r) => r.prompt), ['p1', 'p4', 'p5']);
    } finally {
      await s.finish();
    }
  });

  test('an agent that cannot roll back starts a new thread seeded with the kept chat, sends the seed once, and never mentions the edited turns', async () => {
    const s = await scenario({ REWIND_NO_REVERT: '1' });
    try {
      for (const p of ['p1', 'p2', 'p3']) await s.send(p);
      const ids = readAgentRuns(s.dir, s.chat).map((r) => r.id);
      const old = readAgentThread(s.dir, s.chat, 'codex')!.id;
      assert.strictEqual((await call(s.base, `/api/sessions/${s.chat}/rewind`, { fromTurnId: ids[1] })).status, 200);

      const before = s.logged().length;
      const next = await s.send('p4');
      const start = s.logged().slice(before).find((m) => m.method === 'turn/start')!;
      const text = (start.params.input as { text: string }[])[0]!.text;
      assert.match(text, /User: p1/);
      assert.match(text, /p4$/);
      assert.doesNotMatch(text, /p2|p3/, 'the edited turns are not remembered');
      assert.strictEqual(next.events.find((e) => e.type === 'acp:session')?.rewound, 'reseeded');
      const fresh = readAgentThread(s.dir, s.chat, 'codex')!;
      assert.notStrictEqual(fresh.id, old);
      assert.strictEqual(fresh.rewind, undefined, 'the seed is spent once the turn is answered');

      const again = s.logged().length;
      await s.send('p5');
      const second = s.logged().slice(again).find((m) => m.method === 'turn/start')!;
      assert.strictEqual((second.params.input as { text: string }[])[0]!.text, 'p5', 'the seed went out exactly once');
      assert.strictEqual(readAgentThread(s.dir, s.chat, 'codex')?.rewind, undefined);
    } finally {
      await s.finish();
    }
  });

  test('a thread that has fewer turns than the rewind counts is started again from the kept chat, not emptied', async () => {
    const s = await scenario({});
    try {
      for (const p of ['p1', 'p2']) await s.send(p);
      const ids = readAgentRuns(s.dir, s.chat).map((r) => r.id);
      /* A rewind that claims more turns than the provider thread has: make the saved record lie by adding a run on this thread that the provider never saw. */
      const { recordAgentRun } = await import('../server/agentChatStore.js');
      const thread = readAgentThread(s.dir, s.chat, 'codex')!.id;
      recordAgentRun(s.dir, s.chat, { id: 'ghost', agentRef: 'codex', prompt: 'ghost', text: 'x', status: 'done', error: null, stopReason: 'end_turn', startedAt: 9e12, endedAt: 9e12, model: null, nodeId: null, tools: [], thread });
      assert.strictEqual((await call(s.base, `/api/sessions/${s.chat}/rewind`, { fromTurnId: ids[0] })).status, 200);
      const before = s.logged().length;
      const next = await s.send('p9');
      assert.strictEqual(s.logged().slice(before).some((m) => m.method === 'thread/revert'), false, 'it did not revert and empty the thread');
      assert.strictEqual(next.events.find((e) => e.type === 'acp:session')?.rewound, 'reseeded');
    } finally {
      await s.finish();
    }
  });

  test('turns the provider refused or never took do not shift the rollback: p1, p2, FAIL, p3, edit p2, p4 leaves the provider thread [p1, p4]', async () => {
    const s = await scenario({});
    try {
      for (const p of ['p1', 'p2', 'FAIL now', 'p3']) await s.send(p);
      const runs = readAgentRuns(s.dir, s.chat);
      assert.deepStrictEqual(runs.map((r) => r.prompt), ['p1', 'p2', 'FAIL now', 'p3']);
      assert.strictEqual(runs[2]!.pturn, null, 'the refused turn is marked as never in the provider thread');
      assert.ok(typeof runs[1]!.pturn === 'string' && typeof runs[3]!.pturn === 'string');
      const thread = readAgentThread(s.dir, s.chat, 'codex')!.id;
      assert.deepStrictEqual(s.threads()[thread]!.map((t) => t.text), ['p1', 'p2', 'p3']);

      const cut = await call(s.base, `/api/sessions/${s.chat}/rewind`, { fromTurnId: runs[1]!.id });
      assert.strictEqual(cut.status, 200, JSON.stringify(cut.json));
      const next = await s.send('p4');
      assert.strictEqual(next.events.find((e) => e.type === 'acp:session')?.rewound, 'rolled-back');
      assert.deepStrictEqual(s.threads()[thread]!.map((t) => t.text), ['p1', 'p4'], 'p1 is still there; p2 and p3 are gone');
      assert.deepStrictEqual(readAgentRuns(s.dir, s.chat).map((r) => r.prompt), ['p1', 'p4']);
    } finally {
      await s.finish();
    }
  });
});
