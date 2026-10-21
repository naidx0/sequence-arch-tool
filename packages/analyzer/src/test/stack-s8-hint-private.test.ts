import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { VISUAL_HINT_PREFIX, routeVisualIntent } from '@sequence/schema/dist/visual/index.js';

import { addAgent } from '../server/agentsStore.js';
import { createSession, readAgentThread } from '../server/sessionsStore.js';
import { snapshotsIdle } from '../server/snapshot.js';
import { REPO_ROOT, call, repo, serve, temp, turn } from './t3Helpers.js';

/* Package integration (router + S5): the router returns { components, hint }. The page puts the hint in the agent's copy of
   the message (prompt) and sends what was typed as `display`. The hint must reach the agent, and must never be stored:
   not in the saved user message, not in the chat title, not in the Edit from here seed, not in any file the chat leaves in the project. */

const FAKE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');
const TYPED = [
  'draw a chart of p95 latency by week',
  'sketch the request flow between the gateway and the model proxy as a diagram',
  'forecast capacity for 5000 users and show when the model proxy saturates',
  'show the sequence of calls between client, gateway and provider',
];

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out; /* a directory git pruned since its parent was listed */
    throw e;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else out.push(p);
  }
  return out;
}

/* The files under `roots` (but `skip`) whose text holds `needle`. A file that is gone by the time it is read holds nothing: the shadow
   snapshot repo under .sequence/snapshots/git writes and renames temp objects and lock files while git runs, and a listing taken a moment
   before is not the tree a moment later (ENOENT, seen in the gate on a loaded machine). `beforeRead` lets a test play that moment. */
function filesHolding(roots: string[], needle: string, skip: string[] = [], beforeRead?: (p: string) => void): string[] {
  const out: string[] = [];
  for (const f of roots.flatMap((r) => filesUnder(r)).filter((p) => !skip.includes(p))) {
    beforeRead?.(f);
    let text: string;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    if (text.includes(needle)) out.push(f);
  }
  return out;
}

test('STACK-8 the sweep finds a planted hint, and a file that vanishes between the listing and the read is not an error (controls)', () => {
  const dir = temp('seq-s8-sweep-');
  fs.mkdirSync(path.join(dir, 'snapshots', 'git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'clean.txt'), 'nothing here');
  fs.writeFileSync(path.join(dir, 'planted.txt'), `x ${VISUAL_HINT_PREFIX} y`);
  const temporary = path.join(dir, 'snapshots', 'git', 'index.lock');
  fs.writeFileSync(temporary, '');
  assert.deepStrictEqual(filesHolding([dir], VISUAL_HINT_PREFIX).map((p) => path.basename(p)), ['planted.txt'], 'POSITIVE CONTROL: the planted hint is found');
  assert.deepStrictEqual(filesHolding([dir], VISUAL_HINT_PREFIX, [], (p) => { if (p === temporary) fs.rmSync(p, { force: true }); }).map((p) => path.basename(p)), ['planted.txt'], 'NEGATIVE CONTROL: a file removed after it was listed does not throw');
  assert.throws(() => fs.readFileSync(temporary, 'utf8'), { code: 'ENOENT' }, 'the file really was gone (the old sweep threw here)');
});

test('STACK-8 the router hint reaches the agent and is never in a saved user message, the chat title or a chat file', async () => {
  const dir = repo();
  const store = temp('seq-stack-store-');
  const log = path.join(store, 'log.jsonl');
  const agentState = path.join(store, 'state.json');
  process.env.REWIND_STATE = agentState;
  process.env.REWIND_LOG = log;
  process.env.REWIND_NO_REVERT = '1';
  addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE], cwd: dir });
  const { base, close } = await serve(dir, store);
  try {
    const chat = createSession(dir).id;
    const hints: string[] = [];
    for (const typed of TYPED) {
      const route = routeVisualIntent(typed);
      assert.ok(route && route.components.length > 0, `the router fires on: ${typed}`);
      hints.push(route.hint);
      /* what agentRunner.streamRun sends: the agent's copy in prompt, the person's words in display */
      await turn(base, { agentRef: 'codex', prompt: `${typed}\n\n[${route.hint}]`, display: typed, permissionMode: 'autoEdit', interactivePermissions: true, chatId: chat });
    }
    const runs = (await call(base, `/api/acp/runs?chatId=${chat}`)).json.runs as { id: string; prompt: string }[];
    assert.deepStrictEqual(runs.map((r) => r.prompt), TYPED, 'every saved user message is what was typed');
    const listed = (await call(base, '/api/sessions')).json as { index?: { sessions?: { id: string; title?: string }[] } };
    const sessions = JSON.stringify(listed);
    assert.ok(sessions.includes(chat), 'the chat is in the sessions list');
    /* the title was really written from the first exchange (else "no hint in the title" proves nothing) */
    const title = listed.index?.sessions?.find((x) => x.id === chat)?.title ?? '';
    assert.ok(title !== '' && title !== 'New chat' && /p95 latency/i.test(title), `the chat is titled from what was typed: ${title}`);
    /* Edit from here on the third message: this agent cannot roll back, so the kept chat (two hint-firing asks) becomes a seed */
    const cut = await call(base, `/api/sessions/${chat}/rewind`, { fromTurnId: runs[2]!.id });
    assert.strictEqual(cut.status, 200);
    const seed = readAgentThread(dir, chat, 'codex')?.rewind?.seed ?? '';
    assert.ok(seed.includes(TYPED[0]!) && seed.includes(TYPED[1]!), 'the seed carries the kept messages');
    assert.ok(!seed.includes(VISUAL_HINT_PREFIX), 'the seed has no hint');
    const before = fs.readFileSync(log, 'utf8').length;
    await turn(base, { agentRef: 'codex', prompt: 'and now the error budget', permissionMode: 'autoEdit', interactivePermissions: true, chatId: chat });
    const seeded = fs.readFileSync(log, 'utf8').slice(before);
    assert.ok(seeded.includes(TYPED[0]!), 'the seed went to the agent with the next message');
    assert.ok(!seeded.includes(VISUAL_HINT_PREFIX), 'the seeded prompt carries no old hint');
    assert.ok(!sessions.includes(VISUAL_HINT_PREFIX), 'the sessions list (titles) has no hint');
    for (const h of hints) assert.ok(!sessions.includes(h), 'no hint text in the sessions list');
    /* nothing the chat wrote into the project or the store (except the fake agent's own log and thread state, which are the agent's copy) has the hint */
    /* (after the cut, so the rewind backup of the cut turns is swept too; the seed was read above) */
    await snapshotsIdle(dir); /* the turn's shadow-repo work is queued behind the reply; sweep after it, not while git is writing */
    assert.deepStrictEqual(filesHolding([dir, store], VISUAL_HINT_PREFIX, [log, agentState]).map((f) => path.relative(dir, f)), [], 'files that hold the hint');
    /* and the agent did get it: the hint is in what the fake agent received */
    const received = fs.readFileSync(log, 'utf8').slice(0, before);
    assert.ok(received.includes(VISUAL_HINT_PREFIX), 'the agent copy carries the hint');
  } finally {
    await close();
    delete process.env.REWIND_STATE;
    delete process.env.REWIND_LOG;
    delete process.env.REWIND_NO_REVERT;
  }
});

test('STACK-8 a plain coding ask does not fire the router, so its message needs no display', async () => {
  assert.strictEqual(routeVisualIntent('rename getUser to fetchUser everywhere'), null);
});
