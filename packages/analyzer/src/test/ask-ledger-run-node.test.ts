import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import { readAgentRuns } from '../server/agentChatStore.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';

/**
 * THE ASK LEDGER THROUGH THE REAL SERVER (t3gap/asks).
 *
 * Setting on: a short private instruction follows the person's words and
 * asks the AGENT to end a multi-request reply on one closing line. The server
 * only parses that line: it reports what the agent marked not done, and cuts
 * the line from what is shown, saved and titled, including when the bridge
 * holds the turn open after answering (claude-agent-acp's HOLD shape).
 * The mock agent echoes its prompt, or streams a scripted reply (REPLY<<…>>).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

type Ev = Record<string, unknown>;

function specimen(): { root: string; store: string; chatId: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-asks-')));
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  addAgent(store, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  return { root, store, chatId };
}

async function serve(store: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store, acpTurn: { answerQuietMs: 150, stopGraceMs: 150, statusEveryMs: 60, killGraceMs: 0 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

async function post(base: string, body: Ev): Promise<{ status: number; json: Ev }> {
  const res = await fetch(`${base}/api/acp/run-node`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentRef: 'mock', ...body }) });
  return { status: res.status, json: (await res.json()) as Ev };
}

/** A streamed turn; resolves on the first event that matches. */
function streamUntil(base: string, body: Ev, pred: (e: Ev) => boolean, ms = 8000): { hit: Promise<Ev>; stop: () => void } {
  const ac = new AbortController();
  const hit = (async () => {
    const res = await fetch(`${base}/api/acp/run-node?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ agentRef: 'mock', interactivePermissions: true, ...body }), signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const e = JSON.parse(line.slice(6)) as Ev;
          if (pred(e)) return e;
        }
      }
    }
    throw new Error('no matching event');
  })();
  return { hit, stop: () => ac.abort() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VOICE = 'remove the colorful mod from the screen by default, I like the standing 7d and 5h thing, show total tokens this week as well';
const REPLY = 'The meter row is gone; the 7d/5h line stays.\n<asks>1 hide the meter row: done; 2 keep the 7d/5h line: done; 3 weekly token total: not done: the usage API has no counts</asks> ';

test('setting on: the agent gets one short instruction after the person’s words, and no list of asks', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const r = await post(srv.base, { prompt: VOICE, askLedger: true, sessionKey: 'k1' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const text = String(r.json.text);
    assert.ok(text.includes(VOICE), 'the person’s words reach the agent unchanged');
    assert.ok(text.indexOf(VOICE) < text.indexOf('several separate requests'), 'the instruction follows the message');
    assert.doesNotMatch(text, /\n1\. remove/, 'the app sends no numbered list');
  } finally {
    await srv.close();
  }
});

test('the closing line is read, cut from the shown text, and saved cut, with the report, for a relaunch', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const r = await post(srv.base, { prompt: `${VOICE} REPLY<<${REPLY}>>`, askLedger: true, chatId: s.chatId, sessionKey: `chat::${s.chatId}::mock` });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.doesNotMatch(String(r.json.text), /<asks>/);
    assert.match(String(r.json.text), /the 7d\/5h line stays\.$/);
    const ledger = r.json.askLedger as { open: number[]; closures: { text: string; reason: string | null }[] };
    assert.deepStrictEqual(ledger.open, [3]);
    assert.strictEqual(ledger.closures[2]!.reason, 'the usage API has no counts');
    await sleep(100);
    const saved = readAgentRuns(s.root, s.chatId).find((x) => x.prompt.startsWith('remove the colorful'))!;
    assert.doesNotMatch(saved.text, /<asks>/, 'the saved text is the shown text');
    assert.deepStrictEqual(saved.askLedger?.open, [3], 'the report survives a relaunch');
  } finally {
    await srv.close();
  }
});

test('Claude’s HOLD shape: the answered event already carries the report, and the saved run is cut', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const t = streamUntil(srv.base, { prompt: `HOLD ${VOICE} REPLY<<${REPLY}>>`, askLedger: true, chatId: s.chatId, sessionKey: `chat::${s.chatId}::mock` }, (e) => e.type === 'acp:turn' && e.state === 'answered');
    const answered = await t.hit;
    assert.doesNotMatch(String(answered.text), /<asks>/);
    assert.deepStrictEqual((answered.askLedger as { open: number[] }).open, [3]);
    await sleep(100);
    const saved = readAgentRuns(s.root, s.chatId).find((x) => x.prompt.startsWith('HOLD'))!;
    assert.doesNotMatch(saved.text, /<asks>/);
    assert.deepStrictEqual(saved.askLedger?.open, [3]);
    t.stop();
    await sleep(300);
  } finally {
    await srv.close();
  }
});

test('setting off: nothing is added and nothing is cut; the follow-up gets no instruction', async () => {
  const s = specimen();
  const srv = await serve(s.store);
  try {
    const off = await post(srv.base, { prompt: `${VOICE} REPLY<<${REPLY}>>`, sessionKey: 'k3' });
    assert.match(String(off.json.text), /<asks>1 hide the meter row/, 'off: the reply is the agent’s, untouched');
    assert.strictEqual(off.json.askLedger, undefined);
    const echo = await post(srv.base, { prompt: VOICE, sessionKey: 'k4' });
    assert.doesNotMatch(String(echo.json.text), /several separate requests/);
    const again = await post(srv.base, { prompt: 'Your reply marked this request not done:\n- weekly token total', askLedger: true, sessionKey: 'k5' });
    assert.doesNotMatch(String(again.json.text), /several separate requests/);
  } finally {
    await srv.close();
  }
});
