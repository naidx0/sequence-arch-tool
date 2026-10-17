import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import { addAgent } from '../server/agentsStore.js';
import { createSession, updateSession } from '../server/sessionsStore.js';
import { buildAskHistory, reconcileStored, resetHistorySummaryMemory, summaryLimits, historyBudgetTokens } from '../server/askHistory.js';
import { estimateTokens } from '../llm/tokenBudget.js';
import { REPO_ROOT, repo as t3repo, serve, temp, turn, type Json } from './t3Helpers.js';

/**
 * 019-10 review fixes (Opus review of merge 02b3411d1).
 * 1 the stored transcript lags a queued follow-up; 2 the summary counts inside the budget;
 * 3 the summarizer's input follows its model's window; 4 the agent handoff makes no provider call
 * unless the model is local; 5 a Stop cancels the summary call.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAINAPP = path.join(path.resolve(here, '..', '..'), 'test', 'fixtures', 'plainapp');
const FACT = 'The staging database password hint is PURPLE-ELEPHANT-7.';

type T = { role: 'user' | 'assistant'; text: string };

function promptText(body: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(body);
  return out.join(String.fromCharCode(10));
}
const isSummaryCall = (t: string): boolean => t.includes('condensing the EARLIER part of a conversation');

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-history-fix-'));
  const r = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, r, { recursive: true });
  return r;
}
function writeChat(repo: string, id: string, turns: T[]): void {
  const dir = path.join(repo, '.sequence', 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ version: 2, sessionId: id, turns }));
}

/* ── 1. the lagging save ─────────────────────────────────────────────── */

test('1: a request whose history extends the stored turns is used (the PUT has not landed yet)', async () => {
  const repo = tmpRepo();
  /* The stored transcript is one exchange behind: the previous question and ITS ANSWER are not saved yet. */
  writeChat(repo, 'chat-lag', [{ role: 'user', text: 'first question' }, { role: 'assistant', text: 'first answer' }]);
  const mock = await startMockProvider(() => ({ text: 'ok' }));
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: 'sk-ant-test-LAG-42' }) });
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'and a third thing?',
        threadId: 'chat-lag',
        intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }],
        history: [
          { role: 'user', text: 'first question' },
          { role: 'assistant', text: 'first answer' },
          { role: 'user', text: 'second question' },
          { role: 'assistant', text: 'SECOND-ANSWER-NOT-YET-SAVED' },
        ],
      }),
    });
    await res.text();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await mock.close();
  }
  assert.match(promptText(mock.requests[0]!.body), /SECOND-ANSWER-NOT-YET-SAVED/, 'the previous answer reaches the model');
});

test('1: reconcileStored extends only on a strict prefix and keeps stored on divergence', () => {
  const t = (role: 'user' | 'assistant', text: string) => ({ role, text });
  const stored = [t('user', 'a'), t('assistant', 'b')];
  assert.deepStrictEqual(reconcileStored(stored, [t('user', 'a'), t('assistant', 'b'), t('user', 'c'), t('assistant', 'd')], 0)?.map((x) => x.text), ['a', 'b', 'c', 'd']);
  assert.strictEqual(reconcileStored(stored, [t('user', 'a'), t('assistant', 'b')], 0), null, 'equal is not an extension');
  assert.strictEqual(reconcileStored(stored, [t('user', 'x'), t('assistant', 'y'), t('user', 'c')], 0), null, 'a diverging window loses');
  assert.strictEqual(reconcileStored(stored, [t('user', 'STALE')], 0), null);
  /* A client that already dropped its oldest turn: its tail starts at stored[1]. */
  assert.deepStrictEqual(reconcileStored(stored, [t('assistant', 'b'), t('user', 'c')], 1)?.map((x) => x.text), ['a', 'b', 'c']);
  assert.strictEqual(reconcileStored(stored, [t('user', 'c')], 2), null, 'nothing verifiable shared');
});

/* ── 2. the summary is inside the budget ─────────────────────────────── */

