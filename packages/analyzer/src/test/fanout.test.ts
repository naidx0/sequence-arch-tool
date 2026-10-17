import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { addAgent } from '../server/agentsStore.js';
import { ensureSessionsMigrated, readSessionIndex, readSessionWorktree } from '../server/sessionsStore.js';
import { FAKE_CODEX, REPO_ROOT, call, git, repo, serve, temp, turn, userState, worktreeList, type Json } from './t3Helpers.js';

/* ══════════════════════════════════════════════════════════════════════════
   BEST OF N: one message, N agents, N chats, N worktrees. The agents are the
   repo's fake codex (it really writes hello.txt in its thread's cwd); the
   "send" is what the page does: one POST /api/fanout, then one run-node call
   per returned chat. Negative control: the user's checkout never changes
   until the one click that merges the chosen chat.
   ══════════════════════════════════════════════════════════════════════════ */

describe('best-of-N', () => {
  test('one send makes N chats with N worktrees; each shows a clean merge dry run; one click merges the chosen one', { timeout: 300_000 }, async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    for (const id of ['codex-a', 'codex-b', 'codex-c']) addAgent(store, { id, command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const before = userState(dir);
      const sent = await call(base, '/api/fanout', { prompt: 'create hello', agents: ['codex-a', 'codex-b', 'codex-c'] });
      assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
      const chats = sent.json.chats as { chatId: string; agentRef: string; worktree: { path: string; branch: string } }[];
      assert.strictEqual(chats.length, 3);
      assert.strictEqual(new Set(chats.map((c) => c.chatId)).size, 3, 'three different chats');
      assert.strictEqual(new Set(chats.map((c) => c.worktree.path)).size, 3, 'three different worktrees');
      assert.strictEqual(worktreeList(dir).length, 1 + 3, 'git lists the main checkout and three worktrees');
      for (const c of chats) {
        assert.ok(readSessionWorktree(dir, c.chatId), 'bound');
        assert.strictEqual(readSessionIndex(dir)!.sessions.find((s) => s.id === c.chatId)!.fanout?.id, sent.json.fanoutId);
      }
      assert.strictEqual(userState(dir), before, 'sending changed nothing in the user\'s checkout');

      /* What the page does next: the same message to each agent, in its own chat. */
      for (const c of chats) await turn(base, { agentRef: c.agentRef, prompt: 'create hello', permissionMode: 'autoEdit', interactivePermissions: true, chatId: c.chatId });
      for (const c of chats) assert.strictEqual(fs.readFileSync(path.join(c.worktree.path, 'hello.txt'), 'utf8'), 'hello\n');
      assert.ok(!fs.existsSync(path.join(dir, 'hello.txt')));
      assert.strictEqual(userState(dir), before, 'the agents wrote in their worktrees only');

      const cmp = await call(base, `/api/fanout/${sent.json.fanoutId}`);
      assert.strictEqual(cmp.status, 200, JSON.stringify(cmp.json));
      const sibs = cmp.json.siblings as { chatId: string; files: { path: string }[]; dryRun: { clean: boolean } }[];
      assert.strictEqual(sibs.length, 3);
      for (const s of sibs) assert.deepStrictEqual([s.files.map((f) => f.path), s.dryRun.clean], [['hello.txt'], true]);
      assert.strictEqual(userState(dir), before, 'the dry runs changed nothing');

      const pick = chats[1]!;
      const merged = await call(base, `/api/fanout/${sent.json.fanoutId}/choose`, { chatId: pick.chatId, mode: 'merge' });
      assert.strictEqual(merged.status, 200, JSON.stringify(merged.json));
      assert.strictEqual(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'hello\n');
      assert.ok(readSessionWorktree(dir, pick.chatId)!.merged);
      const twice = await call(base, `/api/fanout/${sent.json.fanoutId}/choose`, { chatId: chats[0]!.chatId, mode: 'merge' });
      assert.strictEqual(twice.status, 409, 'one merge per set');

      /* Discard needs a second, explicit confirm for work that was never merged (here: each sibling's uncommitted hello.txt). */
      const ask = await call(base, `/api/fanout/${sent.json.fanoutId}/discard-others`, { keep: pick.chatId });
      assert.strictEqual(ask.status, 409, JSON.stringify(ask.json));
      assert.deepStrictEqual((ask.json.needsConfirm as { chatId: string }[]).map((r) => r.chatId).sort(), [chats[0]!.chatId, chats[2]!.chatId].sort());
      assert.ok(fs.existsSync(chats[0]!.worktree.path), 'asking removed nothing');
      assert.ok(typeof ask.json.confirmToken === 'string');
      assert.strictEqual((await call(base, `/api/fanout/${sent.json.fanoutId}/discard-others`, { keep: pick.chatId, confirmLoss: 'x' })).status, 409, 'a bare true is not a confirm');
      /* more work appears in a sibling after the list was shown: the old token no longer matches */
      fs.writeFileSync(path.join(chats[0]!.worktree.path, 'late.txt'), 'new work\n');
      const stale = await call(base, `/api/fanout/${sent.json.fanoutId}/discard-others`, { keep: pick.chatId, confirmLoss: ask.json.confirmToken });
      assert.strictEqual(stale.status, 409, JSON.stringify(stale.json));
      assert.match(String(stale.json.error), /changed since you looked/);
      assert.ok(fs.existsSync(chats[0]!.worktree.path) && fs.existsSync(path.join(chats[0]!.worktree.path, 'late.txt')), 'nothing was removed');
      assert.notStrictEqual(stale.json.confirmToken, ask.json.confirmToken);
      const gone = await call(base, `/api/fanout/${sent.json.fanoutId}/discard-others`, { keep: pick.chatId, confirmLoss: stale.json.confirmToken });
      assert.deepStrictEqual((gone.json.removed as string[]).sort(), [chats[0]!.chatId, chats[2]!.chatId].sort());
      assert.ok(!fs.existsSync(chats[0]!.worktree.path) && !fs.existsSync(chats[2]!.worktree.path));
      assert.ok(fs.existsSync(pick.worktree.path), 'the merged chat keeps its worktree until the user removes it');
    } finally {
      await close();
    }
  });

  test('refusals leave nothing behind: one agent, an unknown agent, and too many for the cap', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    for (const id of ['codex-a', 'codex-b', 'codex-c']) addAgent(store, { id, command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const before = [userState(dir), worktreeList(dir).join(), String(readSessionIndex(dir)?.sessions.length ?? 0)];
      assert.strictEqual((await call(base, '/api/fanout', { prompt: 'x', agents: ['codex-a'] })).status, 400);
      assert.strictEqual((await call(base, '/api/fanout', { prompt: 'x', agents: ['codex-a', 'nope'] })).status, 400);
      assert.strictEqual((await call(base, '/api/fanout', { prompt: '  ', agents: ['codex-a', 'codex-b'] })).status, 400);
      assert.strictEqual((await call(base, '/api/worktree-settings', { cap: 2 }, 'PUT')).status, 200);
      const over = await call(base, '/api/fanout', { prompt: 'x', agents: ['codex-a', 'codex-b', 'codex-c'] });
      assert.strictEqual(over.status, 409);
      assert.match(String(over.json.error), /needs 3 worktrees/);
      assert.deepStrictEqual([userState(dir), worktreeList(dir).join(), String(readSessionIndex(dir)?.sessions.length ?? 0)], before);
    } finally {
      await close();
    }
  });
});

