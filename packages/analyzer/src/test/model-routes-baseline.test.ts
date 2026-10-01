/**
 * ADR-013 Phase A — lock the baseline before route/prompt architecture changes.
 *
 * Locks:
 *   - AiConfig → typed route mapping (api-key / gateway)
 *   - secret redaction on routes and AiConfig
 *   - ACP session cache cap/TTL constants
 *   - prompt-budget omission marker shape
 *   - cold-turn token estimate for a fixed shopfront explain fixture
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest, buildExplainPrompt } from '../explain/explain.js';
import {
  approxTokens,
  omissionMarker,
  cutToBudget,
} from '../llm/tokenBudget.js';
import {
  routeFromAiConfig,
  redactRoute,
  assertSubscriptionOAuthAvailable,
  MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG,
  type ApiKeyRoute,
  type GatewayRoute,
  type LocalOpenAiCompatibleRoute,
  type ModelSubscriptionOAuthRoute,
} from '../llm/modelRoutes.js';
import {
  redactAiConfig,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MODEL,
  type AiConfig,
} from '../server/provider.js';
import {
  ACP_SESSION_IDLE_TTL_MS,
  ACP_SESSION_MAX,
} from '../server/acpSessionCache.js';

const USER_KEY = 'sk-USER-SECRET-9f3a2b';
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const SHOPFRONT = path.join(FIXTURES, 'shopfront');
const BASELINE_DIR = path.join(FIXTURES, 'model-routes-baseline');

/* ========================================= route mapping (AiConfig → union) === */

test('routeFromAiConfig: mode-less / api-key → api-key route', () => {
  const cfg: AiConfig = { provider: 'anthropic', model: 'claude-x', apiKey: USER_KEY };
  const route = routeFromAiConfig(cfg);
  assert.strictEqual(route.kind, 'api-key');
  const api = route as ApiKeyRoute;
  assert.strictEqual(api.provider, 'anthropic');
  assert.strictEqual(api.model, 'claude-x');
  assert.strictEqual(api.apiKey, USER_KEY);
  assert.strictEqual(api.baseUrl, undefined);
});

test('routeFromAiConfig: openai-compatible api-key carries baseUrl', () => {
  const cfg: AiConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: USER_KEY,
  };
  const route = routeFromAiConfig(cfg);
  assert.strictEqual(route.kind, 'api-key');
  assert.strictEqual((route as ApiKeyRoute).baseUrl, 'https://api.deepseek.com');
});

test('routeFromAiConfig: default mode → gateway route', () => {
  const cfg: AiConfig = {
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: DEFAULT_GATEWAY_URL,
    model: DEFAULT_MODEL,
    gatewayLive: true,
  };
  const route = routeFromAiConfig(cfg);
  assert.strictEqual(route.kind, 'gateway');
  const gw = route as GatewayRoute;
  assert.strictEqual(gw.model, DEFAULT_MODEL);
  assert.strictEqual(gw.baseUrl, DEFAULT_GATEWAY_URL);
  assert.strictEqual(gw.gatewayLive, true);
});

test('routeFromAiConfig: default mode without gatewayLive stamp is still gateway (honesty is wire-time)', () => {
  const route = routeFromAiConfig({
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: DEFAULT_GATEWAY_URL,
    model: DEFAULT_MODEL,
  });
  assert.strictEqual(route.kind, 'gateway');
  assert.strictEqual((route as GatewayRoute).gatewayLive, false);
});

test('routeFromAiConfig: keyless loopback config maps to the local route, not api-key', () => {
  const route = routeFromAiConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'local-model',
  });
  assert.deepStrictEqual(route, {
    kind: 'local-openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'local-model',
  });
});

/* ========================================= secret redaction ================== */

test('redactRoute: api-key route never carries the key', () => {
  const route: ApiKeyRoute = {
    kind: 'api-key',
    provider: 'anthropic',
    model: 'claude-x',
    apiKey: USER_KEY,
    baseUrl: 'https://api.anthropic.com',
  };
  const diag = redactRoute(route);
  const text = JSON.stringify(diag);
  assert.ok(!text.includes(USER_KEY));
  assert.ok(!text.includes('sk-'));
  assert.strictEqual(diag.routeKind, 'api-key');
  assert.strictEqual(diag.host, 'api.anthropic.com');
});

test('redactRoute: gateway route exposes host only, never full URL secrets', () => {
  const diag = redactRoute({
    kind: 'gateway',
    model: DEFAULT_MODEL,
    baseUrl: DEFAULT_GATEWAY_URL,
    gatewayLive: true,
  });
  assert.strictEqual(diag.host, 'gateway.sequence.dev');
  assert.ok(!JSON.stringify(diag).includes('Bearer'));
});