test('2: on a 4096-token local window summary plus verbatim turns stay inside the history budget', async () => {
  resetHistorySummaryMemory();
  const turns: T[] = [];
  for (let i = 0; i < 40; i++) {
    turns.push({ role: 'user', text: `Question ${i}: how does module m${i} talk to the database and what about retries and the cache layer in front of it?` });
    turns.push({ role: 'assistant', text: `Answer ${i}: `.padEnd(900, 'module m talks to the db through the pool. ') });
  }
  const budget = historyBudgetTokens(null, 'llama3');
  for (const summarize of [undefined, async () => 'x '.repeat(5000)]) {
    resetHistorySummaryMemory();
    const out = await buildAskHistory({ sessionsRoot: null, threadId: undefined, requestHistory: turns, requestDropped: 0, question: 'q', contextWindow: null, model: 'llama3', ...(summarize ? { summarize } : {}) });
    assert.ok(out.summarizedTurns > 0);
    const used = estimateTokens(out.lines.join(String.fromCharCode(10)));
    assert.ok(used <= budget * 1.1, `prior chat ${used} tokens within the ${budget}-token budget (kind ${out.summaryKind})`);
  }
});

/* ── 3. the summarizer reads what its window allows ───────────────────── */

test('3: a 4k summarizing model gets prompts that fit its window, folded in chunks, and the first fact survives', async () => {
  resetHistorySummaryMemory();
  const filler = 'Some unremarkable discussion of the build pipeline and its caches. '.repeat(30);
  const turns: T[] = [{ role: 'user', text: `Remember this. ${FACT}` }, { role: 'assistant', text: 'Noted.' }];
  for (let i = 0; i < 40; i++) turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `turn ${i} ${filler}` });
  const sizes: number[] = [];
  const summarize = async (prompt: string): Promise<string> => {
    sizes.push(estimateTokens(prompt));
    return prompt.includes('PURPLE-ELEPHANT-7') ? `Facts so far. ${FACT}` : 'nothing';
  };
  const limits = summaryLimits(4096, 'llama3');
  const out = await buildAskHistory({ sessionsRoot: null, threadId: undefined, requestHistory: turns, requestDropped: 0, question: 'q', contextWindow: 4096, model: 'llama3', summarize });
  assert.ok(sizes.length > 1, 'folded in more than one call');
  for (const s of sizes) assert.ok(s + limits.outputTokens <= 4096, `prompt ${s} + reply fits 4096`);
  assert.match(out.lines.join(String.fromCharCode(10)), /PURPLE-ELEPHANT-7/);
});

/* ── 4. the agent handoff makes no provider call on a hosted config ───── */

const FAKE = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'fake-codex-rewind', 'codex.mjs');

test('4: the agent handoff summarizes without any provider call when the configured model is hosted', async () => {
  const dir = t3repo();
  const store = temp('seq-ho-priv-');
  Object.assign(process.env, { REWIND_STATE: path.join(store, 'state.json'), REWIND_LOG: path.join(store, 'log.jsonl') });
  addAgent(store, { id: 'codex', command: process.execPath, args: [FAKE], cwd: dir });
  const mock = await startMockProvider(() => ({ text: 'SHOULD-NOT-BE-CALLED' }));
  const { base, close } = await serve(dir, store);
  try {
    await fetch(`${base}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: 'sk-ant-test-PRIV-42' }) });
    const big = 'A long unremarkable paragraph about the build. '.repeat(300);
    const turns: T[] = [{ role: 'user', text: `Remember: ${FACT}` }, { role: 'assistant', text: 'Noted.' }];
    for (let i = 0; i < 60; i++) turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `t${i} ${big}` });
    const id = createSession(dir).id;
    updateSession(dir, id, { chat: { version: 2, sessionId: id, turns } }, 'client');
    const events: Json[] = await turn(base, { agentRef: 'codex', prompt: 'go on', permissionMode: 'autoEdit', interactivePermissions: true, chatId: id });
    assert.ok(events.length > 0);
    assert.strictEqual(mock.requests.length, 0, 'no provider call: the agent transcript did not leave the machine');
    const log = fs.readFileSync(path.join(store, 'log.jsonl'), 'utf8');
    assert.match(log, /PURPLE-ELEPHANT-7/, 'the extractive summary still carries the first ask');
  } finally {
    await close();
    await mock.close();
    delete process.env.REWIND_STATE;
    delete process.env.REWIND_LOG;
  }
});

/* ── 5. Stop reaches the summary call ─────────────────────────────────── */

test('5: closing the request while the summary is being made aborts the summary call', async () => {
  const repo = tmpRepo();
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(160);
  const turns: T[] = [{ role: 'user', text: `Remember. ${FACT}` }, { role: 'assistant', text: 'Noted.' }];
  for (let i = 0; i < 30; i++) turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `Filler ${i}. ${filler}` });
  writeChat(repo, 'chat-stop', turns);
  let summaryStarted: () => void = () => undefined;
  const started = new Promise<void>((r) => (summaryStarted = r));
  const mock = await startMockProvider((body) => {
    if (isSummaryCall(promptText(body))) summaryStarted();
    return { text: 'ok' };
  });
  /* Hold the summary reply open: a provider that never answers. */
  const http = await import('node:http');
  const hold = http.createServer((req) => {
    req.on('data', () => undefined);
    req.on('end', () => summaryStarted());
    /* never respond */
  });
  await new Promise<void>((r) => hold.listen(0, '127.0.0.1', () => r()));
  const holdPort = (hold.address() as { port: number }).port;
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/api/ai-config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', baseUrl: `http://127.0.0.1:${holdPort}`, model: 'claude-test', apiKey: 'sk-ant-test-STOP-42' }) });
    const ac = new AbortController();
    const sent = fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'what was the hint?', threadId: 'chat-stop', intents: [{ id: 'impact', subject: 'backend', subjectNodeId: 'svc:backend' }] }),
    }).catch(() => undefined);
    await started;
    const t0 = Date.now();
    ac.abort();
    await sent;
    /* The held socket is released once the server aborts its outbound call. */
    const dropped = await new Promise<boolean>((resolve) => {
      const check = (n: number): void => {
        hold.getConnections((_e, c) => {
          if (c === 0) resolve(true);
          else if (n > 40) resolve(false);
          else setTimeout(() => check(n + 1), 50);
        });
      };
      check(0);
    });
    assert.ok(dropped, 'the outbound summary request was cancelled');
    assert.ok(Date.now() - t0 < 10_000, 'well inside the 25 s summary timeout');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    hold.closeAllConnections?.();
    await new Promise<void>((r) => hold.close(() => r()));
    await mock.close();
  }
});