import { createFanout, discardOthers } from '../server/fanout.js';

async function sentAndRun(base: string, dir: string, agents: string[]) {
  const sent = await call(base, '/api/fanout', { prompt: 'create hello', agents });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
  const chats = sent.json.chats as { chatId: string; agentRef: string; worktree: { path: string } }[];
  for (const c of chats) await turn(base, { agentRef: c.agentRef, prompt: 'create hello', permissionMode: 'autoEdit', interactivePermissions: true, chatId: c.chatId });
  return { fanoutId: String(sent.json.fanoutId), chats };
}

describe('best-of-N safety', () => {
  test('discard is refused before any merge, for a chat outside the set, and for a chat that was not the one merged; nothing is removed', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    for (const id of ['codex-a', 'codex-b']) addAgent(store, { id, command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const { fanoutId, chats } = await sentAndRun(base, dir, ['codex-a', 'codex-b']);
      const before = worktreeList(dir).length;
      assert.strictEqual((await call(base, `/api/fanout/${fanoutId}/discard-others`, { keep: chats[0]!.chatId, confirmLoss: 'x' })).status, 409, 'nothing merged yet');
      assert.strictEqual((await call(base, `/api/fanout/${fanoutId}/discard-others`, { keep: 'not-in-the-set', confirmLoss: 'x' })).status, 400);
      assert.strictEqual((await call(base, `/api/fanout/${fanoutId}/choose`, { chatId: chats[0]!.chatId, mode: 'merge' })).status, 200);
      assert.strictEqual((await call(base, `/api/fanout/${fanoutId}/discard-others`, { keep: chats[1]!.chatId, confirmLoss: 'x' })).status, 409, 'keep must be the merged one');
      assert.strictEqual(worktreeList(dir).length, before, 'no worktree was removed by any refusal');
    } finally {
      await close();
    }
  });

  test('a sibling that is still running blocks discard (server-checked), and the work it has is named before it is deleted', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    for (const id of ['codex-a', 'codex-b']) addAgent(store, { id, command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const { fanoutId, chats } = await sentAndRun(base, dir, ['codex-a', 'codex-b']);
      await call(base, `/api/fanout/${fanoutId}/choose`, { chatId: chats[0]!.chatId, mode: 'merge' });
      const busy = await discardOthers(dir, store, fanoutId, chats[0]!.chatId, { confirmLoss: 'x', isBusy: (id) => id === chats[1]!.chatId });
      assert.deepStrictEqual([busy.ok, busy.ok ? 0 : busy.status], [false, 409]);
      assert.ok(fs.existsSync(chats[1]!.worktree.path));
      const ask = await discardOthers(dir, store, fanoutId, chats[0]!.chatId, {});
      assert.ok(!ask.ok && ask.needsConfirm?.[0]?.uncommittedFiles === 1, JSON.stringify(ask));
      assert.ok(fs.existsSync(chats[1]!.worktree.path));
    } finally {
      await close();
    }
  });

  test('a sibling running a turn the page sent WITHOUT a session key still blocks discard (the server tracks live turns by chat)', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    const slowAgent = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');
    addAgent(store, { id: 'codex-a', command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    addAgent(store, { id: 'slow-b', command: process.execPath, args: [slowAgent], cwd: dir });
    process.env.REWIND_SLOW_MS = '2500';
    process.env.REWIND_STATE = path.join(store, 'slow-state.json');
    const { base, close } = await serve(dir, store);
    try {
      const sent = await call(base, '/api/fanout', { prompt: 'create hello', agents: ['codex-a', 'slow-b'] });
      assert.strictEqual(sent.status, 200, JSON.stringify(sent.json));
      const chats = sent.json.chats as { chatId: string; agentRef: string; worktree: { path: string } }[];
      await turn(base, { agentRef: 'codex-a', prompt: 'create hello', permissionMode: 'autoEdit', interactivePermissions: true, chatId: chats[0]!.chatId });
      assert.strictEqual((await call(base, `/api/fanout/${sent.json.fanoutId}/choose`, { chatId: chats[0]!.chatId, mode: 'merge' })).status, 200);
      const running = turn(base, { agentRef: 'slow-b', prompt: 'think', permissionMode: 'autoEdit', interactivePermissions: true, chatId: chats[1]!.chatId });
      await new Promise((r) => setTimeout(r, 900));
      const r = await call(base, `/api/fanout/${sent.json.fanoutId}/discard-others`, { keep: chats[0]!.chatId, confirmLoss: 'x' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.match(String(r.json.error), /still working/);
      assert.ok(fs.existsSync(chats[1]!.worktree.path), 'the running agent kept its worktree');
      const cmp = await call(base, `/api/fanout/${sent.json.fanoutId}`);
      assert.deepStrictEqual((cmp.json.siblings as { agentRef: string; running: boolean }[]).map((x) => [x.agentRef, x.running]).sort(), [['codex-a', false], ['slow-b', true]]);
      await running;
    } finally {
      delete process.env.REWIND_SLOW_MS;
      delete process.env.REWIND_STATE;
      await close();
    }
  });

  test('one merge per set whichever button: the ordinary merge of a sibling is refused after one is chosen, and two at once merge exactly one', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    for (const id of ['codex-a', 'codex-b', 'codex-c']) addAgent(store, { id, command: process.execPath, args: [FAKE_CODEX], cwd: dir });
    const { base, close } = await serve(dir, store);
    try {
      const { fanoutId, chats } = await sentAndRun(base, dir, ['codex-a', 'codex-b', 'codex-c']);
      const [x, y] = await Promise.all([
        call(base, `/api/fanout/${fanoutId}/choose`, { chatId: chats[0]!.chatId, mode: 'merge' }),
        call(base, `/api/sessions/${chats[1]!.chatId}/worktree/merge`, { mode: 'merge' }),
      ]);
      assert.deepStrictEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.json, y.json]));
      const late = await call(base, `/api/sessions/${chats[2]!.chatId}/worktree/merge`, { mode: 'squash' });
      assert.strictEqual(late.status, 409);
      assert.match(String(late.json.error), /already merged/);
    } finally {
      await close();
    }
  });

  test('a failure part-way removes every chat and worktree already made', async () => {
    const dir = repo();
    const store = temp('seq-fan-store-');
    ensureSessionsMigrated(dir);
    const before = [worktreeList(dir).length, readSessionIndex(dir)?.sessions.length ?? 0];
    const r = await createFanout(dir, { prompt: 'x', agents: ['a', 'b', 'c'], dataDir: store, afterChat: (i) => { if (i === 1) throw new Error('disk full'); } });
    assert.ok(!r.ok && /disk full/.test(r.error), JSON.stringify(r));
    assert.deepStrictEqual([worktreeList(dir).length, readSessionIndex(dir)?.sessions.length ?? 0], before);
  });
});
