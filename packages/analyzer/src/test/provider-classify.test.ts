/**
 * WAVE C1 — RETRY ON AN ALLOW-LIST, QUOTA SEPARATED FROM RATE LIMIT
 * (docs/research/carrying-harness-plan.md).
 *
 * A quota error is an answer, not weather: retrying it four times hides the
 * one sentence the reader needs. These lock the classifier, the sentence each
 * kind carries, the Retry-After parse, and the default retry budget.
 */
import assert from 'node:assert';
import { test } from 'node:test';

import {
  DEFAULT_PROVIDER_RETRIES,
  ProviderError,
  RateLimitError,
  classifyProviderError,
  describeProviderErrorKind,
  isTransientProviderFailure,
  parseRetryAfterMs,
} from '../server/provider.js';

test('status alone classifies auth, bad request, not found, rate limit, overload and server', () => {
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 401 })), 'auth');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 403 })), 'auth');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 400 })), 'bad_request');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 404 })), 'not_found');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 429 })), 'rate_limited');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 503 })), 'overloaded');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 500 })), 'server');
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 413 })), 'too_large');
});

test('quota is read off a 402, off a 429 whose body says the credits are gone, and off our own cap', () => {
  assert.strictEqual(classifyProviderError(new ProviderError('x', { status: 402 })), 'quota');
  assert.strictEqual(
    classifyProviderError(new ProviderError('x', { status: 429, body: '{"error":"insufficient_quota"}' })),
    'quota',
  );
  assert.strictEqual(
    classifyProviderError(new ProviderError('x', { status: 400, body: 'Your credits are exhausted' })),
    'quota',
  );
  assert.strictEqual(classifyProviderError(new RateLimitError()), 'quota');
});

test('quota is never transient; a plain 429 and a 503 still are; 401 never was', () => {
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 402 })), false);
  assert.strictEqual(
    isTransientProviderFailure(new ProviderError('x', { status: 429, body: 'insufficient_quota' })),
    false,
  );
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 429 })), true);
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 503 })), true);
  assert.strictEqual(isTransientProviderFailure(new ProviderError('x', { status: 401 })), false);
});

test('transport and timeout failures classify from their message', () => {
  assert.strictEqual(
    classifyProviderError(new ProviderError('provider request failed: fetch failed (http://127.0.0.1:1)')),
    'network',
  );
  assert.strictEqual(
    classifyProviderError(new ProviderError('provider did not answer within 1000 ms (Advanced › Timeout)')),
    'timeout',
  );
  assert.strictEqual(classifyProviderError(new Error('something else')), 'unknown');
});

test('every kind carries one plain sentence, and none of them is empty', () => {
  const kinds = [
    'auth', 'bad_request', 'not_found', 'quota', 'rate_limited', 'overloaded', 'server', 'timeout',
    'network', 'too_large', 'reasoning_only', 'empty', 'unknown',
  ] as const;
  const seen = new Set<string>();
  for (const k of kinds) {
    const s = describeProviderErrorKind(k);
    assert.ok(s.length > 20, k);
    seen.add(s);
  }
  assert.strictEqual(seen.size, kinds.length, 'each kind says something different');
  assert.match(describeProviderErrorKind('quota'), /retrying will not help/);
});

test('Retry-After parses seconds and an HTTP date, and ignores junk', () => {
  assert.strictEqual(parseRetryAfterMs('7'), 7000);
  assert.strictEqual(parseRetryAfterMs(null), undefined);
  assert.strictEqual(parseRetryAfterMs('soon'), undefined);
  const inFuture = new Date(Date.now() + 5000).toUTCString();
  const ms = parseRetryAfterMs(inFuture)!;
  assert.ok(ms > 2000 && ms <= 5000, String(ms));
});

test("the app default retry budget is two; the primitive itself still sends once", () => {
  assert.strictEqual(DEFAULT_PROVIDER_RETRIES, 2);
});
