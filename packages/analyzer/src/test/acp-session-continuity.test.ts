import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AcpAgentClient, AcpPromptOptions, AcpPromptResult } from '@sequence/acp';
import { createRepoServer } from '../server/repoServer.js';
import { createAcpSessionCache } from '../server/acpSessionCache.js';
import { addAgent } from '../server/agentsStore.js';

/**
 * r31 — the SERVER half of ACP session continuity. Two layers:
 *
 *  (A) HTTP integration against the conformant mock ACP agent, with a per-spawn
 *      COUNTING wrapper so we can prove ONE subprocess is spawned for a reused
 *      sessionKey and TWO for distinct keys / no key. The mock streams its own
 *      `sid=<sessionId>` back per turn, so a reused key shows the SAME sessionId
 *      across two turns (one newSession, reused). Locks the wiring end-to-end.
 *
 *  (B) Unit tests driving `createAcpSessionCache` directly with a FAKE
 *      AcpAgentClient (the executor's test-double pattern), so the disposal /
 *      serialization / TTL / cap paths are deterministic with no subprocess.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

function tempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-acp-cont-')));
}

// A spawn-counting wrapper: on every spawn it appends one byte to the count file,
// then hands stdio to the real mock agent (dynamic import). Counting real spawns is
// how we prove REUSE (1 spawn for a shared key) vs FRESH (a spawn per call).
function writeCountingWrapper(dir: string): string {
  const p = path.join(dir, 'counting-agent.mjs');
  fs.writeFileSync(
    p,
    [
      "import { appendFileSync } from 'node:fs';",
      'try { appendFileSync(process.env.ACP_SPAWN_COUNT_FILE, "x"); } catch {}',
      'await import(process.env.ACP_MOCK_AGENT_URL);',
      '',
    ].join('\n')
  );
  return p;
}

function spawnCount(countFile: string): number {
  try {
    return fs.readFileSync(countFile, 'utf8').length;
  } catch {
    return 0;
  }
}

interface Server {
  port: number;
  close: () => Promise<void>;
}

async function startServer(userConfigDir: string): Promise<Server> {
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

interface Res {
  status: number;
  json: unknown;
}

function request(port: number, method: string, pathName: string, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathName,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Register the counting-wrapper mock agent and point its env at THIS test's files. */
function setupAgent(dir: string): string {
  const wrapper = writeCountingWrapper(dir);
  addAgent(dir, { id: 'mock', command: process.execPath, args: [wrapper] });
  const countFile = path.join(dir, 'spawns.log');
  process.env.ACP_SPAWN_COUNT_FILE = countFile;
  process.env.ACP_MOCK_AGENT_URL = pathToFileURL(MOCK_AGENT).href;
  return countFile;
}
function teardownAgentEnv(): void {
  delete process.env.ACP_SPAWN_COUNT_FILE;
  delete process.env.ACP_MOCK_AGENT_URL;
}

const sidOf = (text: string): string | undefined => text.match(/sid=([^;]+);/)?.[1];

// ===========================================================================
// (A) HTTP integration — real subprocess, spawn-counted.
// ===========================================================================

test('run-node: SAME sessionKey twice → ONE spawn, two prompts on the SAME session', async () => {
  const dir = tempDir();
  const countFile = setupAgent(dir);
  const srv = await startServer(dir);
  try {
    const r1 = await request(srv.port, 'POST', '/api/acp/run-node', {
      agentRef: 'mock',
      prompt: 'ping',
      sessionKey: 'run-1::mock',
    });
    const r2 = await request(srv.port, 'POST', '/api/acp/run-node', {
      agentRef: 'mock',
      prompt: 'pong',
      sessionKey: 'run-1::mock',
    });
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    const t1 = (r1.json as { text: string }).text;
    const t2 = (r2.json as { text: string }).text;
    assert.match(t1, /ping/);
    assert.match(t2, /pong/);
    // Reused: exactly ONE subprocess spawned for both turns...
    assert.strictEqual(spawnCount(countFile), 1, 'one spawn for a reused sessionKey');
    // ...and both turns ran on the SAME session id (no second newSession).
    const s1 = sidOf(t1);
    const s2 = sidOf(t2);
    assert.ok(s1 && s2, 'each turn reveals its session id');
    assert.strictEqual(s1, s2, 'both turns reused the same session id');
  } finally {
    await srv.close();
    teardownAgentEnv();
  }
});