/* ── 019-model: the summary is not re-made every turn ────────────────── */

/*
 * A summary call happens at most once per SUMMARY_REFRESH_TURNS exchanges (N = 6: DROP_STEP is 12 messages).
 * Why: a call is one extra provider round trip on the turn that makes it (turn time 1.7 s to 2-3 s measured),
 * and the summary only has to change when the verbatim window has moved a whole step, not on every turn.
 * Between refreshes the cached summary is reused and the turns it has not seen ride along as extractive lines.
 * 4096 is a local model whose window the server could not probe (the reviewer's mock): there one exchange is
 * most of the budget, so the boundary moves every turn unless the summary is rolled forward without a call.
 */
for (const contextWindow of [4096, 16384]) {
  test(`019-model: 30 turns over budget make at most ceil(30/N) summary calls (window ${contextWindow})`, async () => {
    const { SUMMARY_REFRESH_TURNS } = await import('../server/askHistory.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-sumcalls-'));
    resetHistorySummaryMemory();
    let calls = 0;
    const summarize = async (): Promise<string> => {
      calls += 1;
      return 'Earlier the person asked about modules and their database retries.';
    };
    const history: T[] = [];
    let lastSummarized = 0;
    let lastLines = '';
    const TURNS = 30;
    for (let i = 0; i < TURNS; i++) {
      const question = `Question ${i}: how does module m${i} talk to the database and the cache?`;
      const out = await buildAskHistory({ sessionsRoot: root, threadId: 't', requestHistory: history, requestDropped: 0, question, contextWindow, model: 'llama3', summarize });
      lastSummarized = out.summarizedTurns;
      lastLines = out.lines.join(String.fromCharCode(10));
      history.push({ role: 'user', text: question });
      history.push({ role: 'assistant', text: `Answer ${i}: `.padEnd(contextWindow === 4096 ? 300 : 900, 'module m talks to the db through the pool. ') });
    }
    assert.ok(lastSummarized > 0, 'the history went over budget, or this test measures nothing');
    assert.ok(calls >= 1, 'a summary was made at all');
    assert.ok(calls <= Math.ceil(TURNS / SUMMARY_REFRESH_TURNS), `${calls} summary calls in ${TURNS} turns; at most ${Math.ceil(TURNS / SUMMARY_REFRESH_TURNS)}`);
    assert.match(lastLines, /Earlier the person asked about modules/, 'the model summary is still carried');
  });
}
