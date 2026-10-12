import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { anthropicOutputCeiling, generateText, type AiConfig } from '../server/provider.js';

/** A localhost anthropic-wire host that answers each request with `reply(body)`. */
async function host(reply: (body: { max_tokens: number }) => { status: number; json: unknown }) {
  const requests: Array<{ max_tokens: number }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const r = reply(body);
      res.statusCode = r.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const OK = { status: 200, json: { content: [{ type: 'text', text: 'ok' }] } };
const cfg = (baseUrl: string, model: string, maxTokens?: number): AiConfig => ({
  provider: 'anthropic',
  baseUrl,
  model,
  apiKey: 'k',
  ...(maxTokens !== undefined ? { params: { maxTokens } } : {}),
});

test('the ceiling table: current models 16384, 3.5 8192, claude-3 4096', () => {
  assert.equal(anthropicOutputCeiling('claude-sonnet-4-5'), 16384);
  assert.equal(anthropicOutputCeiling('claude-3-5-haiku-20241022'), 8192);
  assert.equal(anthropicOutputCeiling('claude-3-haiku-20240307'), 4096);
  assert.equal(anthropicOutputCeiling('claude-3-opus-20240229'), 4096);
  assert.equal(anthropicOutputCeiling('some-compatible-model'), 16384);
});

test('a 4096-cap model is sent 4096 on the first request', async () => {
  const srv = await host(() => OK);
  try {
    await generateText(cfg(srv.baseUrl, 'claude-3-haiku-20240307'), 'q');
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests.map((r) => r.max_tokens), [4096]);
});

test('an unknown model that 400s on max_tokens is retried ONCE at 8192 and succeeds', async () => {
  const srv = await host((b) =>
    b.max_tokens > 8192
      ? { status: 400, json: { error: { message: 'max_tokens: 16384 > 8192, which is the maximum allowed' } } }
      : OK,
  );
  let out: string;
  try {
    out = await generateText(cfg(srv.baseUrl, 'acme-large'), 'q');
  } finally {
    await srv.close();
  }
  assert.equal(out, 'ok');
  assert.deepEqual(srv.requests.map((r) => r.max_tokens), [16384, 8192]);
});

test('the retry uses the server-reported maximum when it names one', async () => {
  const srv = await host((b) =>
    b.max_tokens > 4096
      ? { status: 400, json: { error: { message: 'invalid max_tokens, the maximum is 4096 for this model' } } }
      : OK,
  );
  try {
    await generateText(cfg(srv.baseUrl, 'acme-small'), 'q');
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests.map((r) => r.max_tokens), [16384, 4096]);
});

test('retries once only: a second max_tokens 400 is the error', async () => {
  const srv = await host(() => ({ status: 400, json: { error: { message: 'max_tokens too large' } } }));
  try {
    await assert.rejects(() => generateText(cfg(srv.baseUrl, 'acme-x'), 'q'), /HTTP 400/);
  } finally {
    await srv.close();
  }
  assert.equal(srv.requests.length, 2);
});

test('an unrelated 400 is never retried', async () => {
  const srv = await host(() => ({ status: 400, json: { error: { message: 'messages: roles must alternate' } } }));
  try {
    await assert.rejects(() => generateText(cfg(srv.baseUrl, 'acme-x'), 'q'), /HTTP 400/);
  } finally {
    await srv.close();
  }
  assert.equal(srv.requests.length, 1);
});

test("the reader's own maxTokens is honoured and never silently lowered", async () => {
  const srv = await host(() => ({ status: 400, json: { error: { message: 'max_tokens too large' } } }));
  try {
    await assert.rejects(() => generateText(cfg(srv.baseUrl, 'acme-x', 99999), 'q'), /HTTP 400/);
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests.map((r) => r.max_tokens), [99999]);
});