test('run-node: DIFFERENT sessionKeys → two spawns (two sessions)', async () => {
  const dir = tempDir();
  const countFile = setupAgent(dir);
  const srv = await startServer(dir);
  try {
    const a = await request(srv.port, 'POST', '/api/acp/run-node', {
      agentRef: 'mock',
      prompt: 'ping',
      sessionKey: 'run-A::mock',
    });
    const b = await request(srv.port, 'POST', '/api/acp/run-node', {
      agentRef: 'mock',
      prompt: 'ping',
      sessionKey: 'run-B::mock',
    });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    assert.strictEqual(spawnCount(countFile), 2, 'a distinct key spawns its own session');
  } finally {
    await srv.close();
    teardownAgentEnv();
  }
});

test('run-node: NO sessionKey → a FRESH session per call (existing behavior locked)', async () => {
  const dir = tempDir();
  const countFile = setupAgent(dir);
  const srv = await startServer(dir);
  try {
    const r1 = await request(srv.port, 'POST', '/api/acp/run-node', { agentRef: 'mock', prompt: 'ping' });
    const r2 = await request(srv.port, 'POST', '/api/acp/run-node', { agentRef: 'mock', prompt: 'ping' });
    assert.strictEqual(r1.status, 200);
    assert.strictEqual(r2.status, 200);
    assert.match((r1.json as { text: string }).text, /echo:/);
    // Fresh-per-call: each request spawned (and disposed) its own subprocess.
    assert.strictEqual(spawnCount(countFile), 2, 'no sessionKey ⇒ a spawn per call');
  } finally {
    await srv.close();
    teardownAgentEnv();
  }
});

test('run-node: an EMPTY sessionKey is treated as absent (fresh per call)', async () => {
  const dir = tempDir();
  const countFile = setupAgent(dir);
  const srv = await startServer(dir);
  try {
    await request(srv.port, 'POST', '/api/acp/run-node', { agentRef: 'mock', prompt: 'ping', sessionKey: '' });
    await request(srv.port, 'POST', '/api/acp/run-node', { agentRef: 'mock', prompt: 'ping', sessionKey: '' });
    assert.strictEqual(spawnCount(countFile), 2, 'empty sessionKey ⇒ fresh per call');
  } finally {
    await srv.close();
    teardownAgentEnv();
  }
});

// ===========================================================================
// (B) Cache unit tests — deterministic fake client (no subprocess).
// ===========================================================================

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A fake AcpAgentClient counterparty: full control over prompt / dispose. */
class FakeClient implements AcpAgentClient {
  disposed = false;
  startCalls = 0;
  newSessionCalls = 0;
  promptCalls = 0;
  constructor(
    readonly id: number,
    private readonly promptImpl?: () => Promise<AcpPromptResult>
  ) {}
  async start(): Promise<void> {
    this.startCalls++;
  }
  async newSession(): Promise<string> {
    this.newSessionCalls++;
    return `sess-${this.id}`;
  }
  async prompt(_text: string, _opts?: AcpPromptOptions): Promise<AcpPromptResult> {
    this.promptCalls++;
    return this.promptImpl ? this.promptImpl() : { stopReason: 'end_turn', text: `t${this.id}` };
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

/** A factory that builds+starts+opens a fresh fake session and records every client. */
function fakeFactory(clients: FakeClient[], promptImpl?: () => Promise<AcpPromptResult>) {
  return async () => {
    const c = new FakeClient(clients.length + 1, promptImpl);
    clients.push(c);
    await c.start();
    const sessionId = await c.newSession();
    return { client: c, sessionId };
  };
}

test('cache: same key reuses ONE client + session across turns', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  await cache.run('K', create, (c) => c.prompt('a'));
  await cache.run('K', create, (c) => c.prompt('b'));
  assert.strictEqual(clients.length, 1, 'created once');
  assert.strictEqual(clients[0].newSessionCalls, 1, 'one newSession');
  assert.strictEqual(clients[0].promptCalls, 2, 'two turns on the one session');
  assert.strictEqual(clients[0].disposed, false);
  assert.strictEqual(cache.size(), 1);
  await cache.disposeAll();
});

test('cache: different keys create independent sessions', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  await cache.run('K1', create, (c) => c.prompt('a'));
  await cache.run('K2', create, (c) => c.prompt('b'));
  assert.strictEqual(clients.length, 2);
  assert.strictEqual(cache.size(), 2);
  await cache.disposeAll();
});

