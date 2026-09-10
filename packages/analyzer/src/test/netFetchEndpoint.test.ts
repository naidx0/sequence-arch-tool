import assert from 'node:assert';
import { test } from 'node:test';
import { createRepoServer } from '../server/repoServer.js';

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('POST /api/net-fetch: returns capped plain text for ok responses', async () => {
  const prev = process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
  process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = 'http://127.0.0.1:9/good';
  const { base, close } = await startServer();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('127.0.0.1:9/good')) {
      return new Response('<html><title>Good</title><body><p>Measured body.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return prevFetch(input, init);
  };
  try {
    const res = await fetch(`${base}/api/net-fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:9/good' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; title?: string; text?: string };
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.title, 'Good');
    assert.match(body.text ?? '', /Measured body/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prev === undefined) delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
    else process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = prev;
    await close();
  }
});

test('POST /api/net-fetch: refuses SSRF loopback without upstream fetch', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/net-fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    assert.strictEqual(body.ok, false);
    assert.match(body.error ?? '', /refused/);
  } finally {
    await close();
  }
});

test('POST /api/net-fetch: rejects missing url', async () => {
  const { base, close } = await startServer();
  try {
    const res = await fetch(`${base}/api/net-fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await close();
  }
});
