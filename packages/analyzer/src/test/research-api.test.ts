/**
 * e2e lock for POST /api/research — live research gateway.
 * Mocked provider + mocked web fetch via SEQUENCE_RESEARCH_FETCH_TEST hook… 
 * Actually we inject by setting globalThis — better: the endpoint uses real fetch
 * for pages, so we spin a local HTTP fixture for "web pages" and mock provider.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const TEST_KEY = 'sk-ant-test-RESEARCH-SECRET-99';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-research-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

/** An isolated user-config dir, so a repo-less test never reads the real HOME. */
function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-research-user-')));
}

async function startServer(
  repoRoot: string | null,
  userConfigDir?: string,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putAiConfig(base: string, baseUrl: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
  });
}

/** Tiny public-looking fixture server (bound to 127.0.0.1 — used as URL host override via research test seam). */
async function startFixturePage(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html');
    res.end('<html><title>Fixture Doc</title><body><p>Outbox pattern evidence.</p></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/doc`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('/api/research: 409 with no repo attached', async () => {
  const { base, close } = await startServer(null);
  try {
    const res = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'hi' }),
    });
    assert.strictEqual(res.status, 409);
  } finally {
    await close();
  }
});

test('/api/research: no provider → 400 connect-your-key (honest, no fabricated brief)', async () => {
  const repo = plainappRepo();
  /* Isolated for the same reason as the matching /api/ask test: the server
   * falls back to `~/.sequence/ai.json`, so without this the assertion is
   * really about whoever is running it. */
  const { base, close } = await startServer(repo, tempUserDir());
  try {
    const res = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'circuit breakers' }),
    });
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /connect your AI key/i);
  } finally {
    await close();
  }
});

test('/api/research: 400 on empty query', async () => {
  const repo = plainappRepo();
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, 'http://127.0.0.1:9');
    const res = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '  ' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});

test('/api/research: with mock provider + allowlisted local fixture URL → brief + citations', async () => {
  const repo = plainappRepo();
  const page = await startFixturePage();
  // Test-only seam: allow fetching this exact loopback URL (production SSRF still blocks others).
  process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = page.url;

  const mock = await startMockProvider((reqBody) => {
    const text = JSON.stringify(reqBody);
    assert.ok(text.includes('Outbox pattern evidence') || text.includes('SOURCES'), 'prompt carries fetched body');
    return { text: 'The fixture documents an outbox-style approach.' };
  });
  const { base, close } = await startServer(repo);
  try {
    assert.strictEqual((await putAiConfig(base, mock.baseUrl)).status, 200);
    const res = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `Research outbox using ${page.url}` }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      title: string;
      path: string;
      markdown: string;
      text: string;
      citations: Array<{ url: string; ok: boolean }>;
    };
    assert.match(body.path, /^\.sequence\/decisions\//);
    assert.match(body.markdown, /Outbox|outbox/);
    assert.match(body.markdown, /Sources \(fetched\)/);
    assert.ok(body.citations.some((c) => c.url === page.url && c.ok));
    assert.ok(!JSON.stringify(body).includes(TEST_KEY));
    assert.strictEqual(mock.requests.length, 1);
  } finally {
    delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
    await close();
    await mock.close();
    await page.close();
  }
});

test('/api/research: failed page fetch is reported in citations — not invented as ok', async () => {
  const repo = plainappRepo();
  process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = 'http://127.0.0.1:1/missing';

  const mock = await startMockProvider(() => ({
    text: 'No usable sources were retrieved.',
  }));
  const { base, close } = await startServer(repo);
  try {
    await putAiConfig(base, mock.baseUrl);
    const res = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'x',
        urls: ['http://127.0.0.1:1/missing'],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as {
      markdown: string;
      citations: Array<{ url: string; ok: boolean; error?: string }>;
    };
    assert.ok(body.citations.length >= 1);
    assert.ok(body.citations.every((c) => !c.ok));
    assert.match(body.markdown, /fetch failed/i);
  } finally {
    delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
    await close();
    await mock.close();
  }
});
