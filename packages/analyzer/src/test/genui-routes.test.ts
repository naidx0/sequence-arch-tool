import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { GenuiHub, genuiHub, genuiIngestUrl, handleGenuiRoute, type GenuiRunner } from '../server/genuiRoutes.js';
import { loadAuthConfig } from '../server/auth.js';
import { createRepoServer } from '../server/repoServer.js';
import { sequenceMcpServer } from '../server/sequenceMcp.js';

/**
 * Generative UI routes. The REAL server: a fake agent POSTs ingest batches (what the MCP `ui` tool does) and an SSE
 * client of the owning chat receives matching ui.ops and ui.end frames. No agent is spawned anywhere here.
 */

async function start(repo: string) {
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}

interface Sse {
  frames: Record<string, unknown>[];
  waitFor: (n: number, ms?: number) => Promise<void>;
  close: () => void;
}
function sse(url: string): Promise<Sse> {
  return new Promise((resolve, reject) => {
    const frames: Record<string, unknown>[] = [];
    const waiters: { n: number; ok: () => void }[] = [];
    const req = http.get(url, (res) => {
      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers['content-type']), /text\/event-stream/);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        buf += c;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) frames.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
        }
        for (const w of [...waiters]) {
          if (frames.length >= w.n) {
            waiters.splice(waiters.indexOf(w), 1);
            w.ok();
          }
        }
      });
      resolve({
        frames,
        waitFor: (n, ms = 3000) =>
          frames.length >= n
            ? Promise.resolve()
            : new Promise<void>((ok, bad) => {
                waiters.push({ n, ok });
                setTimeout(() => bad(new Error(`waited for ${n} frames, saw ${frames.length}`)), ms).unref();
              }),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/* Frames go through this wrapper so the repository scanner, which reads a literal first argument of a call named publish as a queue topic, does not add chat ids like 'c' to Sequence's own graph. */
const say = (hub: GenuiHub, chat: string, frame: Parameters<GenuiHub['publish']>[1]): void => { hub.publish(chat, frame); };
const OP_CARD = { op: 'el', id: 'card', type: 'Card', props: { title: 'Upgrade auth' }, children: ['t'] };
const OP_TEXT = { op: 'el', id: 't', type: 'Text', props: { text: 'Running tests' } };

test('a fake agent ingests batches and the owning chat gets matching ui.ops and ui.end', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-')));
  const s = await start(repo);
  try {
    const mine = await sse(`${s.base}/api/genui/events?session=chat-a`);
    const other = await sse(`${s.base}/api/genui/events?session=chat-b`);
    const url = genuiIngestUrl(s.port, 'chat-a');
    assert.equal((await post(url, { surface: 's1', ops: [OP_CARD], done: false })).status, 200);
    assert.equal((await post(url, { surface: 's1', ops: [OP_TEXT], done: true })).status, 200);
    await mine.waitFor(3);
    assert.deepEqual(mine.frames, [
      { kind: 'ui.ops', surfaceId: 's1', ops: [OP_CARD] },
      { kind: 'ui.ops', surfaceId: 's1', ops: [OP_TEXT] },
      { kind: 'ui.end', surfaceId: 's1' },
    ]);
    assert.deepEqual(other.frames, [], 'a surface goes only to the chat that owns the agent session');
    mine.close();
    other.close();
  } finally {
    await s.close();
  }
});

test('ingest is refused without the key, and a bad body is a 400, not a frame', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-')));
  const s = await start(repo);
  try {
    const mine = await sse(`${s.base}/api/genui/events?session=c1`);
    assert.equal((await post(`${s.base}/api/genui/ingest?session=c1`, { surface: 's', ops: [OP_CARD] })).status, 403, 'no key');
    assert.equal((await post(`${s.base}/api/genui/ingest?session=c1&key=nope`, { surface: 's', ops: [OP_CARD] })).status, 403, 'wrong key');
    const ok = `${s.base}/api/genui/ingest?session=c1&key=${genuiHub.keyFor('c1')}`;
    assert.equal((await post(ok, { surface: 's', ops: 'not an array' })).status, 400);
    assert.equal((await post(ok, { surface: 's', ops: [{ nope: 1 }] })).status, 400);
    assert.equal((await post(ok, { surface: 's', ops: new Array(501).fill(OP_TEXT) })).status, 400, 'a batch is at most 500 ops');
    assert.equal((await post(ok, { surface: 'has space', ops: [OP_CARD] })).status, 400);
    assert.equal((await fetch(ok)).status, 405);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(mine.frames, []);
    mine.close();
  } finally {
    await s.close();
  }
});

