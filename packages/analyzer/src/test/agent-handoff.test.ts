import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { addAgent } from '../server/agentsStore.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { buildHandoff, handoffPrompt, headUnits, planHandoff, tailUnits } from '../server/agentHandoff.js';
import { createSession, updateSession } from '../server/sessionsStore.js';
import { REPO_ROOT, repo, serve, temp, turn, type Json } from './t3Helpers.js';

/* A chat switched to an agent that has no thread yet hands that agent the chat so far, once; an agent coming back is caught up. */

const FAKE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');
const run = (o: Record<string, unknown>) => ({ status: 'done', error: null, stopReason: null, endedAt: 0, model: null, nodeId: null, tools: [], ...o }) as never;
const T0 = Date.parse('2026-01-01T00:01:00Z');
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe('buildHandoff and planHandoff', () => {
  const turns = [
    { role: 'user', text: 'what is in src?', at: '2026-01-01T00:00:00Z' },
    { role: 'assistant', text: 'a seq model answer', at: '2026-01-01T00:00:01Z' },
    { role: 'user', text: 'now this' },
  ];
  test('labels each speaker, drops the current turn, and names the earlier agent', () => {
    const runs = [run({ id: 't1', agentRef: 'claude', prompt: 'and tests?', text: 'claude answer', startedAt: T0 }), run({ id: 't2', agentRef: 'gpt', prompt: 'now this', text: '', status: 'running', startedAt: T0 + 10 })];
    const h = buildHandoff({ turns }, { forAgent: 'gpt', currentTurnId: 't2', currentPrompt: 'now this' }, runs);
    assert.strictEqual(h, 'User: what is in src?\n\nSequence: a seq model answer\n\nUser: and tests?\n\nclaude: claude answer');
    assert.match(handoffPrompt(h, 'now this'), /^Handoff: .*earlier agent[\s\S]*claude: claude answer[\s\S]*now this$/);
    assert.match(handoffPrompt(h, 'now this', 'delta'), /^Since you last spoke in this chat:[\s\S]*now this$/);
  });
  test('a failed start is not a turn: a Retry does not send the message twice', () => {
    const runs = [
      run({ id: 'a', agentRef: 'claude', prompt: 'hello', text: '', status: 'failed', reached: false, startedAt: T0 }),
      run({ id: 'b', agentRef: 'claude', prompt: 'hello', text: '', status: 'failed', pturn: null, startedAt: T0 + 1 }),
      run({ id: 'c', agentRef: 'claude', prompt: 'hello', text: '', status: 'failed', startedAt: T0 + 2 }),
    ];
    assert.strictEqual(buildHandoff({ turns: [] }, { forAgent: 'gpt', currentTurnId: 'd' }, runs), '');
  });
  test('the first prompt that failed leaves the handoff owed; a thread that spoke is owed only what it missed', () => {
    const failedFirst = [run({ id: 'g1', agentRef: 'gpt', prompt: 'hi', text: '', status: 'failed', pturn: null, startedAt: T0 + 5 })];
    const seq = { turns: [{ role: 'user', text: 'earlier', at: '2026-01-01T00:00:00Z' }, { role: 'assistant', text: 'seq reply', at: '2026-01-01T00:00:01Z' }] };
    const owed = planHandoff(seq, failedFirst, { forAgent: 'gpt', currentTurnId: 'now', threadReopened: true });
    assert.strictEqual(owed?.kind, 'full');
    assert.match(owed!.text, /earlier[\s\S]*seq reply/);
    const spoke = [
      run({ id: 'g1', agentRef: 'gpt', prompt: 'q1', text: 'a1', startedAt: T0 }),
      run({ id: 'c1', agentRef: 'claude', prompt: 'q2', text: 'a2', startedAt: T0 + 10 }),
    ];
    const delta = planHandoff({ turns: [] }, spoke, { forAgent: 'gpt', currentTurnId: 'now', threadReopened: true });
    assert.deepStrictEqual(delta, { kind: 'delta', text: 'User: q2\n\nclaude: a2' });
    assert.strictEqual(planHandoff({ turns: [] }, spoke.slice(0, 1), { forAgent: 'gpt', currentTurnId: 'now', threadReopened: true }), null, 'nothing missed, nothing said');
    assert.strictEqual(planHandoff({ turns: [] }, spoke, { forAgent: 'gpt', currentTurnId: 'now', threadReopened: false })?.kind, 'full', 'a lost thread is told everything');
  });
  test('is empty for an empty chat and bounded otherwise, oldest dropped first', () => {
    assert.strictEqual(buildHandoff({ turns: [] }, { forAgent: 'gpt' }), '');
    assert.strictEqual(handoffPrompt('', 'hi'), 'hi');
    const many = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i} ${'x'.repeat(300)}` }));
    const h = buildHandoff({ turns: many }, { forAgent: 'gpt', max: 2000 });
    assert.ok(h.length <= 2000 + 400, `bounded (${h.length})`);
    assert.ok(h.includes('m199 ') && !h.includes('m0 '), 'newest kept, oldest dropped');
  });
  test('a cut never splits a surrogate pair (the cap counts UTF-16 units)', () => {
    const e = '\u{1F600}';
    for (let n = 0; n < 8; n++) {
      assert.ok(!LONE.test(headUnits(e.repeat(6), n)), `head ${n}`);
      assert.ok(!LONE.test(tailUnits(e.repeat(6), n)), `tail ${n}`);
    }
    assert.strictEqual(headUnits(e.repeat(3), 3), e);
    assert.strictEqual(tailUnits(e.repeat(3), 3), e);
    const h = buildHandoff({ turns: [{ role: 'assistant', text: e.repeat(400) }] }, { forAgent: 'gpt', max: 201 });
    assert.ok(!LONE.test(h), 'a long emoji reply is cut on a pair boundary');
    const u = buildHandoff({ turns: [{ role: 'user', text: e.repeat(400) }] }, { forAgent: 'gpt', max: 201 });
    assert.ok(!LONE.test(u), 'and so is a long question');
  });
});

async function setup(agents: string[]) {
  const dir = repo();
  const store = temp('seq-ho-store-');
  const state = path.join(store, 'state.json');
  const log = path.join(store, 'log.jsonl');
  Object.assign(process.env, { REWIND_STATE: state, REWIND_LOG: log });
  for (const id of agents) addAgent(store, { id, command: process.execPath, args: [FAKE], cwd: dir });
  const { base, close } = await serve(dir, store);
  const chat = createSession(dir).id;
  const starts = (): string[] =>
    (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
      .map((l) => JSON.parse(l) as { method: string; params: Json })
      .filter((m) => m.method === 'turn/start')
      .map((m) => (m.params.input as { text: string }[])[0]!.text);
  const send = (agentRef: string, prompt: string) => turn(base, { agentRef, prompt, permissionMode: 'autoEdit', interactivePermissions: true, chatId: chat });
  const finish = async () => {
    await close();
    delete process.env.REWIND_STATE;
    delete process.env.REWIND_LOG;
  };
  return { dir, state, chat, starts, send, finish };
}
const told = (events: Json[]) => events.find((e) => e.type === 'acp:handoff');

describe('switching a chat to another agent, through the real server', () => {
  test('the new agent gets the chat so far once; a resumed thread gets nothing; coming back, an agent is caught up on what it missed', async () => {
    const s = await setup(['codex', 'gpt']);
    try {
      updateSession(s.dir, s.chat, { chat: { version: 2, sessionId: s.chat, turns: [{ role: 'user', text: 'seq question' }, { role: 'assistant', text: 'seq answer' }] } }, 'client');
      const first = await s.send('codex', 'first ask');
      assert.match(s.starts()[0]!, /seq question/, 'the first agent also gets the Sequence turns');
      assert.strictEqual(told(first)?.kind, 'full');
      const second = await s.send('codex', 'second ask');
      assert.strictEqual(s.starts()[1], 'second ask', 'a resumed thread is not handed the chat again');
      assert.strictEqual(told(second), undefined, 'and is not told it was');

      const sw = await s.send('gpt', 'continue please');
      const text = s.starts()[2]!;
      assert.match(text, /^Handoff:/);
      assert.match(text, /seq question[\s\S]*Sequence: seq answer[\s\S]*first ask[\s\S]*second ask/);
      assert.match(text, /continue please$/);
      assert.deepStrictEqual([told(sw)?.agentRef, told(sw)?.kind], ['gpt', 'full']);
      await s.send('gpt', 'and again');
      assert.strictEqual(s.starts()[3], 'and again', 'the gpt thread now exists: no second handoff');

      const back = await s.send('codex', 'third ask');
      const delta = s.starts()[4]!;
      assert.match(delta, /^Since you last spoke in this chat:/);
      assert.match(delta, /continue please[\s\S]*and again/, 'it hears what gpt and the person said meanwhile');
      assert.doesNotMatch(delta, /first ask|seq question/, 'and nothing it already knew');
      assert.strictEqual(told(back)?.kind, 'delta');
      assert.deepStrictEqual(readAgentRuns(s.dir, s.chat).map((r) => r.handoff?.kind), ['full', undefined, 'full', undefined, 'delta'], 'the record keeps it, so a reload still says so');
      await s.send('codex', 'fourth ask');
      assert.strictEqual(s.starts()[5], 'fourth ask', 'caught up once');
    } finally {
      await s.finish();
    }
  });

  test('a thread that cannot be reopened is told the chat again', async () => {
    const s = await setup(['codex']);
    try {
      await s.send('codex', 'one');
      await s.send('codex', 'two');
      assert.strictEqual(s.starts()[1], 'two');
      fs.rmSync(s.state);
      const ev = await s.send('codex', 'three');
      assert.match(s.starts()[2]!, /^Handoff:[\s\S]*one[\s\S]*two[\s\S]*three$/);
      assert.strictEqual(told(ev)?.kind, 'full');
    } finally {
      await s.finish();
    }
  });

  test('an empty chat starts fresh and says nothing', async () => {
    const s = await setup(['gpt']);
    try {
      const ev = await s.send('gpt', 'hello');
      assert.strictEqual(s.starts()[0], 'hello');
      assert.strictEqual(told(ev), undefined);
    } finally {
      await s.finish();
    }
  });
});
