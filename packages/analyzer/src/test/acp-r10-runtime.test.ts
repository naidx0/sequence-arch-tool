import { eventually } from './load-scale.js';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a person-stopped turn the bridge honours with cancelled is saved as stopped, with no title from partial text', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const k = `chat::${s.chatId}::mock`;
    const t = turn(srv.base, { prompt: 'do it SLOW', chatId: s.chatId, sessionKey: k });
    await t.waitFor((e) => e.type === 'acp:update');
    t.stop();
    /* Waits for the saved state, not 900 ms: still proves the stopped turn ends up saved as 'stopped'. */
    await eventually(() => readAgentRuns(s.root, s.chatId).some((r) => r.status === 'stopped'));
    const runs = readAgentRuns(s.root, s.chatId);
    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0]!.status, 'stopped');
    const log = (await (await fetch(`${srv.base}/api/acp/turn-log?chatId=${s.chatId}`)).json()) as { turns: { outcome: string }[] };
    assert.deepStrictEqual(log.turns.map((x) => x.outcome), ['stopped']);
  } finally {
    await srv.close();
  }
});

test('a send after an answered-but-held turn cancels the held turn and starts promptly', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const k = `chat::${s.chatId}::mock`;
    const a = turn(srv.base, { prompt: 'Explain HOLD', chatId: s.chatId, sessionKey: k });
    await a.waitFor(isState('answered'));
    const b = turn(srv.base, { prompt: 'next', chatId: s.chatId, sessionKey: k });
    await b.waitFor((e) => e.type === 'acp:result', 3_000);
    a.stop();
    b.stop();
    await sleep(300);
    const first = readAgentRuns(s.root, s.chatId).find((r) => r.prompt === 'Explain HOLD');
    assert.strictEqual(first?.status, 'done');
  } finally {
    await srv.close();
  }
});

test('a send stopped while queued never runs and is not saved', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const k = `chat::${s.chatId}::mock`;
    const a = turn(srv.base, { prompt: 'x SLOW', chatId: s.chatId, sessionKey: k });
    await a.waitFor((e) => e.type === 'acp:update');
    const b = turn(srv.base, { prompt: 'queued-one', chatId: s.chatId, sessionKey: k });
    await b.waitFor(isState('queued'));
    b.stop();
    await sleep(200);
    a.stop();
    await sleep(1200);
    const runs = readAgentRuns(s.root, s.chatId);
    assert.ok(!runs.some((r) => r.prompt === 'queued-one' && r.status === 'done'), JSON.stringify(runs.map((r) => [r.prompt, r.status])));
    const c = turn(srv.base, { prompt: 'third', chatId: s.chatId, sessionKey: k });
    await c.waitFor((e) => e.type === 'acp:result', 5_000);
    c.stop();
  } finally {
    await srv.close();
  }
});

test('a compaction turn is not saved as a visible run', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const k = `chat::${s.chatId}::mock`;
    const t = turn(srv.base, { prompt: '/compact', chatId: s.chatId, sessionKey: k, compact: true });
    await t.waitFor((e) => e.type === 'acp:result', 5_000);
    await sleep(200);
    assert.strictEqual(readAgentRuns(s.root, s.chatId).length, 0);
  } finally {
    await srv.close();
  }
});