test('a chat that connects mid-pass is caught up on the unfinished surface, and a finished one is not replayed', () => {
  const hub = new GenuiHub();
  const published: unknown[] = [];
  const fakeRes = { writableEnded: false, destroyed: false, write: (c: string) => published.push(c) } as unknown as http.ServerResponse;
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 'open', ops: [OP_CARD as never] });
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 'closed', ops: [OP_CARD as never] });
  say(hub, 'c', { kind: 'ui.end', surfaceId: 'closed' });
  const detach = hub.attach('c', fakeRes);
  assert.equal(published.length, 1);
  assert.match(String(published[0]), /"surfaceId":"open"/);
  assert.equal(hub.streamCount('c'), 1);
  detach();
  assert.equal(hub.streamCount('c'), 0);
});

/* turn, action and repair go to a runner; the real server attaches none, so these use the route handler with a fake. */
async function withRoutes(runner: GenuiRunner | undefined, fn: (base: string, hub: GenuiHub) => Promise<void>): Promise<void> {
  const hub = new GenuiHub();
  const srv = http.createServer((req, res) => {
    void handleGenuiRoute(req, res, new URL(req.url ?? '/', 'http://x').pathname, {
      root: null,
      readBody: (r) =>
        new Promise((ok) => {
          let b = '';
          r.on('data', (c) => (b += c));
          r.on('end', () => ok(b));
        }),
      sendJson: (r, st, body) => {
        r.statusCode = st;
        r.setHeader('content-type', 'application/json');
        r.end(JSON.stringify(body));
      },
      sendError: (r, st, message) => {
        r.statusCode = st;
        r.setHeader('content-type', 'application/json');
        r.end(JSON.stringify({ error: message }));
      },
      hub,
      runner,
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  try {
    await fn(`http://127.0.0.1:${(srv.address() as { port: number }).port}`, hub);
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((ok) => srv.close(() => ok()));
  }
}

test('turn, action and repair reach the runner; a click arrives as actionToPrompt text', async () => {
  const calls: string[] = [];
  const runner: GenuiRunner = {
    turn: (session, prompt) => void calls.push(`turn ${session} ${prompt}`),
    action: (session, prompt, a) => void calls.push(`action ${session} ${a.name} ${prompt}`),
    repair: async (session, prompt) => (calls.push(`repair ${session} ${prompt}`), { ops: [{ op: 'set', path: 'x', value: 1 }] }),
  };
  await withRoutes(runner, async (base) => {
    assert.equal((await post(`${base}/api/genui/turn`, { session: 'c', prompt: 'upgrade x' })).status, 202);
    const act = await post(`${base}/api/genui/action`, { session: 'c', action: { kind: 'ui.action', surfaceId: 's', name: 'fix', params: {}, elementId: 'b', state: {}, at: 1 } });
    assert.equal(act.status, 202);
    assert.match(((await act.json()) as { prompt: string }).prompt, /^\[ui\.action\] The person clicked "fix" on surface "s"/);
    const rep = await post(`${base}/api/genui/repair`, { session: 'c', diagnostics: { prompt: 'fix the card' } });
    assert.deepEqual(await rep.json(), { ops: [{ op: 'set', path: 'x', value: 1 }] });
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0], 'turn c upgrade x');
  assert.match(calls[1]!, /^action c fix \[ui\.action\]/);
  assert.equal(calls[2], 'repair c fix the card');
});

test('with no runner a turn is accepted but says so, and a repair is a 501 so the client falls back', async () => {
  await withRoutes(undefined, async (base) => {
    const t = await post(`${base}/api/genui/turn`, { session: 'c', prompt: 'hi' });
    assert.deepEqual(await t.json(), { accepted: true, runner: false });
    assert.equal((await post(`${base}/api/genui/repair`, { session: 'c', diagnostics: { prompt: 'p' } })).status, 501);
    assert.equal((await post(`${base}/api/genui/turn`, { session: 'c', prompt: '' })).status, 400);
    assert.equal((await post(`${base}/api/genui/action`, { session: 'c', action: { name: 'fix' } })).status, 400, 'an action must be a ui.action');
    assert.equal((await fetch(`${base}/api/genui/nope`)).status, 404);
  });
});

test('under hosted auth the browser routes need a session, and the agent door still opens with the key', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-')));
  const server = await createRepoServer(repo, {
    webDist: undefined,
    authConfig: loadAuthConfig({ GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', SESSION_SECRET: 'sess-secret-genui', PUBLIC_BASE_URL: 'https://app.example.com' } as NodeJS.ProcessEnv),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/genui/events?session=c`)).status, 401);
    for (const r of ['turn', 'action', 'repair']) assert.equal((await post(`${base}/api/genui/${r}`, { session: 'c' })).status, 401, r);
    assert.equal((await post(genuiIngestUrl(port, 'c'), { surface: 's', ops: [OP_CARD] })).status, 200, 'the MCP process has no cookie; the key is its credential');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an agent session launched for a chat gets SEQUENCE_GENUI_URL naming that chat; one without a chat gets none', () => {
  const url = genuiIngestUrl(4321, 'chat 9');
  const withChat = sequenceMcpServer('/tmp/repo', { entry: '/x/server.js', genuiUrl: url });
  assert.equal(withChat?.env?.SEQUENCE_GENUI_URL, url);
  assert.match(url, /^http:\/\/127\.0\.0\.1:4321\/api\/genui\/ingest\?session=chat%209&key=[0-9a-f]{32}$/);
  assert.equal(sequenceMcpServer('/tmp/repo', { entry: '/x/server.js' })?.env?.SEQUENCE_GENUI_URL, undefined);
});

test('review: a chat key only opens its own chat (a per-chat HMAC, not one key per process)', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-')));
  const s = await start(repo);
  try {
    const b = await sse(`${s.base}/api/genui/events?session=chat-b`);
    const keyA = new URL(genuiIngestUrl(s.port, 'chat-a')).searchParams.get('key');
    const keyB = new URL(genuiIngestUrl(s.port, 'chat-b')).searchParams.get('key');
    assert.notEqual(keyA, keyB, 'each chat gets its own key');
    assert.equal((await post(`${s.base}/api/genui/ingest?session=chat-b&key=${keyA}`, { surface: 's', ops: [OP_CARD] })).status, 403, "chat A's key is refused for chat B");
    assert.equal((await post(`${s.base}/api/genui/ingest?session=chat-b&key=${keyA}`, { session: 'chat-a', surface: 's', ops: [OP_CARD] })).status, 403);
    assert.equal((await post(`${s.base}/api/genui/ingest?session=chat-b&key=${keyB}`, { session: 'chat-a', surface: 's', ops: [OP_CARD] })).status, 200);
    await b.waitFor(1);
    assert.equal(b.frames.length, 1, 'a body session cannot redirect a frame to another chat');
    b.close();
  } finally {
    await s.close();
  }
});

/* ── the hub's replay: bounded, never a tail without a base, resumable by Last-Event-ID ── */
function fakeStream(): { res: http.ServerResponse; chunks: string[]; frames: () => { id: number | null; frame: Record<string, unknown> }[] } {
  const chunks: string[] = [];
  const res = { writableEnded: false, destroyed: false, write: (c: string) => (chunks.push(c), true) } as unknown as http.ServerResponse;
  const frames = () =>
    chunks
      .filter((c) => c.includes('data: '))
      .map((c) => ({ id: /^id: (\d+)/m.exec(c) ? Number(/^id: (\d+)/m.exec(c)![1]) : null, frame: JSON.parse(c.slice(c.indexOf('data: ') + 6)) as Record<string, unknown> }));
  return { res, chunks, frames };
}
const setOp = (i: number) => ({ op: 'set', path: `/elements/e${i}`, value: { type: 'text', props: {} } }) as never;

test('review: invented session ids are bounded and an idle chat expires', () => {
  let t = 1_000;
  const hub = new GenuiHub({ maxSessions: 8, idleMs: 60_000, now: () => t });
  for (let i = 0; i < 100; i++) say(hub, `invented-${i}`, { kind: 'ui.ops', surfaceId: 's', ops: [OP_CARD as never] });
  assert.ok(hub.sessionCount() <= 8, `kept ${hub.sessionCount()} sessions`);
  /* a chat someone is watching is never expired */
  const w = fakeStream();
  const detach = hub.attach('watched', w.res);
  say(hub, 'watched', { kind: 'ui.ops', surfaceId: 's', ops: [OP_CARD as never] });
  t += 10 * 60_000;
  say(hub, 'other', { kind: 'ui.ops', surfaceId: 's', ops: [OP_CARD as never] });
  assert.equal(hub.sessionCount(), 2, 'idle chats expired; the watched one and the new one remain');
  const late = fakeStream();
  hub.attach('watched', late.res);
  assert.equal(late.frames().length, 1, 'the watched chat kept its replay');
  detach();
});

test('review: a surface past the backlog gets a reset for a late client, never a tail with no base', () => {
  const hub = new GenuiHub();
  const early = fakeStream();
  hub.attach('c', early.res);
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: Array.from({ length: 1990 }, (_, i) => setOp(i)) });
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: Array.from({ length: 20 }, (_, i) => setOp(2000 + i)) }); /* overflow */
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [setOp(9999)] });
  const late = fakeStream();
  hub.attach('c', late.res);
  const lateKinds = late.frames().map((f) => f.frame.kind);
  assert.deepEqual(lateKinds, ['ui.reset'], 'told the replay is unavailable, given no ops');
  assert.equal(late.frames()[0]!.frame.surfaceId, 's');
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [setOp(10000)] });
  assert.equal(late.frames().length, 1, 'a late client is sent no further tail of a surface it has no base for');
  assert.equal(early.frames().length, 4, 'a client that was there from the start still follows live');
  say(hub, 'c', { kind: 'ui.end', surfaceId: 's' });
  assert.equal(late.frames().length, 1);
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [OP_CARD as never] });
  assert.equal(late.frames().length, 2, 'the next pass of the surface is delivered again');
});

