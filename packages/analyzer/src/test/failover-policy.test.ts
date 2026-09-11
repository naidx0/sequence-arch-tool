/**
 * ADR-013 Phase B — failover policy matrix and usage records without secrets.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  canFailover,
  isTransientProviderFailure,
  failoverBlockedDiagnostic,
  type FailoverContext,
} from '../llm/failover.js';
import {
  LOCAL_OPENAI_CONSENT_REQUIRED_MSG,
  assertLocalOpenAiRoute,
  isLoopbackOrPrivateHost,
  type ApiKeyRoute,
  type GatewayRoute,
  type LocalOpenAiCompatibleRoute,
} from '../llm/modelRoutes.js';
import {
  ProviderError,
  RateLimitError,
  requestModelRequest,
  ModelRequestError,
  type ModelRequest,
} from '../server/provider.js';

const USER_KEY = 'sk-USER-SECRET-9f3a2b';

const apiRoute: ApiKeyRoute = {
  kind: 'api-key',
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: USER_KEY,
};

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

function ctx(overrides: Partial<FailoverContext> = {}): FailoverContext {
  return {
    primary: localRoute,
    alternate: apiRoute,
    privacyBoundary: 'local',
    sideEffectsStarted: false,
    ...overrides,
  };
}

test('failover: transient 503 allows failover; 401 blocks', () => {
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 503 })), true);
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 401 })), false);
  assert.strictEqual(isTransientProviderFailure(new ProviderError('provider request failed: timeout')), true);
  assert.strictEqual(isTransientProviderFailure(new RateLimitError()), false);
});

test('failover: local→remote upgrade is blocked', () => {
  const blocked = canFailover(ctx(), new ProviderError('x', { status: 503 }));
  assert.strictEqual(blocked, false);
  const diag = failoverBlockedDiagnostic(ctx(), new ProviderError('x', { status: 503 }));
  assert.match(diag.message ?? '', /local route cannot upgrade to remote/i);
});

test('failover: remote primary can failover to remote alternate on 503', () => {
  const ok = canFailover(
    {
      primary: apiRoute,
      alternate: gatewayRoute,
      privacyBoundary: 'remote',
      sideEffectsStarted: false,
    },
    new ProviderError('x', { status: 503 }),
  );
  assert.strictEqual(ok, true);
});

test('failover: side effects block failover', () => {
  assert.strictEqual(
    canFailover(ctx({ sideEffectsStarted: true }), new ProviderError('x', { status: 503 })),
    false,
  );
});

test('local-openai: loopback/private host validation + consent flag', () => {
  assert.strictEqual(isLoopbackOrPrivateHost('127.0.0.1'), true);
  assert.strictEqual(isLoopbackOrPrivateHost('192.168.1.5'), true);
  assert.strictEqual(isLoopbackOrPrivateHost('api.openai.com'), false);
  assert.throws(() => assertLocalOpenAiRoute(localRoute), (e: Error) => e.message === LOCAL_OPENAI_CONSENT_REQUIRED_MSG);
  assert.throws(
    () =>
      assertLocalOpenAiRoute({
        kind: 'local-openai-compatible',
        model: 'm',
        baseUrl: 'https://api.openai.com',
      }),
    /loopback or private host/i,
  );
  assert.doesNotThrow(() => assertLocalOpenAiRoute(localRoute, true));
});

test('requestModelRequest: usage records carry route kind, latency, failover count — no secrets', async () => {
  let call = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    call++;
    if (call === 1) {
      return new Response('upstream error', { status: 503 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'failover-ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const request: ModelRequest = {
    route: apiRoute,
    alternates: [gatewayRoute],
  };
  const usageRecords: unknown[] = [];

  try {
    const result = await requestModelRequest(
      request,
      { policy: 'test policy', currentRequest: 'hello' },
      { onUsage: (r) => usageRecords.push(r) },
    );
    assert.strictEqual(result.text, 'failover-ok');
    assert.strictEqual(result.usage.length, 2);
    assert.strictEqual(result.usage[0].status, 'error');
    assert.strictEqual(result.usage[0].failoverCount, 0);
    assert.strictEqual(result.usage[1].status, 'ok');
    assert.strictEqual(result.usage[1].failoverCount, 1);
    assert.ok(result.usage[1].latencyMs !== undefined);
    assert.strictEqual(result.usage[1].routeKind, 'gateway');
    const blob = JSON.stringify([result.usage, result.routeDiagnostics, usageRecords]);
    assert.ok(!blob.includes(USER_KEY));
    assert.ok(!blob.includes('SECRET'));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('requestModelRequest: auth failure does not failover', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('unauthorized', { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        requestModelRequest(
          { route: apiRoute, alternates: [gatewayRoute] },
          { policy: 'p', currentRequest: 'q' },
        ),
      (e: ModelRequestError) => {
        assert.strictEqual(e.name, 'ModelRequestError');
        assert.strictEqual(e.usage.length, 1);
        assert.match(JSON.stringify(e.routeDiagnostics), /failover blocked|authentication/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('an answerless 200 is transient — a flaked free-tier generation is retried under the caller budget', () => {
  assert.strictEqual(
    isTransientProviderFailure(
      new ProviderError('could not locate assistant text in the provider response'),
    ),
    true,
  );
  // …but a normal parse error is not.
  assert.strictEqual(
    isTransientProviderFailure(new ProviderError('provider response was not valid JSON')),
    false,
  );
});
