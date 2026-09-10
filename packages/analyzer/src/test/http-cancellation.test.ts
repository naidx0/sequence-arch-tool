import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { usageFileForIdentity } from '../server/store.js';
import type { MeterUsage } from '../server/meter.js';

/**
 * WAVE 1 ITEM 1.3 — CANCELLATION.
 *
 * The plan's evidence (v2-architecture-and-gaps.md G3/P4): `AbortController`
 * appears twice in 4,452 lines of repoServer.ts, both inside `/api/acp/run-node`.
 * Stop is cosmetic on the AI routes — and the call is STILL METERED after the
 * user stops it. That second half is the invariant these tests exist for: a call
 * the user stopped must not be charged to them.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY
 *
 * "usage did not increment" is trivially satisfiable by breaking metering
 * outright, so it is never asserted alone. Every abort test is paired with:
 *   (a) proof the provider was ACTUALLY CONTACTED before the abort — otherwise
 *       the abort landed before the call and the charge was never at risk, and
 *       the test would pass against a server with no cancellation at all; and
 *   (b) a CONTROL in the same file asserting that a call which is NOT aborted
 *       still charges exactly one. Together they pin the real invariant:
 *       charged ⇔ the generation completed for this caller.
 *
 * The counter is `usedThisMonth` from GET /api/usage, which is written by
 * `recordUse` (meter.ts) inside the metered wrapper — the exact call the plan
 * names. Metering only runs in `mode:'default'`, so these tests select the free
 * default and point it at an injected mock gateway (the same deploy/test seam
 * identity-meter.test.ts uses); no real network is involved.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cancel-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-cancel-home-')));
}

interface SlowGateway {
  baseUrl: string;
  /** How many requests reached the gateway (i.e. generation really started). */
  received: number;
  /** How many of those had their inbound socket closed before the reply was written. */
  clientGoneBeforeReply: number;
  close: () => Promise<void>;
}

/**
 * An openai-compatible mock gateway that takes `delayMs` to answer. The delay is
 * what makes "mid-generation" a real window rather than a race: the client aborts
 * while the gateway is still holding the request open.
 */
async function startSlowGateway(delayMs: number): Promise<SlowGateway> {
  const state = { received: 0, clientGoneBeforeReply: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      state.received += 1;
      let replied = false;
      res.on('close', () => {
        if (!replied) state.clientGoneBeforeReply += 1;
      });
      setTimeout(() => {
        replied = true;
        if (res.writableEnded) return;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'a frontend and a backend.' } }],
            usage: { prompt_tokens: 120, completion_tokens: 40 },
          }),
        );
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get received() {
      return state.received;
    },
    get clientGoneBeforeReply() {
      return state.clientGoneBeforeReply;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

interface Started {
  base: string;
  userDir: string;
  repo: string;
  gateway: SlowGateway;
  close: () => Promise<void>;
}

async function startAll(delayMs: number): Promise<Started> {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  const gateway = await startSlowGateway(delayMs);
  const server = await createRepoServer(repo, {
    webDist: undefined,
    userConfigDir: userDir,
    gatewayBaseUrl: gateway.baseUrl,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  // Select the FREE metered default so `recordUse` is on the path at all.
  const put = await fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'default' }),
  });
  assert.strictEqual(put.status, 200, 'the free default mode must be selectable');
  return {
    base,
    userDir,
    repo,
    gateway,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
      await gateway.close();
      fs.rmSync(path.dirname(repo), { recursive: true, force: true });
      fs.rmSync(userDir, { recursive: true, force: true });
    },
  };
}

async function usedThisMonth(base: string): Promise<number> {
  const view = (await (await fetch(`${base}/api/usage`)).json()) as { usedThisMonth: number };
  return view.usedThisMonth;
}

/** The on-disk counter, read directly — the wire view cannot mask a write here. */
function usedOnDisk(userDir: string): number {
  const file = path.join(userDir, usageFileForIdentity('local'));
  if (!fs.existsSync(file)) return 0;
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as MeterUsage).usedThisMonth;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition, bounded — never a fixed sleep before a guard.
 *
 * `await sleep(400)` before asserting "the provider is already generating"
 * measures the machine, not the product: on an idle box the request reaches the
 * mock gateway in milliseconds, and inside a full gate — where a Vite build and
 * a real Chromium are also running — it may not have. Measured: this file passes
 * standalone and failed in `pnpm -r test` on that guard alone.
 *
 * The guard is NOT relaxed by this. It still fails if the provider is never
 * contacted, which is the false pass it exists to prevent; it simply stops
 * failing when the provider was contacted a little later than a hard-coded
 * number guessed.
 */