test('review: events carry ids and a reconnect with Last-Event-ID gets only what it missed', () => {
  const hub = new GenuiHub();
  const first = fakeStream();
  const detach = hub.attach('c', first.res);
  const append = (n: number) => ({ op: 'append', path: '/elements/log/children', value: `line-${n}` }) as never;
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [append(1)] });
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [append(2)] });
  const seen = first.frames();
  assert.deepEqual(seen.map((f) => f.id), [1, 2], 'every event has an id');
  detach();
  say(hub, 'c', { kind: 'ui.ops', surfaceId: 's', ops: [append(3)] });
  const again = fakeStream();
  hub.attach('c', again.res, seen[seen.length - 1]!.id);
  const replayed = again.frames();
  assert.equal(replayed.length, 1);
  assert.deepEqual(replayed[0]!.frame.ops, [append(3)], 'only the missed append; line-1 and line-2 are not applied twice');
  assert.equal(replayed[0]!.id, 3);
  const fresh = fakeStream();
  hub.attach('c', fresh.res);
  assert.equal((fresh.frames()[0]!.frame.ops as unknown[]).length, 3, 'a new client still gets the whole unfinished surface');
  const ahead = fakeStream();
  hub.attach('c', ahead.res, 999);
  assert.equal((ahead.frames()[0]!.frame.ops as unknown[]).length, 3, 'an id from another run is treated as a new client');
});

