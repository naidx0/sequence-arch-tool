import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateText,
  generateFiles,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MODEL,
  FREE_TIER_NOT_LIVE_MSG,
  FREE_TIER_UNREACHABLE_MSG,
  ProviderError,
  type AiConfig,
} from '../server/provider.js';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

/**
 * v18 Wave 2 — the HONEST free-tier failure. The hosted gateway placeholder is
 * NOT deployed, so a default-mode request still pointed at DEFAULT_GATEWAY_URL
 * must fail with FREE_TIER_NOT_LIVE_MSG BEFORE any fetch — never a raw
 * "fetch failed". The scoping guarantees locked here:
 *   1. default @ placeholder → honest throw, and NO network call is attempted.
 *   2. default @ an INJECTED gateway (the deploy/test seam) is UNAFFECTED — it
 *      round-trips a mock exactly as before.
 *   3. BYO-key network failures keep their RAW diagnostic (their endpoint).
 *   4. end-to-end: POST /api/ask with a default config (no gateway override)
 *      surfaces the honest message as a 502.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function withNoFetch<T>(fn: () => Promise<T>): Promise<T> {
  // Replace global.fetch with a tripwire: if the code under test reaches the
  // network at all, the test fails loudly instead of silently doing I/O.
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error('NETWORK TRIPWIRE: fetch must NOT be called on the honest pre-fetch throw');
  }) as typeof fetch;
  const restore = () => {
    globalThis.fetch = real;
  };
  return fn()
    .then((v) => {
      assert.strictEqual(called, false, 'no fetch should have been attempted');
      return v;
    })
    .finally(restore);
}

test('provider: default @ placeholder gateway → honest throw with NO fetch attempted', async () => {
  const cfg: AiConfig = {
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: DEFAULT_GATEWAY_URL,
    model: DEFAULT_MODEL,
  };
  await withNoFetch(async () => {
    await assert.rejects(
      () => generateText(cfg, 'what does this app do?'),
      (e: unknown) => {
        assert.ok(e instanceof ProviderError);
        assert.strictEqual((e as ProviderError).message, FREE_TIER_NOT_LIVE_MSG);
        return true;
      }
    );
  });
});

test('provider: generateFiles default @ placeholder → same honest throw, no fetch', async () => {
  const cfg: AiConfig = {
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: DEFAULT_GATEWAY_URL,
    model: DEFAULT_MODEL,
  };
  await withNoFetch(async () => {
    await assert.rejects(
      () => generateFiles(cfg, 'scaffold this'),
      (e: unknown) => (e as Error).message === FREE_TIER_NOT_LIVE_MSG
    );
  });
});

test('provider: default @ an INJECTED gateway is UNAFFECTED — round-trips the mock', async () => {
  const gateway = await startMockProvider(() => ({ text: 'hello from the gateway' }), 'openai');
  try {
    // The exact shape repoServer builds when a gateway override is injected: the
    // gatewayLive stamp is set, so the honest guard must NOT fire.
    const cfg: AiConfig = {
      mode: 'default',
      provider: 'openai-compatible',
      baseUrl: gateway.baseUrl,
      model: DEFAULT_MODEL,
      gatewayLive: true,
    };
    const text = await generateText(cfg, 'explain this repo');
    assert.strictEqual(text, 'hello from the gateway');
    assert.strictEqual(gateway.requests.length, 1);
  } finally {
    await gateway.close();
  }
});

test('provider: the gate is the LIVE STAMP, not URL equality — a deploy at the placeholder hostname works', async () => {
  // v18 review round 1: the placeholder IS the natural production hostname. A real
  // deploy sets SEQUENCE_GATEWAY_URL to that very URL; the guard must key on the
  // gatewayLive stamp and attempt the request, never re-brick the live free tier.
  const cfg: AiConfig = {
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: DEFAULT_GATEWAY_URL, // SAME string as the placeholder
    model: DEFAULT_MODEL,
    gatewayLive: true, // …but a gateway WAS configured
  };
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'live!' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const text = await generateText(cfg, 'explain');
    assert.strictEqual(called, true, 'the request must be attempted (guard bypassed by the stamp)');
    assert.strictEqual(text, 'live!');
  } finally {
    globalThis.fetch = real;
  }
});

test('provider: default @ a LIVE but unreachable gateway → honest UNREACHABLE message (not "not live yet")', async () => {
  const cfg: AiConfig = {
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1', // nothing listens here
    model: DEFAULT_MODEL,
    gatewayLive: true,
  };
  await assert.rejects(
    () => generateText(cfg, 'hi'),
    (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.strictEqual((e as ProviderError).message, FREE_TIER_UNREACHABLE_MSG);
      return true;
    }
  );
});

test('provider: a BYO-key NETWORK failure keeps the RAW diagnostic (not the honest message)', async () => {
  // api-key mode pointed at a dead host — the fetch rejects. The message must be
  // the raw "provider request failed: …", NOT the free-tier nudge.
  const cfg: AiConfig = {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1', // nothing listens here
    model: 'm',
    apiKey: 'sk-user-secret',
  };
  await assert.rejects(
    () => generateText(cfg, 'hi'),
    (e: unknown) => {
      const msg = (e as Error).message;
      assert.match(msg, /provider request failed/i);
      assert.ok(!msg.includes('free assistant is not live'), 'BYO key must not get the free-tier message');
      assert.ok(!msg.includes('sk-user-secret'), 'the key never leaks into the error');
      return true;
    }
  );
});

test('/api/ask: a default config (no gateway override) → 502 with the honest free-tier message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-freetier-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  // No gatewayBaseUrl passed ⇒ loadAiConfig keeps DEFAULT_GATEWAY_URL ⇒ honest throw.
  const server = await createRepoServer(repo, { webDist: undefined });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(put.status, 200);

    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.strictEqual(body.error, FREE_TIER_NOT_LIVE_MSG);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/*
 * THE FREE TIER IS NOT A CHOICE THAT OUTRANKS A KEY YOU ACTUALLY GAVE US.
 *
 * `mode: 'default'` means "use the free assistant". When no gateway is
 * configured the free assistant DOES NOT EXIST, and the server refused with
 * "add your own API key in Settings to chat" — while `SEQUENCE_AI_KEY` and its
 * companions were set in the environment. The user had added a key. The app
 * told them to add a key.
 *
 * Found by driving the real CLI: `sequence ask` first says "no AI provider
 * configured — set SEQUENCE_AI_KEY (with SEQUENCE_AI_PROVIDER /
 * SEQUENCE_AI_BASE_URL / SEQUENCE_AI_MODEL)", and setting exactly those four
 * changed the refusal to a DIFFERENT refusal rather than answering. The env
 * fallback was gated on `if (!cfg)` — any on-disk config at all, including one
 * whose whole meaning is "I have not chosen a provider", shadowed it.
 *
 * The fix is narrow on purpose. An `api-key` config is a real choice and is
 * still never overridden — a stray environment variable must not redirect a
 * user's own key or host. Only an unservable default falls through, which is a
 * state that could otherwise ONLY refuse.
 */
