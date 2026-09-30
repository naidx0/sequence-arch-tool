import assert from 'node:assert';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { loadConfig, type GatewayConfig } from '../src/config.js';
import { createGateway, type Logger } from '../src/gateway.js';
import { InMemorySpendStore, type SpendStore } from '../src/store.js';
import { SlidingWindowRateLimiter, type RateLimiter } from '../src/rateLimit.js';

/**
 * Gateway contract lock. The real OpenRouter call is NEVER made here: `fetch` is
 * injected with a mock, so these tests verify routing, auth, the spend backstop,
 * model remap, byte clamps, verbatim passthrough, and — the security crux — that
 * the funded key is attached DOWNSTREAM but never leaks into a client response.
 * Live OpenRouter behavior is verified only on deploy.
 */

const FUNDED_KEY = 'sk-or-FUNDED-SECRET-do-not-leak';
const CALLER_TOKEN = 'caller-token-abc';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

interface MockFetch {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
}

/** A fetch that records every call and returns a canned OpenAI-shape response. */
function mockFetch(
  reply: () => { status?: number; body?: unknown; headers?: Record<string, string> } = () => ({})
): MockFetch {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const r = reply();
    const status = r.status ?? 200;
    const body = r.body ?? { choices: [{ message: { role: 'assistant', content: 'hi from model' } }] };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

interface Harness {
  base: string;
  store: SpendStore;
  fetchMock: MockFetch;
  close: () => Promise<void>;
}

async function startGateway(opts: {
  // A value of `undefined` DELETES that default key (e.g. to unset the caller token).
  env?: Record<string, string | undefined>;
  store?: SpendStore;
  fetchMock?: MockFetch;
  rateLimiter?: RateLimiter;
} = {}): Promise<Harness> {
  const env: Record<string, string | undefined> = {
    OPENROUTER_API_KEY: FUNDED_KEY,
    SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN,
    GATEWAY_DEFAULT_MODEL: 'deepseek/deepseek-chat',
    GLOBAL_SPEND_BACKSTOP_USD: '50',
    EST_COST_PER_CALL: '0.0018',
    ...opts.env,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const config: GatewayConfig = loadConfig(env as NodeJS.ProcessEnv);
  const store = opts.store ?? new InMemorySpendStore();
  const fetchMock = opts.fetchMock ?? mockFetch();
  const rateLimiter = opts.rateLimiter ?? new SlidingWindowRateLimiter(config.rateLimitPerMin);
  const server = createGateway({ config, store, fetch: fetchMock.fn, rateLimiter, logger: silentLogger });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    store,
    fetchMock,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function authed(body: unknown, token: string | null = CALLER_TOKEN): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

/** GET /v1/usage carrying the caller bearer token (the usage read is now token-gated). */
function usageGet(base: string, token: string | null = CALLER_TOKEN): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}/v1/usage`, { headers });
}

const CHAT = '/v1/chat/completions';
const USER_MSG = { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hello' }] };

test('healthz returns ok', async () => {
  const h = await startGateway();
  try {
    const res = await fetch(`${h.base}/healthz`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });
  } finally {
    await h.close();
  }
});

test('rejects caller with missing/wrong bearer token → 401', async () => {
  const h = await startGateway();
  try {
    const noToken = await fetch(`${h.base}${CHAT}`, authed(USER_MSG, null));
    assert.strictEqual(noToken.status, 401);

    const wrong = await fetch(`${h.base}${CHAT}`, authed(USER_MSG, 'not-the-token'));
    assert.strictEqual(wrong.status, 401);

    // A 401 must never trigger a downstream call (no funded-key request made).
    assert.strictEqual(h.fetchMock.calls.length, 0);
  } finally {
    await h.close();
  }
});

test('unset SEQUENCE_GATEWAY_TOKEN accepts all callers (dev mode)', async () => {
  const h = await startGateway({ env: { SEQUENCE_GATEWAY_TOKEN: undefined } }); // token UNSET → accept all
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG, null));
    assert.strictEqual(res.status, 200);
  } finally {
    await h.close();
  }
});

test('global spend backstop returns 402 once at/over the cap', async () => {
  const store = new InMemorySpendStore();
  const h = await startGateway({ store });
  try {
    // Seed the current month at the backstop.
    const usageRes = await usageGet(h.base);
    const usage = (await usageRes.json()) as { monthYear: string; backstop: number };
    store.add(usage.monthYear, usage.backstop); // now spend >= backstop

    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG));
    assert.strictEqual(res.status, 402);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /add your own key/i);
    // Backstop blocks BEFORE any downstream call.
    assert.strictEqual(h.fetchMock.calls.length, 0);
  } finally {
    await h.close();
  }
});

test('remaps deepseek-v4-flash → GATEWAY_DEFAULT_MODEL and forwards only model+messages+max_tokens', async () => {
  const h = await startGateway();
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed({ ...USER_MSG, temperature: 0.9, max_tokens: 999999 }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(h.fetchMock.calls.length, 1);

    const sent = JSON.parse(String(h.fetchMock.calls[0].init.body));
    assert.strictEqual(sent.model, 'deepseek/deepseek-chat', 'app default model remapped');
    assert.deepStrictEqual(sent.messages, USER_MSG.messages);
    assert.strictEqual(sent.max_tokens, 2048, 'server-imposed token cap');
    // Client-supplied fields are dropped.
    assert.ok(!('temperature' in sent), 'unknown field stripped');
    assert.notStrictEqual(sent.max_tokens, 999999, 'client max_tokens overridden');
  } finally {
    await h.close();
  }
});

test('passes an allowlisted model through unchanged', async () => {
  const h = await startGateway({
    env: {
      OPENROUTER_API_KEY: FUNDED_KEY,
      SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN,
      GATEWAY_ALLOWED_MODELS: 'deepseek/deepseek-chat, anthropic/claude-3.5-sonnet',
    },
  });
  try {
    await fetch(`${h.base}${CHAT}`, authed({ model: 'anthropic/claude-3.5-sonnet', messages: USER_MSG.messages }));
    const sent = JSON.parse(String(h.fetchMock.calls[0].init.body));
    assert.strictEqual(sent.model, 'anthropic/claude-3.5-sonnet');
  } finally {
    await h.close();
  }
});

test('coerces a NON-allowlisted model to the default (funded key can only spend on approved models)', async () => {
  // Default allowlist is just deepseek/deepseek-chat; gpt-4o is not on it.
  const h = await startGateway();
  try {
    await fetch(`${h.base}${CHAT}`, authed({ model: 'openai/gpt-4o', messages: USER_MSG.messages }));
    const sent = JSON.parse(String(h.fetchMock.calls[0].init.body));
    assert.strictEqual(sent.model, 'deepseek/deepseek-chat', 'non-allowlisted model coerced to default, not forwarded');
  } finally {
    await h.close();
  }
});

test('OpenAI-shape passthrough: funded key attached DOWNSTREAM but never in the response', async () => {
  const upstreamBody = { id: 'gen-1', choices: [{ message: { role: 'assistant', content: 'the answer' } }] };
  const fetchMock = mockFetch(() => ({ body: upstreamBody }));
  const h = await startGateway({ fetchMock });
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG));
    assert.strictEqual(res.status, 200);

    // Response body is the upstream OpenAI body verbatim.
    const raw = await res.text();
    assert.deepStrictEqual(JSON.parse(raw), upstreamBody);

    // The funded key WAS attached to the downstream request…
    const dsAuth = (h.fetchMock.calls[0].init.headers as Record<string, string>).authorization;
    assert.strictEqual(dsAuth, `Bearer ${FUNDED_KEY}`);

    // …and does NOT appear anywhere in what the client received (body or headers).
    assert.ok(!raw.includes(FUNDED_KEY), 'funded key must not be in response body');
    for (const [, v] of res.headers) assert.ok(!v.includes(FUNDED_KEY), 'funded key must not be in a response header');

    // A successful call meters the global counter.
    const usage = (await (await usageGet(h.base)).json()) as { globalSpendToDate: number };
    assert.ok(usage.globalSpendToDate > 0, 'successful call increments global spend');
  } finally {
    await h.close();
  }
});

test('oversize body → 413 and no downstream call', async () => {
  const h = await startGateway({ env: { OPENROUTER_API_KEY: FUNDED_KEY, SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN, GATEWAY_MAX_REQUEST_BYTES: '1024' } });
  try {
    const huge = { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'x'.repeat(5000) }] };
    const res = await fetch(`${h.base}${CHAT}`, authed(huge));
    assert.strictEqual(res.status, 413);
    assert.strictEqual(h.fetchMock.calls.length, 0);
  } finally {
    await h.close();
  }
});

test('missing messages[] → 400', async () => {
  const h = await startGateway();
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed({ model: 'deepseek-v4-flash' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(h.fetchMock.calls.length, 0);
  } finally {
    await h.close();
  }
});

test('upstream error is sanitized, maps 5xx→502, and never leaks the funded key', async () => {
  // Upstream tries to echo the key inside its error body — the gateway must NOT pass it through.
  const fetchMock = mockFetch(() => ({ status: 500, body: { error: { message: `boom ${FUNDED_KEY}` } } }));
  const h = await startGateway({ fetchMock });
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG));
    assert.strictEqual(res.status, 502, '5xx mapped to 502');
    const raw = await res.text();
    assert.ok(!raw.includes(FUNDED_KEY), 'funded key must never appear in an error response');
    // A failed call does NOT meter spend.
    const usage = (await (await usageGet(h.base)).json()) as { globalSpendToDate: number };
    assert.strictEqual(usage.globalSpendToDate, 0);
  } finally {
    await h.close();
  }
});

test('upstream 4xx status passes through (sanitized body)', async () => {
  const fetchMock = mockFetch(() => ({ status: 429, body: { error: { message: 'upstream rate limited' } } }));
  const h = await startGateway({ fetchMock });
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG));
    assert.strictEqual(res.status, 429);
  } finally {
    await h.close();
  }
});

test('abuse rate-limit returns 429 over the window', async () => {
  const rateLimiter = new SlidingWindowRateLimiter(2, 60_000);
  const h = await startGateway({ rateLimiter });
  try {
    assert.strictEqual((await fetch(`${h.base}${CHAT}`, authed(USER_MSG))).status, 200);
    assert.strictEqual((await fetch(`${h.base}${CHAT}`, authed(USER_MSG))).status, 200);
    assert.strictEqual((await fetch(`${h.base}${CHAT}`, authed(USER_MSG))).status, 429);
  } finally {
    await h.close();
  }
});

test('missing OPENROUTER_API_KEY → 500 misconfigured (no key echoed, no crash)', async () => {
  const h = await startGateway({ env: { OPENROUTER_API_KEY: '', SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN } });
  try {
    const res = await fetch(`${h.base}${CHAT}`, authed(USER_MSG));
    assert.strictEqual(res.status, 500);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /misconfigured/i);
    assert.strictEqual(h.fetchMock.calls.length, 0);
  } finally {
    await h.close();
  }
});
