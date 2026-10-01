import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { addAgent } from '../server/agentsStore.js';
import { loadAuthConfig } from '../server/auth.js';

/**
 * Lock for the LOCAL-ONLY ACP endpoints (v16 Wave 2a). The three endpoints are the
 * security twin of the terminal WS: a real agent subprocess with filesystem writes,
 * so they MUST refuse a non-local caller (the SAME DNS-rebinding / cross-origin gate
 * the terminal upgrade uses). Verifies: a non-local request (non-loopback Host) to
 * each of the three → 403; a local request lists the configured agents; and
 * run-node against the conformant mock ACP agent returns a REAL {stopReason, text}.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const MOCK_AGENT = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'mock-agent.mjs');

function tempStoreDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-acp-ep-')));
}

interface Server {
  port: number;
  close: () => Promise<void>;
}

interface StartOpts {
  /** Enable hosted (multi-user) auth mode — the ACP bridge must then disable. */
  hosted?: boolean;
  /** An initial attached repo root (so cwd-containment has a root to pin to). */
  repoRoot?: string | null;
}

const HOSTED_AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-abc',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

async function startServer(userConfigDir: string, sopts: StartOpts = {}): Promise<Server> {
  const server = await createRepoServer(sopts.repoRoot ?? null, {
    webDist: undefined,
    userConfigDir,
    ...(sopts.hosted ? { authConfig: loadAuthConfig(HOSTED_AUTH_ENV) } : {}),
  });
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

/** A raw request so we can set an arbitrary Host header (impossible via fetch). */
function request(
  port: number,
  method: string,
  pathName: string,
  opts: { host?: string; body?: unknown } = {}
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathName,
        headers: {
          host: opts.host ?? `127.0.0.1:${port}`,
          ...(payload !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
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

const NONLOCAL = 'evil.example';

test('a NON-LOCAL request (non-loopback Host) to each of the three endpoints → 403', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const srv = await startServer(dir);
  try {
    const avail = await request(srv.port, 'GET', '/api/acp/available', { host: NONLOCAL });
    assert.strictEqual(avail.status, 403, '/available refuses a non-local prober');

    const agents = await request(srv.port, 'GET', '/api/acp/agents', { host: NONLOCAL });
    assert.strictEqual(agents.status, 403);

    const run = await request(srv.port, 'POST', '/api/acp/run-node', {
      host: NONLOCAL,
      body: { agentRef: 'mock', prompt: 'hi' },
    });
    assert.strictEqual(run.status, 403);
    // The refusal is honest JSON with a reason.
    assert.match((run.json as { error?: string }).error ?? '', /local-only/i);
  } finally {
    await srv.close();
  }
});

test('a LOCAL request: /available is 200 available:true; /agents returns the configured list', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT], label: 'Mock' });
  const srv = await startServer(dir);
  try {
    const avail = await request(srv.port, 'GET', '/api/acp/available');
    assert.strictEqual(avail.status, 200);
    assert.deepStrictEqual(avail.json, { available: true });

    const agents = await request(srv.port, 'GET', '/api/acp/agents');
    assert.strictEqual(agents.status, 200);
    const list = (agents.json as { agents: Array<{ id: string; command: string; label?: string }> }).agents;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'mock');
    assert.strictEqual(list[0].command, process.execPath);
    assert.strictEqual(list[0].label, 'Mock');
  } finally {
    await srv.close();
  }
});

test('/api/acp/run-node against the mock agent returns a real {stopReason, text}', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const srv = await startServer(dir);
  try {
    const run = await request(srv.port, 'POST', '/api/acp/run-node', {
      body: { agentRef: 'mock', prompt: 'ping' },
    });
    assert.strictEqual(run.status, 200);
    const body = run.json as { stopReason: string; text: string };
    assert.strictEqual(body.stopReason, 'end_turn');
    assert.match(body.text, /echo:/);
    assert.match(body.text, /ping/);
  } finally {
    await srv.close();
  }
});

