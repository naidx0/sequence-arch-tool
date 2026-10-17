import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { interruptedRun, listInterruptedChats, readAgentRuns, runsForWire } from '../server/agentChatStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

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
  return { events, done, waitFor, stop: () => ac.abort() };
}


/**
 * T3 GAP G10 — A TURN A RESTART CUT OFF CAN BE CONTINUED.
 * A turn is recorded as `running` from the moment the prompt is with the
 * agent. If the app dies there, nothing ever writes its stop reason; the next
 * boot finds the chat, and the page offers Continue.
 */
test('a turn in flight is recorded as running; a new process reads it back as interrupted', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const sessionKey = `chat::${s.chatId}::mock`;
    const t = turn(srv.base, { prompt: 'refactor the parser HANG', chatId: s.chatId, sessionKey });
    await t.waitFor((e) => e.type === 'acp:update' || e.type === 'acp:status');
    for (let i = 0; i < 100 && readAgentRuns(s.root, s.chatId).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    const [rec] = readAgentRuns(s.root, s.chatId);
    assert.strictEqual(rec!.status, 'running');
    assert.strictEqual(rec!.stopReason, null);
    assert.strictEqual(rec!.prompt, 'refactor the parser HANG');

    /* This process owns the turn: the page is told it is running, not interrupted. */
    const live = await (await fetch(`${srv.base}/api/acp/runs?chatId=${encodeURIComponent(s.chatId)}`)).json() as { runs: Ev[] };
    assert.strictEqual(live.runs[0]!.status, 'running');
    assert.strictEqual(((await (await fetch(`${srv.base}/api/sessions`)).json()) as { interrupted?: string[] }).interrupted, undefined);

    /* A restart: a process with no live turn reads the same file. */
    const fresh = new Set<string>();
    assert.strictEqual(interruptedRun(readAgentRuns(s.root, s.chatId), fresh)!.id, rec!.id);
    assert.deepStrictEqual(listInterruptedChats(s.root, fresh).map((c) => [c.chatId, c.runId]), [[s.chatId, rec!.id]]);
    assert.strictEqual(runsForWire(readAgentRuns(s.root, s.chatId), fresh)[0]!.status, 'interrupted');
    t.stop();
    await t.done.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    await srv.close();
  }
});

test('only the newest cut-off turn is continuable; a settled turn is never interrupted', () => {
  const base = { agentRef: 'mock', text: '', error: null, stopReason: null, endedAt: 0, model: null, nodeId: null, tools: [] };
  const runs = [
    { ...base, id: 'a', prompt: 'one', status: 'running' as const, startedAt: 1 },
    { ...base, id: 'b', prompt: 'two', status: 'running' as const, startedAt: 2 },
  ];
  const none = new Set<string>();
  assert.strictEqual(interruptedRun(runs, none)!.id, 'b');
  const wire = runsForWire(runs, none);
  assert.deepStrictEqual(wire.map((r) => r.status), ['interrupted', 'interrupted']);
  assert.deepStrictEqual(wire.map((r) => r.continuable), [undefined, true]);
  assert.strictEqual(interruptedRun([{ ...runs[1]!, status: 'done' }], none), null);
  assert.strictEqual(interruptedRun(runs, new Set(['b'])), null);
});

import { AgentTurnRuntime } from '../server/agentTurnRuntime.js';
import { ManualClock } from '../../../acp/dist/replay/clock.js';
import { liveTurnIds } from '../server/agentChatStore.js';

test('if the closing write fails the turn is served as finished from memory, and the next successful save writes it', () => {
  const s = specimen();
  const rt = new AgentTurnRuntime({ clock: new ManualClock(), emit: () => {}, agentRef: 'mock', provider: null, chatId: s.chatId, prompt: 'first', nodeId: null, sessionsRoot: s.root, userConfigDir: s.store, detectAnswer: false });
  rt.sent();
  const file = path.join(s.root, '.sequence', 'sessions', s.chatId, 'agent-runs.json');
  assert.strictEqual(readAgentRuns(s.root, s.chatId)[0]!.status, 'running');
  /* Make every later write fail: the file's place is taken by a folder. */
  fs.rmSync(file);
  fs.mkdirSync(file);
  rt.finish('ended', { stopReason: 'end_turn', text: 'done' });
  assert.deepStrictEqual(runsForWire(readAgentRuns(s.root, s.chatId), new Set()).map((r) => [r.prompt, r.status]), [['first', 'done']], 'not stuck running, not interrupted');
  /* The disk is fine again; a later turn saves, and the first one comes out of memory with it. */
  fs.rmSync(file, { recursive: true });
  const rt2 = new AgentTurnRuntime({ clock: new ManualClock(), emit: () => {}, agentRef: 'mock', provider: null, chatId: s.chatId, prompt: 'second', nodeId: null, sessionsRoot: s.root, userConfigDir: s.store, detectAnswer: false });
  rt2.sent();
  rt2.finish('ended', { stopReason: 'end_turn', text: 'ok' });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { runs: { prompt: string; status: string }[] };
  assert.deepStrictEqual(onDisk.runs.map((r) => [r.prompt, r.status]), [['first', 'done'], ['second', 'done']]);
  assert.strictEqual(liveTurnIds.has(rt.turnId), false);
});

test('a canvas-node turn keeps its node on the record', () => {
  const s = specimen();
  const rt = new AgentTurnRuntime({ clock: new ManualClock(), emit: () => {}, agentRef: 'mock', provider: null, chatId: s.chatId, prompt: 'explain', nodeId: 'node:auth', sessionsRoot: s.root, userConfigDir: s.store, detectAnswer: false });
  rt.sent();
  assert.strictEqual(readAgentRuns(s.root, s.chatId)[0]!.nodeId, 'node:auth');
  rt.finish('ended', { stopReason: 'end_turn', text: 'x' });
});