test('/api/ask: a default config with no gateway falls through to the env key rather than refusing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-freetier-env-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const userConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-freetier-env-user-'));

  /* A provider that is reachable and refuses, so a PASS is "we tried the env
   * provider" and not "we happened to answer". Nothing listens on port 1. */
  const saved = {
    key: process.env.SEQUENCE_AI_KEY,
    provider: process.env.SEQUENCE_AI_PROVIDER,
    baseUrl: process.env.SEQUENCE_AI_BASE_URL,
    model: process.env.SEQUENCE_AI_MODEL,
  };
  process.env.SEQUENCE_AI_KEY = 'sk-env-supplied-secret';
  process.env.SEQUENCE_AI_PROVIDER = 'openai-compatible';
  process.env.SEQUENCE_AI_BASE_URL = 'http://127.0.0.1:1';
  process.env.SEQUENCE_AI_MODEL = 'env-model';

  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(put.status, 200);

    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    const body = (await res.json()) as { error?: string };
    const msg = body.error ?? '';

    assert.ok(
      !msg.includes('free assistant is not live'),
      `a key WAS supplied via the environment; the free-tier nudge is wrong here. got: ${msg}`,
    );
    /* It reached the env provider and that provider refused — which is the
     * proof the fallback fired at all. */
    assert.match(msg, /provider request failed|ECONNREFUSED|fetch failed/i);
    assert.ok(!msg.includes('sk-env-supplied-secret'), 'the key never leaks into the error');
  } finally {
    for (const [k, v] of Object.entries({
      SEQUENCE_AI_KEY: saved.key,
      SEQUENCE_AI_PROVIDER: saved.provider,
      SEQUENCE_AI_BASE_URL: saved.baseUrl,
      SEQUENCE_AI_MODEL: saved.model,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/* --------------------------------------- the redacted view tells the SAME truth */

/** Start a repo server on the plainapp fixture; `gatewayBaseUrl` is the deploy seam. */
async function startFreeTierServer(gatewayBaseUrl?: string): Promise<{ base: string; close: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-freetier-view-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  const server = await createRepoServer(repo, {
    webDist: undefined,
    gatewayBaseUrl,
    /*
     * NOTHING IS ANSWERING LOCALLY, DECLARED RATHER THAN ASSUMED.
     *
     * The config read probes two localhost ports and offers what it finds, so
     * these assertions - which compare the redacted view EXACTLY - would pass
     * or fail on whether the operator happens to have Ollama running. Two of
     * them did, on the machine this was written on. A test whose result
     * depends on what is installed is not a test.
     */
    detectLocal: async () => [],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('/api/ai-config: the redacted view carries gatewayLive:false when NO gateway is configured', async () => {
  // r179 gap: the web's freeTierLive() reads AiConfigView.gatewayLive, but the
  // server never stamped it into the redaction — so the UI could not tell a live
  // free tier from a dead one. Here nothing is deployed: the view must say false,
  // and /api/ask must agree by refusing with the honest message.
  const { base, close } = await startFreeTierServer();
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(put.status, 200);
    const putView = (await put.json()) as Record<string, unknown>;
    assert.strictEqual(putView.gatewayLive, false, 'PUT answers with the same truth as GET');

    const view = (await (await fetch(`${base}/api/ai-config`)).json()) as Record<string, unknown>;
    assert.deepStrictEqual(view, { configured: true, mode: 'default', model: DEFAULT_MODEL, gatewayLive: false });

    const ask = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(ask.status, 502, 'the view and the behaviour must not disagree');
    assert.strictEqual(((await ask.json()) as { error: string }).error, FREE_TIER_NOT_LIVE_MSG);
  } finally {
    await close();
  }
});

test('/api/ai-config: a CONFIGURED gateway reads gatewayLive:true, and the view still holds no key or host', async () => {
  const gateway = await startMockProvider(() => ({ text: 'hello from the gateway' }), 'openai');
  const { base, close } = await startFreeTierServer(gateway.baseUrl);
  try {
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(((await put.json()) as Record<string, unknown>).gatewayLive, true);

    const res = await fetch(`${base}/api/ai-config`);
    const view = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(view.gatewayLive, true, 'a deployed gateway must read LIVE');
    assert.deepStrictEqual(view, { configured: true, mode: 'default', model: DEFAULT_MODEL, gatewayLive: true });

    // Never the key, never the host: the view is a boolean's worth of truth.
    const asText = JSON.stringify(view);
    assert.ok(!asText.includes(gateway.baseUrl), 'the gateway URL never crosses the wire');
    assert.ok(!/sk-/.test(asText) && !/apiKey/.test(asText), 'no key field, no key fragment');

    // …and the claim is honest end to end: with the gateway live, /api/ask works.
    const ask = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What does this app do?' }),
    });
    assert.strictEqual(ask.status, 200, 'gatewayLive:true must mean the free assistant really answers');
  } finally {
    await close();
    await gateway.close();
  }
});
