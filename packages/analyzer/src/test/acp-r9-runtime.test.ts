import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { agentChatTitle, readAgentRuns } from '../server/agentChatStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated, readSessionIndex } from '../server/sessionsStore.js';

/**
 * ROUND 9 — AGENT TURNS THAT ANSWER, STOP, QUEUE, LOG AND STAY.
 *
 * Jaden's walkthrough: Stop stayed after Claude had answered; a message sent
 * then sat silently; Stop left the chat locked; nothing was logged; chats were
 * lost on relaunch and never titled. Driven through the real server against
 * the conformant mock ACP agent (a node script, never a real claude or codex):
 *   HOLD  answers, reports its cost, then holds session/prompt open (the
 *         claude-agent-acp shape), ending only on cancel
 *   HANG  answers nothing more and ignores cancel
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

type Ev = Record<string, unknown>;

function specimen(): { root: string; store: string; chatId: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-r9-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  return { root, store, chatId };
}

async function serve(store: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: store,
    acpTurn: { answerQuietMs: 150, stopGraceMs: 150, statusEveryMs: 60, killGraceMs: 0 },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

/** One streamed turn: its events as they come, a way to wait for one, and Stop. */
function turn(base: string, body: Ev) {
  const ac = new AbortController();
  const events: Ev[] = [];
  const waiters: { pred: (e: Ev) => boolean; resolve: (e: Ev) => void }[] = [];
  const done = (async () => {
    const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ agentRef: 'mock', interactivePermissions: true, ...body }),
      signal: ac.signal,
    });
    assert.strictEqual(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const e = JSON.parse(line.slice(6)) as Ev;
            events.push(e);
            for (const w of waiters.slice()) if (w.pred(e)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(e));
          }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) throw e;
    }
    return events;
  })();
  const waitFor = (pred: (e: Ev) => boolean, ms = 8_000): Promise<Ev> => {
    const seen = events.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no matching event in ${ms} ms; saw ${events.map((e) => `${e.type}:${String(e.state ?? e.phase ?? '')}`).join(', ')}`)), ms);
      waiters.push({ pred, resolve: (e) => (clearTimeout(t), resolve(e)) });
    });
  };
  /* Stop, as the page does it: the turn is named to the server (a dropped stream alone no longer stops a chat turn, so a reload cannot), then the stream is dropped. */
  const stop = (): void => {
    const turnId = events.find((e) => e.type === 'acp:turn-id')?.turnId;
    if (typeof turnId === 'string') void fetch(`${base}/api/acp/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId }) }).catch(() => {});
    ac.abort();
  };
  return { events, done, waitFor, stop };
}

const isState = (s: string) => (e: Ev) => e.type === 'acp:turn' && e.state === s;

test('a held turn is answered once the agent has said its piece; the chat is saved and titled from it', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const sessionKey = `chat::${s.chatId}::mock`;
    const first = turn(srv.base, { prompt: 'Explain the ultimate answer HOLD', chatId: s.chatId, sessionKey });
    const answered = await first.waitFor(isState('answered'));
    assert.match(String(answered.text), /The answer is 42\./);
    /* The bridge still holds session/prompt: no result yet, but the turn is answered. */
    assert.ok(!first.events.some((e) => e.type === 'acp:result'), 'the bridge has not ended the turn');
    assert.ok(first.events.some((e) => e.type === 'acp:status'), 'live status was sent');

    /* Saved and named the moment it was answered. */
    const title = await first.waitFor((e) => e.type === 'acp:title');
    assert.strictEqual(title.title, 'The ultimate answer HOLD');
    const entry = readSessionIndex(s.root)!.sessions.find((x) => x.id === s.chatId)!;
    assert.strictEqual(entry.title, 'The ultimate answer HOLD');
    assert.strictEqual(entry.titleGenerated, true);
    const saved = await (await fetch(`${srv.base}/api/acp/runs?chatId=${encodeURIComponent(s.chatId)}`)).json() as { runs: Ev[] };
    assert.strictEqual(saved.runs.length, 1);
    assert.strictEqual(saved.runs[0]!.status, 'done');
    assert.match(String(saved.runs[0]!.text), /The answer is 42\./);
    assert.strictEqual(saved.runs[0]!.prompt, 'Explain the ultimate answer HOLD');

    /* A message sent during the hold is QUEUED, and says so at once. */
    const second = turn(srv.base, { prompt: 'and again', chatId: s.chatId, sessionKey });
    await second.waitFor(isState('queued'));
    await second.waitFor((e) => e.type === 'acp:status' && e.phase === 'queued');

    /* The person stops the held turn: the queued one runs. */
    first.stop();
    const result = await second.waitFor((e) => e.type === 'acp:result');
    assert.match(String(result.text), /echo: and again/);
    await second.done;
    const log = await second.waitFor((e) => e.type === 'acp:log');
    assert.ok((log.log as { entries: Ev[] }).entries.some((e) => e.ev === 'queued'));

    /* Two turns on disk, in order; the title did not move. */
    const runs = readAgentRuns(s.root, s.chatId);
    assert.deepStrictEqual(runs.map((r) => r.prompt), ['Explain the ultimate answer HOLD', 'and again']);
    assert.strictEqual(runs[0]!.status, 'done', 'an answered turn stays answered when it is stopped after');
    assert.strictEqual(readSessionIndex(s.root)!.sessions.find((x) => x.id === s.chatId)!.title, 'The ultimate answer HOLD');
  } finally {
    await srv.close();
  }
});

test('Stop frees the chat: a bridge that ignores cancel is killed after the grace, and the next turn runs', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const sessionKey = `chat::${s.chatId}::mock`;
    const stuck = turn(srv.base, { prompt: 'please HANG', chatId: s.chatId, sessionKey });
    await stuck.waitFor((e) => e.type === 'acp:update');
    stuck.stop();
    const t0 = Date.now();
    const next = turn(srv.base, { prompt: 'are you there', chatId: s.chatId, sessionKey });
    const result = await next.waitFor((e) => e.type === 'acp:result', 8_000);
    assert.match(String(result.text), /echo: are you there/);
    assert.ok(Date.now() - t0 < 8_000, 'not locked behind the stuck turn');
    await next.done;

    const runs = readAgentRuns(s.root, s.chatId);
    assert.strictEqual(runs[0]!.status, 'stopped');
    assert.strictEqual(runs[1]!.status, 'done');

    /* Every turn logged, and the log carries no words. */
    const log = (await (await fetch(`${srv.base}/api/acp/turn-log?chatId=${encodeURIComponent(s.chatId)}`)).json()) as { turns: Ev[] };
    assert.deepStrictEqual(log.turns.map((t) => t.outcome), ['stopped', 'ended']);
    const text = JSON.stringify(log.turns);
    assert.ok(!text.includes('are you there') && !text.includes('please HANG'), 'no prompt text in the log');
  } finally {
    await srv.close();
  }
});

test('titles: the question names the chat; a question that says nothing defers to the answer', () => {
  assert.strictEqual(agentChatTitle('Can you fix the flaky login test in auth.spec.ts', ''), 'Fix the flaky login test in auth.spec.ts');
  assert.strictEqual(agentChatTitle('hi', '## Repository overview\nThis repo is…'), 'Repository overview');
  assert.strictEqual(agentChatTitle('hello!', 'Hello! I can help you refactor the parser. What next?'), 'Hello');
  assert.strictEqual(agentChatTitle('ok', ''), 'Ok');
  assert.strictEqual(agentChatTitle('', ''), '');
});
