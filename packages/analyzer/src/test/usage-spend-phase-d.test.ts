/**
 * ADR-013 Phase D — usage capture, spend reservations, and secret-free diagnostics.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  extractProviderUsage,
} from '../llm/usageExtraction.js';
import {
  COST_ESTIMATE_VERSION,
  estimateCostUsd,
  reserveEstimateUsd,
} from '../llm/costEstimate.js';
import { summarizeUsageDiagnostics } from '../llm/usageDiagnostics.js';
import {
  createSpendLedger,
  canReserveSpend,
} from '../server/spendLedger.js';
import { DEFAULT_METER_POLICY, recordSpend } from '../server/meter.js';
import {
  requestModelRequest,
  ModelRequestError,
  type ModelRequest,
} from '../server/provider.js';
import type { ApiKeyRoute, GatewayRoute, LocalOpenAiCompatibleRoute } from '../llm/modelRoutes.js';

const USER_KEY = 'sk-USER-SECRET-9f3a2b';

const gatewayRoute: GatewayRoute = {
  kind: 'gateway',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://gateway.sequence.dev',
  gatewayLive: true,
};

const localRoute: LocalOpenAiCompatibleRoute = {
  kind: 'local-openai-compatible',
  model: 'local-model',
  baseUrl: 'http://127.0.0.1:11434',
};

const apiRoute: ApiKeyRoute = {
  kind: 'api-key',
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: USER_KEY,
};

test('usageExtraction: OpenAI-compatible reports tokens and cache hit', () => {
  const usage = extractProviderUsage('openai-compatible', {
    choices: [{ message: { content: 'hi' } }],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      prompt_tokens_details: { cached_tokens: 400 },
    },
  });
  assert.ok(usage);
  assert.strictEqual(usage!.inputTokens, 1200);
  assert.strictEqual(usage!.outputTokens, 80);
  assert.strictEqual(usage!.cachedInputTokens, 400);
  assert.strictEqual(usage!.cacheOutcome, 'hit');
});

test('usageExtraction: Anthropic reports cache write', () => {
  const usage = extractProviderUsage('anthropic', {
    content: [{ type: 'text', text: 'ok' }],
    usage: {
      input_tokens: 500,
      output_tokens: 60,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 0,
    },
  });
  assert.ok(usage);
  assert.strictEqual(usage!.cacheOutcome, 'write');
});

test('costEstimate: versioned estimate is deterministic', () => {
  const cost = estimateCostUsd(5000, 1000, 2000);
  assert.ok(cost > 0);
  assert.strictEqual(COST_ESTIMATE_VERSION, 1);
  assert.ok(reserveEstimateUsd(5000) >= cost);
});

test('spendLedger: concurrent reservations cannot overshoot hard cap', () => {
  let committed = 49.98;
  const ledger = createSpendLedger(
    { hardCapUsd: 50 },
    () => committed,
    (usd) => {
      committed = usd;
    },
  );

  const r1 = ledger.tryReserve(0.01);
  const r2 = ledger.tryReserve(0.01);
  const r3 = ledger.tryReserve(0.01);
  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r3.allowed, false);

  if (r1.allowed) ledger.reconcile(r1.reservation.id, 0.004);
  if (r2.allowed) ledger.reconcile(r2.reservation.id, 0.003);

  const diag = ledger.diagnostics();
  assert.ok(diag.maxConcurrentOvershootUsd >= 0);
  assert.strictEqual(diag.capRejections, 1);
  assert.ok(committed <= 50);
  assert.strictEqual(diag.activeReservations, 0);
  assert.ok(diag.committedUsd + diag.reservedUsd <= 50);
});

test('canReserveSpend: pure admission check', () => {
  assert.strictEqual(canReserveSpend(49.95, 0.03, 0.03, 50), false);
  assert.strictEqual(canReserveSpend(49.0, 0.05, 0.02, 50), true);
});

test('recordSpend: advances cumulative axis without monthly counter', () => {
  const next = recordSpend({ usedThisMonth: 5, monthYear: '2026-08', globalSpendToDate: 1 }, '2026-08', 0.002);
  assert.strictEqual(next.usedThisMonth, 5);
  assert.ok(Math.abs(next.globalSpendToDate - 1.002) < 1e-9);
});

test('requestModelRequest: provider-reported tokens marked not estimated', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'provider-usage-ok' } }],
        usage: { prompt_tokens: 900, completion_tokens: 45 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  try {
    const result = await requestModelRequest(
      { route: gatewayRoute },
      { policy: 'p', currentRequest: 'q' },
    );
    assert.strictEqual(result.usage.length, 1);
    const u = result.usage[0];
    assert.strictEqual(u.status, 'ok');
    assert.strictEqual(u.estimated, false);
    assert.strictEqual(u.inputTokens, 900);
    assert.strictEqual(u.outputTokens, 45);
    assert.strictEqual(u.costEstimated, true);
    assert.ok(u.costUsd !== undefined && u.costUsd > 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('requestModelRequest: failed gateway call releases reservation — no spend charged', async () => {
  let committed = 0;
  const ledger = createSpendLedger(
    { hardCapUsd: DEFAULT_METER_POLICY.globalSpendBackstop },
    () => committed,
    (usd) => {
      committed = usd;
    },
  );

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('error', { status: 503 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        requestModelRequest({ route: gatewayRoute }, { policy: 'p', currentRequest: 'fail' }, { spendLedger: ledger }),
      (e: ModelRequestError) => {
        assert.strictEqual(e.usage.length, 1);
        assert.strictEqual(e.usage[0].status, 'error');
        assert.strictEqual(e.usage[0].reservedCostUsd !== undefined, true);
        assert.strictEqual(e.usage[0].reconciledCostUsd, undefined);
        return true;
      },
    );
    assert.strictEqual(committed, 0);
    assert.strictEqual(ledger.diagnostics().activeReservations, 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('requestModelRequest: blocked at cap records blocked status and charges nothing', async () => {
  let committed = DEFAULT_METER_POLICY.globalSpendBackstop;
  const ledger = createSpendLedger(
    { hardCapUsd: DEFAULT_METER_POLICY.globalSpendBackstop },
    () => committed,
    (usd) => {
      committed = usd;
    },
  );

  const prevFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        requestModelRequest({ route: gatewayRoute }, { policy: 'p', currentRequest: 'blocked' }, { spendLedger: ledger }),
      (e: ModelRequestError) => {
        assert.strictEqual(e.usage[0].status, 'blocked');
        assert.strictEqual(e.usage[0].costUsd, 0);
        return true;
      },
    );
    assert.strictEqual(fetchCalled, false);
    assert.strictEqual(committed, DEFAULT_METER_POLICY.globalSpendBackstop);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('requestModelRequest: local route reports tokens with zero remote spend', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'local-ok' } }],
        usage: { prompt_tokens: 300, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  try {
    const result = await requestModelRequest(
      { route: localRoute },
      { policy: 'p', currentRequest: 'local q' },
      { localOpenAiConsent: true },
    );
    const u = result.usage[0];
    assert.strictEqual(u.routeKind, 'local-openai-compatible');
    assert.strictEqual(u.estimated, false);
    assert.strictEqual(u.costUsd, 0);
    assert.strictEqual(u.costEstimated, false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('requestModelRequest: successful gateway reconciles reservation', async () => {
  let committed = 0;
  const ledger = createSpendLedger(
    { hardCapUsd: 50 },
    () => committed,
    (usd) => {
      committed = usd;
    },
  );

  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  try {
    const result = await requestModelRequest(
      { route: gatewayRoute },
      { policy: 'p', currentRequest: 'charge me' },
      { spendLedger: ledger },
    );
    const u = result.usage[0];
    assert.strictEqual(u.status, 'ok');
    assert.ok(u.reservedCostUsd !== undefined && u.reservedCostUsd > 0);
    assert.ok(u.reconciledCostUsd !== undefined && u.reconciledCostUsd > 0);
    assert.ok(committed > 0);
    assert.strictEqual(ledger.diagnostics().activeReservations, 0);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('summarizeUsageDiagnostics: secret-free local summary', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'diag' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

  try {
    const result = await requestModelRequest({ route: apiRoute }, { policy: 'p', currentRequest: 'x' });
    const summary = summarizeUsageDiagnostics(result.usage);
    const blob = JSON.stringify(summary);
    assert.ok(!blob.includes(USER_KEY));
    assert.strictEqual(summary.attempts.length, 1);
    assert.strictEqual(summary.costEstimateVersion, COST_ESTIMATE_VERSION);
  } finally {
    globalThis.fetch = prevFetch;
  }
});
