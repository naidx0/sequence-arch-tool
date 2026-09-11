import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig } from '../server/auth.js';
import { startMockProvider } from './mock-provider.js';

/**
 * TWO WAVE-1 LOCKS ON THE ASK HTTP SURFACE.
 *
 * ---------------------------------------------------------------------------
 * A. ITEM 1.1's WIRING (the computation itself belongs to the coverage lane).
 *
 * `askPipeline` now returns `coverage {edgesSeen, edgesTotal, packagesSeen,
 * packagesMissed}` and `resultPayload` already puts it on the `result` SSE
 * event. repoServer's BUFFERED `/api/ask` handler, however, hand-builds its own
 * response object (`payload.text` / `diagram` / `unsupportedIntents` / `usage` /
 * `source`) and never copies `coverage` across — so the one claim a terminal
 * agent structurally cannot make is computed and then dropped on the JSON route.
 *
 * The assertion is the invariant, not a number: BOTH routes must report the SAME
 * denominator, and that denominator must be the WHOLE scanned graph's edge count
 * read off `/archgraph.json`. Pinning `edgesTotal === 4` would pass on a build
 * that returned a constant.
 *
 * ---------------------------------------------------------------------------
 * B. THE AUTH GATE ON `/api/ask/stream`.
 *
 * `SENSITIVE_EXACT` lists `/api/ask` and nothing matches `/api/ask/stream`:
 * `isSensitivePath` has PREFIX rules for `/api/github`, `/api/sessions`,
 * `/api/trajectory` and `/api/harness`, but none for `/api/ask/`. Under hosted
 * auth the buffered route 401s an anonymous caller while the STREAMING route —
 * the same question, the same provider, the same repo contents in the digest —
 * is answered. The lock asserts the two routes are gated IDENTICALLY, so the
 * pair can never drift apart again by someone adding a third ask route.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-WAVE1-ASK-WIRE';

const HOSTED_AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-wave1',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-askwire-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

interface Started {
  base: string;
  close: () => Promise<void>;
}

async function startServer(repo: string, hosted = false): Promise<Started> {
  const server = await createRepoServer(repo, {
    webDist: undefined,
    ...(hosted ? { authConfig: loadAuthConfig(HOSTED_AUTH_ENV) } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      });
    },
  };
}

interface Coverage {
  edgesSeen: number;
  edgesTotal: number;
  packagesSeen: string[];
  packagesMissed: string[];
}

function sseEvents(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (!clean.startsWith('data: ')) continue;
      out.push(JSON.parse(clean.slice(6)) as Record<string, unknown>);
    }
  }
  return out;
}

// ===========================================================================
// A. coverage on the wire
// ===========================================================================

test('the buffered /api/ask answer carries the same coverage the stream does', async () => {
  const repo = plainappRepo();
  const mock = await startMockProvider(() => ({ text: 'A frontend and a backend.' }));
  const s = await startServer(repo);
  try {
    await fetch(`${s.base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: mock.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
    });

    // The independent denominator: what the scanned graph actually holds.
    const graph = (await (await fetch(`${s.base}/archgraph.json`)).json()) as { edges: unknown[] };
    const edgesInGraph = graph.edges.length;
    assert.ok(edgesInGraph > 0, 'the fixture has edges to be measured against');

    const buffered = await fetch(`${s.base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(buffered.status, 200);
    const body = (await buffered.json()) as { text: string; coverage?: Coverage };
    assert.ok(
      body.coverage,
      'the JSON ask route drops the coverage the pipeline computed — the client cannot render what it never receives',
    );
    assert.strictEqual(
      body.coverage!.edgesTotal,
      edgesInGraph,
      'coverage is counted against the whole scanned graph',
    );
    assert.ok(Array.isArray(body.coverage!.packagesSeen));
    assert.ok(Array.isArray(body.coverage!.packagesMissed));

    const streamed = await fetch(`${s.base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    const events = sseEvents(await streamed.text());
    const result = events.find((e) => e.type === 'result') as { coverage?: Coverage } | undefined;
    assert.ok(result?.coverage, 'the result SSE event carries coverage');
    assert.deepStrictEqual(
      body.coverage,
      result!.coverage,
      'the two routes must not disagree about what the answer was able to see',
    );
  } finally {
    await s.close();
    await mock.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

// ===========================================================================
// B. the auth gate
// ===========================================================================

test('under hosted auth, /api/ask/stream is gated exactly as /api/ask is', async () => {
  const repo = plainappRepo();
  const s = await startServer(repo, true);
  try {
    const askBody = JSON.stringify({ question: 'What does this app do?' });
    const buffered = await fetch(`${s.base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: askBody,
    });
    const streamed = await fetch(`${s.base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: askBody,
    });
    await buffered.text();
    await streamed.text();

    assert.strictEqual(buffered.status, 401, 'the buffered ask already refuses an anonymous caller');
    assert.strictEqual(
      streamed.status,
      buffered.status,
      'the streaming twin of a sensitive route must not be reachable anonymously',
    );
  } finally {
    await s.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('the ask auth gate covers any /api/ask/* subpath, not just the one that exists today', async () => {
  const repo = plainappRepo();
  const s = await startServer(repo, true);
  try {
    // A future third ask route must inherit the gate rather than reintroduce the
    // hole. An unknown subpath under a sensitive prefix is 401 (not authorized),
    // never 404 (which would tell an anonymous prober which routes exist).
    const res = await fetch(`${s.base}/api/ask/anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'x' }),
    });
    await res.text();
    assert.strictEqual(res.status, 401, '/api/ask/* is sensitive as a prefix, not as one exact string');
  } finally {
    await s.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