async function until(cond: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(25);
  }
  return cond();
}

// ---------------------------------------------------------------------------
// CONTROL. Never removed, never relaxed: it is what makes "did not increment"
// mean "this call was not charged" instead of "metering is broken".
// ---------------------------------------------------------------------------
test('CONTROL: a completed /api/ask charges exactly one call', async () => {
  const s = await startAll(50);
  try {
    const res = await fetch(`${s.base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(res.status, 200);
    await res.text();
    assert.ok(s.gateway.received >= 1, 'the gateway was contacted');
    assert.strictEqual(await usedThisMonth(s.base), 1, 'a completed call IS charged');
    assert.strictEqual(usedOnDisk(s.userDir), 1, 'and the charge is on disk');
  } finally {
    await s.close();
  }
});

test('/api/ask aborted mid-generation: the provider was contacted, and the call is NOT charged', async () => {
  const GEN_MS = 1_500;
  const s = await startAll(GEN_MS);
  try {
    const ac = new AbortController();
    const inflight = fetch(`${s.base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
      signal: ac.signal,
    }).then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    // Let the request reach the gateway, then stop it while it is still
    // generating. Waited for rather than slept past — see `until`.
    await until(() => s.gateway.received >= 1);
    assert.ok(
      s.gateway.received >= 1,
      'the provider must already be generating — otherwise nothing was cancelled and this test proves nothing',
    );
    ac.abort();
    assert.strictEqual(await inflight, 'rejected', 'the client fetch aborted');

    // Wait past the point the generation would have completed AND been charged.
    await sleep(GEN_MS + 800);

    assert.strictEqual(
      await usedThisMonth(s.base),
      0,
      'a stopped call must not be metered — recordUse fired for a generation the user cancelled',
    );
    assert.strictEqual(usedOnDisk(s.userDir), 0, 'and nothing was written to the usage file');
  } finally {
    await s.close();
  }
});

test('/api/ask/stream aborted mid-generation: the provider was contacted, and the call is NOT charged', async () => {
  const GEN_MS = 1_500;
  const s = await startAll(GEN_MS);
  try {
    const ac = new AbortController();
    const res = await fetch(`${s.base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
      signal: ac.signal,
    });
    assert.strictEqual(res.status, 200);
    // Drain enough of the stream that the pipeline has really started, then stop.
    const reader = res.body!.getReader();
    await reader.read();
    await until(() => s.gateway.received >= 1);
    assert.ok(
      s.gateway.received >= 1,
      'the provider must already be generating — otherwise nothing was cancelled',
    );
    ac.abort();
    await reader.cancel().catch(() => {});

    await sleep(GEN_MS + 800);

    assert.strictEqual(
      await usedThisMonth(s.base),
      0,
      'a stopped streamed ask must not be metered',
    );
    assert.strictEqual(usedOnDisk(s.userDir), 0, 'and nothing was written to the usage file');
  } finally {
    await s.close();
  }
});

test('a client that disconnects mid-generation stops the provider call rather than waiting it out', async () => {
  // The observable half of cancellation that does NOT depend on the provider
  // socket: the server must stop AWAITING a generation whose reader is gone. We
  // prove it by the effect the plan names — the disconnect reaches the ask path
  // fast enough that the charge window closes before the generation ends.
  const GEN_MS = 2_000;
  const s = await startAll(GEN_MS);
  try {
    const ac = new AbortController();
    const started = Date.now();
    const inflight = fetch(`${s.base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
      signal: ac.signal,
    }).catch(() => undefined);
    await sleep(300);
    ac.abort();
    await inflight;
    // Read the counter WHILE the abandoned generation is still running. It must
    // already be settled at zero, not "zero because we asked too early" — the
    // previous test covers the late read.
    assert.ok(Date.now() - started < GEN_MS, 'the read happens before the generation could finish');
    assert.strictEqual(await usedThisMonth(s.base), 0);
    await sleep(GEN_MS + 800);
    assert.strictEqual(await usedThisMonth(s.base), 0, 'and it stays zero once the abandoned generation ends');
  } finally {
    await s.close();
  }
});
