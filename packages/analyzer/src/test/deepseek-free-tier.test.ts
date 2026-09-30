import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  resolveEndpoint,
  redactAiConfig,
  DEFAULT_GATEWAY_URL,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  FREE_TIER_NOT_LIVE_MSG,
  FREE_TIER_DAILY_LIMIT_MSG,
  RateLimitError,
  ProviderError,
  type AiConfig,
} from '../server/provider.js';
import {
  freeTierDailyLimit,
  createDailyLimiter,
  DEFAULT_FREE_TIER_DAILY_LIMIT,
} from '../server/freeTierLimit.js';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';

/**
 * "Make the FREE assistant work on first run" (U6). When the owner sets
 * DEEPSEEK_API_KEY, the free default routes STRAIGHT to DeepSeek (openai wire)
 * with the funded SERVER key, gatewayLive passes, and a KEYLESS user gets an
 * answer — per-user daily-capped. Locks:
 *   1. default @ DeepSeek (mock) → answer; the funded key is sent server-side but
 *      NEVER appears in redactAiConfig or any client-visible response.
 *   2. NO key set → unchanged honest FREE_TIER_NOT_LIVE_MSG (no fetch).
 *   3. daily cap → honest 429; a different user is independent; env-configurable.
 *   4. BYO-key mode is unaffected — it still routes to the user's own endpoint.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');
const DEEPSEEK_KEY = 'sk-DEEPSEEK-SERVER-SECRET-abc123';

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-deepseek-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

/** Save + restore the DeepSeek/limit env vars around a body so tests never leak into siblings. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const keys = ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'FREE_TIER_DAILY_LIMIT'];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    for (const k of keys) {
      if (k in vars) {
        if (vars[k] === undefined) delete process.env[k];
        else process.env[k] = vars[k];
      } else {
        delete process.env[k];
      }
    }
    await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function resolveIdentity(req: http.IncomingMessage): string | undefined {
  const h = req.headers['x-test-identity'];
  return typeof h === 'string' && h.trim() !== '' ? h : undefined;
}

async function startServer(repoRoot: string | null): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, resolveIdentity });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putDefault(base: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'default' }),
  });
}

async function ask(base: string, identity?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (identity) headers['x-test-identity'] = identity;
  return fetch(`${base}/api/ask`, { method: 'POST', headers, body: JSON.stringify({ question: 'What does this app do?' }) });
}

/* ------------------------------------------------ unit: env + limiter + resolve */

test('freeTierDailyLimit: default 100, env override, garbage falls back', () => {
  assert.strictEqual(freeTierDailyLimit({}), DEFAULT_FREE_TIER_DAILY_LIMIT);
  assert.strictEqual(freeTierDailyLimit({}), 100);
  assert.strictEqual(freeTierDailyLimit({ FREE_TIER_DAILY_LIMIT: '5' }), 5);
  assert.strictEqual(freeTierDailyLimit({ FREE_TIER_DAILY_LIMIT: '0' }), 0);
  assert.strictEqual(freeTierDailyLimit({ FREE_TIER_DAILY_LIMIT: 'nope' }), 100);
});

test('createDailyLimiter: caps per identity and resets on a UTC day rollover', () => {
  let day = new Date('2026-07-20T10:00:00Z');
  const lim = createDailyLimiter(2, () => day);
  assert.strictEqual(lim.allow('a'), true);
  lim.record('a');
  lim.record('a');
  assert.strictEqual(lim.allow('a'), false, 'a is over the cap');
  assert.strictEqual(lim.allow('b'), true, 'b is independent');
  day = new Date('2026-07-21T00:00:01Z'); // next UTC day
  assert.strictEqual(lim.allow('a'), true, 'a resets after rollover');
  assert.strictEqual(lim.used('a'), 0);
});

test('resolveEndpoint: default mode sends the DeepSeek SERVER key as Bearer (env, not config)', async () => {
  await withEnv({ DEEPSEEK_API_KEY: DEEPSEEK_KEY }, async () => {
    const cfg: AiConfig = {
      mode: 'default',
      provider: 'openai-compatible',
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL,
      gatewayLive: true,
    };
    const { url, headers } = resolveEndpoint(cfg);
    assert.strictEqual(url, `${DEEPSEEK_BASE_URL}/v1/chat/completions`);
    assert.strictEqual(headers.authorization, `Bearer ${DEEPSEEK_KEY}`);
    // The key rode ONLY in the header this call built — never in the config.
    assert.strictEqual((cfg as AiConfig).apiKey, undefined);
  });
});

test('redactAiConfig: default mode NEVER carries a key even with DEEPSEEK_API_KEY set', async () => {
  await withEnv({ DEEPSEEK_API_KEY: DEEPSEEK_KEY }, async () => {
    // The shape the server actually hands a client once DeepSeek funds the free
    // tier: loadAiConfig stamps gatewayLive, so the view says LIVE — while the
    // funded key and the DeepSeek host stay server-side.
    const red = redactAiConfig({
      mode: 'default',
      provider: 'openai-compatible',
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL,
      gatewayLive: true,
    });
    assert.deepStrictEqual(red, {
      configured: true,
      mode: 'default',
      model: DEEPSEEK_DEFAULT_MODEL,
      gatewayLive: true,
    });
    assert.ok(!JSON.stringify(red).includes(DEEPSEEK_KEY), 'the funded key never appears in a redaction');
    assert.ok(!JSON.stringify(red).includes(DEEPSEEK_BASE_URL), 'the gateway host never appears in a redaction');
  });
});