test('review: the events route honours the Last-Event-ID header', async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-genui-')));
  const s = await start(repo);
  try {
    const url = genuiIngestUrl(s.port, 'chat-r');
    assert.equal((await post(url, { surface: 's', ops: [OP_CARD] })).status, 200);
    assert.equal((await post(url, { surface: 's', ops: [OP_TEXT] })).status, 200);
    const got: string[] = [];
    await new Promise<void>((ok, bad) => {
      const req = http.get(`${s.base}/api/genui/events?session=chat-r`, { headers: { 'Last-Event-ID': '1' } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          got.push(c);
          if (got.join('').includes('\n\n')) {
            req.destroy();
            ok();
          }
        });
      });
      req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? ok() : bad(e)));
      setTimeout(() => bad(new Error('no replay')), 3000).unref();
    });
    const body = got.join('');
    assert.match(body, /^id: 2\n/m);
    assert.ok(body.includes('"Running tests"') && !body.includes('Upgrade auth'), 'only the second batch is replayed');
  } finally {
    await s.close();
  }
});

test('review: an agent session launched for a chat gets SEQUENCE_CHAT, so boards it creates land in that chat', () => {
  const withChat = sequenceMcpServer('/tmp/repo', { entry: '/x/server.js', chat: 'chat-9' });
  assert.equal(withChat?.env?.SEQUENCE_CHAT, 'chat-9');
  const withBoth = sequenceMcpServer('/tmp/repo', { entry: '/x/server.js', chat: 'chat-9', drawings: { root: '/tmp/repo', chat: 'chat-9' } });
  assert.equal(withBoth?.env?.SEQUENCE_CHAT, 'chat-9');
  assert.equal(sequenceMcpServer('/tmp/repo', { entry: '/x/server.js' })?.env?.SEQUENCE_CHAT, undefined);
});
