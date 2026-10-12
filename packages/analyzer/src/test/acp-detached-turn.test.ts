import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated, readSessionIndex } from '../server/sessionsStore.js';

/*
 * Owner: several chats running agents in the background at once. A chat turn
 * was cancelled the moment its stream closed, and a reload (or opening a chat
 * in another workspace, which reloads) closes every stream: one reload stopped
 * every agent in every chat (web2 e2e/multi-chat.mjs). Now a chat turn keeps
 * going, a page that comes back follows it (GET /api/acp/live, /api/acp/attach),
 * Stop stops it by name, and a turn nobody comes back for is still stopped
 * after the grace. A real subprocess (the fake ACP agent the e2e uses), no
 * account, no network.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.resolve(here, '..', '..', '..', 'web2', 'e2e', 'fixtures', 'fake-agents', 'fake-acp-agent.mjs');

type Json = Record<string, unknown>;

async function rig(graceMs: number) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-detached-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  assert.ok(readSessionIndex(root));
  addAgent(store, { id: 'fake', command: process.execPath, args: [FAKE, '--as', 'local'] });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, acpTurn: { detachGraceMs: graceMs, stopGraceMs: 200 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    base,
    chatId,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

/** Read an event stream until `stop(events)` says so, then drop the connection (what a reload does). */
async function readUntil(res: Response, stop: (events: Json[]) => boolean, ac?: AbortController): Promise<Json[]> {
  const events: Json[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }) as const);
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      for (const line of block.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)) as Json);
    }
    if (stop(events)) {
      ac?.abort();
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return events;
}

const textOf = (events: Json[]) =>
  events
    .filter((e) => e.type === 'acp:update')
    .map((e) => (((e.update as Json).update as Json).content as Json | undefined)?.text ?? '')
    .join('');

async function startTurn(base: string, chatId: string, prompt: string) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ agentRef: 'fake', prompt, chatId, sessionKey: `chat::${chatId}::fake`, interactivePermissions: true }),
    signal: ac.signal,
  });
  assert.equal(res.status, 200);
  /* The page reloads once the agent has started talking. */
  const first = await readUntil(res, (ev) => textOf(ev).includes('#2'), ac);
  const turnId = first.find((e) => e.type === 'acp:turn-id')?.turnId as string;
  assert.ok(turnId);
  return { turnId, first };
}

const runsOf = async (base: string, chatId: string) => ((await (await fetch(`${base}/api/acp/runs?chatId=${chatId}`)).json()) as { runs: Json[] }).runs;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a chat turn keeps running when its page goes, and a page that comes back follows it to the end', async () => {
  const s = await rig(5_000);
  try {
    const { turnId } = await startTurn(s.base, s.chatId, 'go MARK:DT STEPS:12 DELAY:100');
    await sleep(300);
    const live = ((await (await fetch(`${s.base}/api/acp/live`)).json()) as { turns: Json[] }).turns;
    assert.deepEqual(live.map((t) => [t.turnId, t.chatId, t.agentRef, t.prompt]), [[turnId, s.chatId, 'fake', 'go MARK:DT STEPS:12 DELAY:100']]);
    const res = await fetch(`${s.base}/api/acp/attach?turnId=${turnId}`, { headers: { accept: 'text/event-stream' } });
    assert.equal(res.status, 200);
    const events = await readUntil(res, () => false);
    const text = textOf(events);
    assert.ok(text.startsWith('local answering DT. DT#1 DT#2'), `the attach replays from the start: ${text.slice(0, 60)}`);
    assert.ok(text.includes('DT#12 DONE-DT'), 'and follows the turn to its end');
    assert.equal(events.at(-1)?.type, 'acp:turn');
    assert.equal(events.at(-1)?.state, 'settled');
    const last = (await runsOf(s.base, s.chatId)).at(-1)!;
    assert.equal(last.status, 'done');
    assert.equal(((await (await fetch(`${s.base}/api/acp/live`)).json()) as { turns: Json[] }).turns.length, 0);
    assert.equal((await fetch(`${s.base}/api/acp/attach?turnId=${turnId}`)).status, 404);
  } finally {
    await s.close();
  }
});

test('Stop names the turn: a turn whose page went is stopped by POST /api/acp/stop', async () => {
  const s = await rig(5_000);
  try {
    const { turnId } = await startTurn(s.base, s.chatId, 'go MARK:ST STEPS:200 DELAY:100');
    const r = await fetch(`${s.base}/api/acp/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId }) });
    assert.deepEqual(await r.json(), { stopped: true });
    let last: Json | undefined;
    for (let i = 0; i < 40 && (!last || last.status === 'running'); i++) {
      await sleep(100);
      last = (await runsOf(s.base, s.chatId)).at(-1);
    }
    assert.equal(last?.status, 'stopped');
  } finally {
    await s.close();
  }
});

test('a turn nobody comes back for is stopped after the grace, as a closed stream always stopped it', async () => {
  const s = await rig(300);
  try {
    await startTurn(s.base, s.chatId, 'go MARK:AB STEPS:200 DELAY:100');
    let last: Json | undefined;
    for (let i = 0; i < 50 && (!last || last.status === 'running'); i++) {
      await sleep(100);
      last = (await runsOf(s.base, s.chatId)).at(-1);
    }
    assert.equal(last?.status, 'stopped');
    assert.ok(!String(last?.text ?? '').includes('DONE-AB'));
  } finally {
    await s.close();
  }
});