test('RateLimitError carries httpStatus 429 and the honest message', () => {
  const e = new RateLimitError();
  assert.ok(e instanceof ProviderError, 'a ProviderError subclass so existing catches handle it');
  assert.strictEqual(e.httpStatus, 429);
  assert.strictEqual(e.message, FREE_TIER_DAILY_LIMIT_MSG);
  assert.strictEqual(e.body, undefined, 'no provider body — the provider was never contacted');
});

/* ------------------------------------------------ e2e: default → DeepSeek (mock) */

test('/api/ask default → DeepSeek (mock): keyless user gets an answer; funded key stays server-side', async () => {
  const repo = plainappRepo();
  const deepseek = await startMockProvider(() => ({ text: 'A frontend and a backend that stores notes.' }), 'openai');
  await withEnv({ DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_BASE_URL: deepseek.baseUrl }, async () => {
    const { base, close } = await startServer(repo);
    try {
      assert.strictEqual((await putDefault(base)).status, 200);

      const res = await ask(base);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as { text: string };
      assert.strictEqual(body.text, 'A frontend and a backend that stores notes.');
      // The funded key NEVER rides back to the client.
      assert.ok(!JSON.stringify(body).includes(DEEPSEEK_KEY));

      // The GET redaction (what a client sees) carries mode:'default' and NO key.
      const cfgRes = await fetch(`${base}/api/ai-config`);
      const cfgBody = await cfgRes.text();
      assert.ok(!cfgBody.includes(DEEPSEEK_KEY), 'redacted config never leaks the funded key');
      assert.ok(JSON.parse(cfgBody).mode === 'default');

      // Server-side, the request DID reach DeepSeek with the Bearer key (proof of routing).
      assert.strictEqual(deepseek.requests.length, 1);
      assert.strictEqual(deepseek.requests[0].headers['authorization'], `Bearer ${DEEPSEEK_KEY}`);
    } finally {
      await close();
    }
  });
  await deepseek.close();
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

test('/api/ask default with NO key set → honest FREE_TIER_NOT_LIVE_MSG (behavior unchanged)', async () => {
  const repo = plainappRepo();
  await withEnv({}, async () => {
    const { base, close } = await startServer(repo);
    try {
      assert.strictEqual((await putDefault(base)).status, 200);
      const res = await ask(base);
      assert.strictEqual(res.status, 502);
      const body = (await res.json()) as { error: string };
      assert.strictEqual(body.error, FREE_TIER_NOT_LIVE_MSG);
    } finally {
      await close();
    }
  });
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

/* ------------------------------------------------ e2e: per-user daily rate limit */

test('/api/ask default: the (N+1)th call in a day → honest 429; a different user is independent', async () => {
  const repo = plainappRepo();
  const deepseek = await startMockProvider(() => ({ text: 'ok' }), 'openai');
  await withEnv(
    { DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_BASE_URL: deepseek.baseUrl, FREE_TIER_DAILY_LIMIT: '2' },
    async () => {
      const { base, close } = await startServer(repo);
      try {
        assert.strictEqual((await putDefault(base)).status, 200);

        // alice: 2 allowed, the 3rd is capped.
        assert.strictEqual((await ask(base, 'alice')).status, 200);
        assert.strictEqual((await ask(base, 'alice')).status, 200);
        const capped = await ask(base, 'alice');
        assert.strictEqual(capped.status, 429);
        const body = (await capped.json()) as { error: string };
        assert.strictEqual(body.error, FREE_TIER_DAILY_LIMIT_MSG);
        assert.ok(!JSON.stringify(body).includes(DEEPSEEK_KEY));

        // The capped request never reached DeepSeek (only alice's 2 successes did).
        assert.strictEqual(deepseek.requests.length, 2);

        // bob is independent — his own daily budget.
        assert.strictEqual((await ask(base, 'bob')).status, 200);
        assert.strictEqual(deepseek.requests.length, 3);
      } finally {
        await close();
      }
    }
  );
  await deepseek.close();
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});

/* ------------------------------------------------ regression: BYO-key unaffected */

test('BYO-key mode routes to the USER endpoint even with DEEPSEEK_API_KEY set (not DeepSeek)', async () => {
  const repo = plainappRepo();
  const USER_KEY = 'sk-ant-USER-OWN-KEY-999';
  const userProvider = await startMockProvider(() => ({ text: 'from the user own key' }), 'anthropic');
  const deepseek = await startMockProvider(() => ({ text: 'SHOULD NOT BE CALLED' }), 'openai');
  await withEnv({ DEEPSEEK_API_KEY: DEEPSEEK_KEY, DEEPSEEK_BASE_URL: deepseek.baseUrl }, async () => {
    const { base, close } = await startServer(repo);
    try {
      const put = await fetch(`${base}/api/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', baseUrl: userProvider.baseUrl, model: 'claude-test', apiKey: USER_KEY }),
      });
      assert.strictEqual(put.status, 200);

      const res = await ask(base);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as { text: string };
      assert.strictEqual(body.text, 'from the user own key');

      // The user's key went to THEIR endpoint; DeepSeek was never touched.
      assert.strictEqual(userProvider.requests.length, 1);
      assert.strictEqual(userProvider.requests[0].headers['x-api-key'], USER_KEY);
      assert.strictEqual(deepseek.requests.length, 0, 'DeepSeek is never contacted for a BYO key');
      assert.ok(!JSON.stringify(body).includes(USER_KEY));
    } finally {
      await close();
    }
  });
  await userProvider.close();
  await deepseek.close();
  fs.rmSync(path.dirname(repo), { recursive: true, force: true });
});