test('/api/acp/run-node with an unknown agentRef → 400 (honest)', async () => {
  const dir = tempStoreDir();
  const srv = await startServer(dir);
  try {
    const run = await request(srv.port, 'POST', '/api/acp/run-node', {
      body: { agentRef: 'nope', prompt: 'ping' },
    });
    assert.strictEqual(run.status, 400);
    assert.match((run.json as { error: string }).error, /unknown agentRef/);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// v16 Finding 5 — HOSTED disables the ACP bridge (no hosted free-tier agent spawn).
// In hosted (authOn) mode the two AGENT-SPAWNING endpoints (/agents, /run-node)
// hard-refuse 403, and the capability probe (/available) honestly reports
// available:false so the web UI feature-detects and hides the path. This is the
// load-bearing "no hosted agent runner" invariant.
// ---------------------------------------------------------------------------
test('HOSTED mode: /agents and /run-node refuse (403); /available reports available:false', async () => {
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const srv = await startServer(dir, { hosted: true });
  try {
    const agents = await request(srv.port, 'GET', '/api/acp/agents');
    assert.strictEqual(agents.status, 403, '/agents refuses in hosted mode');
    assert.match((agents.json as { error?: string }).error ?? '', /hosted|local-only/i);

    const run = await request(srv.port, 'POST', '/api/acp/run-node', {
      body: { agentRef: 'mock', prompt: 'hi' },
    });
    assert.strictEqual(run.status, 403, '/run-node refuses in hosted mode (no hosted spawn)');
    assert.match((run.json as { error?: string }).error ?? '', /hosted|local-only/i);

    // The probe stays 200 but honestly disabled — the web hides ACP off this.
    const avail = await request(srv.port, 'GET', '/api/acp/available');
    assert.strictEqual(avail.status, 200);
    assert.strictEqual((avail.json as { available: boolean }).available, false, 'ACP disabled in hosted');
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// v16 Finding 4 — run-node CONTAINS the agent cwd to the attached repo root
// (getRoot()), like the terminal. An absolute/`..`-escaping body.cwd is ignored
// and the turn runs at the root — a write-capable agent can never be pointed
// outside the repo by the request body.
// ---------------------------------------------------------------------------
test('run-node contains an escaping cwd to the repo root (does NOT honor `/etc` or `..`)', async () => {
  const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
  const repoRoot = fs.realpathSync(TICKETING);
  const dir = tempStoreDir();
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const srv = await startServer(dir, { repoRoot: TICKETING });
  try {
    // An absolute escaping cwd is dropped → the turn runs pinned to the repo root.
    const abs = await request(srv.port, 'POST', '/api/acp/run-node', {
      body: { agentRef: 'mock', prompt: 'report CWD please', cwd: '/etc' },
    });
    assert.strictEqual(abs.status, 200);
    const absText = (abs.json as { text: string }).text;
    assert.match(absText, new RegExp(`cwd=${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^/])`), `escaping abs cwd pinned to root, got: ${absText}`);
    assert.ok(!absText.includes('cwd=/etc'), `must NOT run in /etc, got: ${absText}`);

    // A `..`-escaping cwd is likewise contained to the root.
    const esc = await request(srv.port, 'POST', '/api/acp/run-node', {
      body: { agentRef: 'mock', prompt: 'report CWD please', cwd: '../../../../etc' },
    });
    assert.strictEqual(esc.status, 200);
    const escText = (esc.json as { text: string }).text;
    assert.ok(escText.includes(`cwd=${repoRoot}`), `.. escape contained to root, got: ${escText}`);
    assert.ok(!escText.includes('cwd=/etc'), `.. escape must not reach /etc, got: ${escText}`);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// v16 Finding 1 — a run-node client DISCONNECT force-kills the agent subprocess
// (no orphan, no continued real cost), even against an agent that IGNORES cancel
// and never ends the turn. dispose() is called DIRECTLY on `req 'close'` (not
// deferred behind a hung prompt), escalating SIGTERM→SIGKILL.
// ---------------------------------------------------------------------------
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

test('run-node: a client disconnect force-kills the hung agent subprocess (no orphan, bounded)', async () => {
  const dir = tempStoreDir();
  const pidFile = path.join(dir, 'agent.pid');
  addAgent(dir, { id: 'mock', command: process.execPath, args: [MOCK_AGENT] });
  const srv = await startServer(dir);
  // The spawned child inherits process.env: make it write its PID and TRAP SIGTERM
  // so it only dies on the SIGKILL escalation — proving death regardless of the agent.
  process.env.MOCK_AGENT_PID_FILE = pidFile;
  process.env.MOCK_AGENT_TRAP_SIGTERM = '1';
  let pid = 0;
  try {
    // Fire a run whose turn HANGs forever and ignores cancel; do NOT read the response.
    const payload = JSON.stringify({ agentRef: 'mock', prompt: 'please HANG forever' });
    const req = http.request({
      host: '127.0.0.1',
      port: srv.port,
      method: 'POST',
      path: '/api/acp/run-node',
      headers: {
        host: `127.0.0.1:${srv.port}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    });
    req.on('error', () => {}); // the abort surfaces as a socket error — expected
    req.write(payload);
    req.end();

    // Wait for the child to spawn + record its PID.
    const gotPid = await waitFor(() => fs.existsSync(pidFile), 5000);
    assert.ok(gotPid, 'the agent subprocess spawned and recorded its PID');
    pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(pid > 0 && pidAlive(pid), 'the agent subprocess is alive before disconnect');

    // DISCONNECT — destroy the client socket → server `req 'close'` → force dispose.
    req.destroy();

    /*
     * The child must die within a bounded window (SIGTERM trapped → SIGKILL
     * after grace). The bound is DERIVED, not chosen: `AcpClient`'s grace before
     * SIGTERM escalates to SIGKILL is 2000ms (packages/acp/src/client.ts), so
     * this is 10x it.
     *
     * It was 8000ms — 4x — which passes on an idle machine and fails inside a
     * full gate, where the same run is also building with Vite and driving a
     * real Chromium. Measured: this file passes 3 of 3 standalone and failed in
     * `pnpm -r test`. What is under test is "no orphan", and an orphan is not
     * less orphaned at 9 seconds; the tight bound was measuring the machine's
     * load, not the product's behaviour.
     */
    const dead = await waitFor(() => !pidAlive(pid), 20_000);
    assert.ok(dead, 'the agent subprocess was killed after the disconnect (no orphan)');
  } finally {
    delete process.env.MOCK_AGENT_PID_FILE;
    delete process.env.MOCK_AGENT_TRAP_SIGTERM;
    if (pid > 0 && pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    await srv.close();
  }
});
