import assert from 'node:assert';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.js';
import { createGateway, type Logger } from '../src/gateway.js';
import { InMemorySpendStore } from '../src/store.js';
import { SlidingWindowRateLimiter } from '../src/rateLimit.js';

/**
 * v13 P1 — GET /v1/usage caller-token gate. When SEQUENCE_GATEWAY_TOKEN is
 * configured the spend counter is a protected read (same bearer as the proxy):
 * no/wrong token → 401; correct token → 200. Unset (dev) ⇒ open, matching the
 * proxy route.
 */

const FUNDED_KEY = 'sk-or-FUNDED';
const CALLER_TOKEN = 'caller-token-xyz';
const silentLogger: Logger = { info() {}, warn() {}, error() {} };

async function startGateway(env: Record<string, string | undefined>): Promise<{ base: string; close: () => Promise<void> }> {
  const full: Record<string, string | undefined> = { OPENROUTER_API_KEY: FUNDED_KEY, ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  const config = loadConfig(full as NodeJS.ProcessEnv);
  const server = createGateway({
    config,
    store: new InMemorySpendStore(),
    rateLimiter: new SlidingWindowRateLimiter(config.rateLimitPerMin),
    logger: silentLogger,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('/v1/usage without the caller token → 401 (token configured)', async () => {
  const h = await startGateway({ SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN });
  try {
    const noToken = await fetch(`${h.base}/v1/usage`);
    assert.strictEqual(noToken.status, 401);

    const wrong = await fetch(`${h.base}/v1/usage`, { headers: { authorization: 'Bearer nope' } });
    assert.strictEqual(wrong.status, 401);
  } finally {
    await h.close();
  }
});

test('/v1/usage with the caller token → 200 and the usage shape', async () => {
  const h = await startGateway({ SEQUENCE_GATEWAY_TOKEN: CALLER_TOKEN });
  try {
    const ok = await fetch(`${h.base}/v1/usage`, { headers: { authorization: `Bearer ${CALLER_TOKEN}` } });
    assert.strictEqual(ok.status, 200);
    const body = (await ok.json()) as { globalSpendToDate: number; backstop: number; monthYear: string };
    assert.strictEqual(typeof body.globalSpendToDate, 'number');
    assert.strictEqual(typeof body.backstop, 'number');
    assert.match(body.monthYear, /^\d{4}-\d{2}$/);
  } finally {
    await h.close();
  }
});

test('/v1/usage is open when SEQUENCE_GATEWAY_TOKEN is unset (dev)', async () => {
  const h = await startGateway({ SEQUENCE_GATEWAY_TOKEN: undefined });
  try {
    const ok = await fetch(`${h.base}/v1/usage`);
    assert.strictEqual(ok.status, 200);
  } finally {
    await h.close();
  }
});