test('redactRoute: local-openai-compatible masks optional key material', () => {
  const diag = redactRoute({
    kind: 'local-openai-compatible',
    model: 'local-model',
    baseUrl: 'http://127.0.0.1:11434',
    apiKey: USER_KEY,
  } satisfies LocalOpenAiCompatibleRoute);
  assert.ok(!JSON.stringify(diag).includes(USER_KEY));
  assert.strictEqual(diag.host, '127.0.0.1');
});

test('redactAiConfig + redactRoute: secrets stay out of client-visible shapes', () => {
  const cfg: AiConfig = { provider: 'anthropic', model: 'm', apiKey: USER_KEY };
  const redCfg = redactAiConfig(cfg);
  const redRoute = redactRoute(routeFromAiConfig(cfg));
  for (const view of [JSON.stringify(redCfg), JSON.stringify(redRoute)]) {
    assert.ok(!view.includes(USER_KEY), 'user key must not leak');
    assert.ok(!view.includes('9f3a2b'), 'key suffix must not leak');
  }
});

/* ========================================= subscription OAuth fails closed === */

test('model-subscription-oauth: typed route exists but fails closed with actionable error', () => {
  const route: ModelSubscriptionOAuthRoute = {
    kind: 'model-subscription-oauth',
    providerId: 'example',
    model: 'example-model',
  };
  const diag = redactRoute(route);
  assert.match(diag.message ?? '', /not available/i);
  assert.throws(
    () => assertSubscriptionOAuthAvailable(route),
    (e: Error) => e.message === MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG,
  );
});

/* ========================================= ACP cache constants (locked) ====== */

test('ACP session cache: idle TTL is 10 minutes and cap is 8 sessions', () => {
  assert.strictEqual(ACP_SESSION_IDLE_TTL_MS, 10 * 60 * 1000);
  assert.strictEqual(ACP_SESSION_MAX, 8);
});

/* ========================================= prompt budget omission markers === */

test('tokenBudget: omission marker shape is stable', () => {
  assert.strictEqual(omissionMarker(3), '…3 more lines omitted to fit the model budget');
  assert.strictEqual(
    omissionMarker(42, 'components'),
    '…42 more components omitted to fit the model budget',
  );
  const cut = cutToBudget(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)], 10);
  assert.ok(cut.omitted > 0);
  assert.match(cut.lines[cut.lines.length - 1], /…\d+ more lines omitted to fit the model budget/);
});

/* ========================================= cold-turn baseline (Sequence) === */

test('baseline: cold single-turn explain prompt token estimate (shopfront fixture)', async () => {
  const meta = JSON.parse(readFileSync(path.join(BASELINE_DIR, 'cold-turn.json'), 'utf8')) as {
    fixture: string;
    userQuestion?: string;
  };
  assert.strictEqual(meta.fixture, 'shopfront');

  const graph = await scanRepo(SHOPFRONT, {});
  const digest = buildDigest(graph);
  const prompt = buildExplainPrompt(digest);
  const tokens = approxTokens(prompt);

  /*
   * Recorded on 2026-08-05 from shopfront → buildExplainPrompt (chars/4
   * heuristic). Update only when the fixture or prompt assembly intentionally
   * changes.
   *
   * 3029 → 3031 on 2026-08-22. The graph got MORE ACCURATE, not bigger: Go's
   * `mux.HandleFunc("/shipments/", …)` registers a subtree, so the gateway's
   * call to `/shipments/{id}` now matches that route. The edge resolves to
   * `shipping/main.go` at confidence 0.95 instead of degrading to `svc:shipping`
   * at 0.75 with `matchedRoute: null`, and naming the matched route is the two
   * tokens.
   *
   * Recorded rather than silenced because this test's whole job is to make a
   * prompt-size change a decision. Two tokens for a real edge is a trade worth
   * writing down.
   */
  /*
   * 3031 -> 3055 on 2026-09-04, same trade as the line above and a larger one:
   * 24 tokens (+0.8%) for the `payments -> postgres [db_access]` edge that
   * new_expression collection recovered. The graph gained one edge, not bulk —
   * node count is unchanged and no other fixture edge moved.
   */
  const BASELINE_COLD_TURN_TOKENS = 3055;

  assert.strictEqual(
    tokens,
    BASELINE_COLD_TURN_TOKENS,
    `cold-turn baseline drifted (${tokens} vs ${BASELINE_COLD_TURN_TOKENS}) — update ADR-013 baseline if intentional`,
  );
  assert.ok(tokens > 0);
  assert.ok(prompt.length > 500, 'fixture prompt is non-trivial');
});