test('cache: a turn that throws disposes the entry; the next call re-creates', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  await assert.rejects(
    cache.run('K', create, () => Promise.reject(new Error('agent died'))),
    /agent died/
  );
  assert.strictEqual(clients[0].disposed, true, 'the broken session was disposed');
  assert.strictEqual(cache.size(), 0, 'no dead entry left cached');
  // Next call with the SAME key transparently spawns a fresh session.
  const r = await cache.run('K', create, (c) => c.prompt('a'));
  assert.strictEqual(clients.length, 2, 're-created after disposal');
  assert.strictEqual((r as AcpPromptResult).stopReason, 'end_turn');
  await cache.disposeAll();
});

test('cache: disposeOnError=false (a client DISCONNECT) keeps the shared session', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  await assert.rejects(
    cache.run('K', create, () => Promise.reject(new Error('aborted')), { disposeOnError: () => false }),
    /aborted/
  );
  assert.strictEqual(clients[0].disposed, false, 'a disconnect must not tear down the shared session');
  assert.strictEqual(cache.size(), 1);
  // The still-live session is reused by the next request — no new spawn.
  await cache.run('K', create, (c) => c.prompt('a'));
  assert.strictEqual(clients.length, 1, 'reused, not re-created');
  await cache.disposeAll();
});

test('cache: two concurrent runs on one key SERIALIZE (second waits for the first)', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  const order: string[] = [];
  let releaseA!: () => void;

  const pA = cache.run('K', create, async () => {
    order.push('A:start');
    await new Promise<void>((r) => {
      releaseA = r;
    });
    order.push('A:end');
    return { stopReason: 'end_turn', text: '' } as AcpPromptResult;
  });
  // Let A acquire the lock and begin its turn.
  await delay(20);
  const pB = cache.run('K', create, async () => {
    order.push('B:start');
    return { stopReason: 'end_turn', text: '' } as AcpPromptResult;
  });
  await delay(20);
  // B is queued behind A — it must NOT have started while A is still in flight.
  assert.deepStrictEqual(order, ['A:start'], 'B is blocked until A finishes');
  releaseA();
  await Promise.all([pA, pB]);
  assert.deepStrictEqual(order, ['A:start', 'A:end', 'B:start'], 'turns ran strictly in order');
  assert.strictEqual(clients.length, 1, 'both turns shared ONE session');
  await cache.disposeAll();
});

test('cache: exceeding the cap LRU-evicts + disposes the oldest session', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache({ maxSessions: 2 });
  const create = fakeFactory(clients);
  await cache.run('K1', create, (c) => c.prompt('a')); // clients[0]
  await cache.run('K2', create, (c) => c.prompt('b')); // clients[1]
  // Touch K1 so K2 becomes the least-recently-used.
  await cache.run('K1', create, (c) => c.prompt('c'));
  await cache.run('K3', create, (c) => c.prompt('d')); // over cap → evict LRU (K2)
  assert.strictEqual(cache.size(), 2, 'held to the cap');
  assert.strictEqual(clients[1].disposed, true, 'the LRU (K2) was evicted + disposed');
  assert.strictEqual(clients[0].disposed, false, 'the touched K1 survived');
  assert.strictEqual(clients[2].disposed, false, 'the new K3 is live');
  await cache.disposeAll();
});

test('cache: an idle session is reaped after the TTL, then re-created on next use', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache({ ttlMs: 40 });
  const create = fakeFactory(clients);
  await cache.run('K', create, (c) => c.prompt('a'));
  assert.strictEqual(cache.size(), 1);
  await delay(140);
  assert.strictEqual(cache.size(), 0, 'the idle session was reaped');
  assert.strictEqual(clients[0].disposed, true, 'the reaped client was disposed');
  await cache.run('K', create, (c) => c.prompt('b'));
  assert.strictEqual(clients.length, 2, 're-created after the TTL reap');
  await cache.disposeAll();
});

test('cache: disposeAll tears down every live session', async () => {
  const clients: FakeClient[] = [];
  const cache = createAcpSessionCache();
  const create = fakeFactory(clients);
  await cache.run('K1', create, (c) => c.prompt('a'));
  await cache.run('K2', create, (c) => c.prompt('b'));
  assert.strictEqual(cache.size(), 2);
  await cache.disposeAll();
  assert.strictEqual(cache.size(), 0);
  assert.ok(clients.every((c) => c.disposed), 'all clients disposed on shutdown');
});
