import assert from 'node:assert';
import { test } from 'node:test';
import {
  resolveEndpoint,
  validateAiConfig,
  redactAiConfig,
  generateText,
  openaiCompatChatUrl,
  openRouterModelId,
  isOpenRouterBase,
  readAiEnvPrefill,
  aiConfigFromEnv,
  DEFAULT_GATEWAY_URL,
  DEFAULT_MODEL,
  type AiConfig,
} from '../server/provider.js';
import { startMockProvider } from './mock-provider.js';

/**
 * v9 Phase 2 — the FREE metered default's provider-mode abstraction.
 *
 * Two honesty properties are locked here:
 *   1. api-key mode is BYTE-IDENTICAL to pre-v9 (same URLs + headers + wire), and
 *      a mode-less config takes that exact path (backward-compat).
 *   2. `'default'` mode round-trips through a MOCK gateway (OpenAI-compatible) and
 *      carries NO user secret and NO funded key — only an optional app token.
 *
 * The real funded gateway is a deploy step outside this build (the one unverified
 * seam); here it is a localhost mock, exactly as the BYO-key path is mock-verified.
 */

const USER_KEY = 'sk-USER-SECRET-9f3a2b';

/* ------------------------------------------------ resolveEndpoint (the chokepoint) */

test('resolveEndpoint: api-key anthropic is byte-identical (x-api-key + /v1/messages)', () => {
  const cfg: AiConfig = { provider: 'anthropic', model: 'claude-x', apiKey: USER_KEY };
  const { url, headers } = resolveEndpoint(cfg);
  assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(headers['x-api-key'], USER_KEY);
  assert.strictEqual(headers['anthropic-version'], '2023-06-01');
  assert.ok(!('authorization' in headers), 'anthropic uses x-api-key, never Bearer');
});

test('resolveEndpoint: a MODE-LESS config takes the api-key path (backward-compat)', () => {
  const cfg = { provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'm', apiKey: USER_KEY } as AiConfig;
  const { url, headers } = resolveEndpoint(cfg);
  assert.strictEqual(url, 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(headers.authorization, `Bearer ${USER_KEY}`);
});

test('resolveEndpoint: OpenRouter base ending in /v1 does NOT double /v1 (the BYO 404)', () => {
  const cfg: AiConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek-v4-flash',
    apiKey: USER_KEY,
  };
  const { url, headers } = resolveEndpoint(cfg);
  assert.strictEqual(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.ok(!url.includes('/v1/v1/'), 'must not double /v1');
  assert.strictEqual(headers.authorization, `Bearer ${USER_KEY}`);
  assert.strictEqual(headers['HTTP-Referer'], 'https://sequence.dev');
  assert.strictEqual(headers['X-Title'], 'Sequence');
});

test('OpenRouter BYO: remaps deepseek-v4-flash on the wire + env prefill never leaks the key', async () => {
  assert.strictEqual(openRouterModelId('deepseek-v4-flash'), 'deepseek/deepseek-v4-flash');
  assert.strictEqual(openRouterModelId(DEFAULT_MODEL), 'deepseek/deepseek-v4-flash');
  assert.strictEqual(openRouterModelId('deepseek/deepseek-v4-flash'), 'deepseek/deepseek-v4-flash');
  assert.strictEqual(
    openaiCompatChatUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/chat/completions',
  );
  assert.strictEqual(openaiCompatChatUrl('https://api.deepseek.com'), 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(isOpenRouterBase('https://openrouter.ai/api/v1'), true);
  assert.strictEqual(isOpenRouterBase('https://api.deepseek.com'), false);

  let sawUrl = '';
  let sawBody: { model?: string } = {};
  let sawHeaders: Record<string, string> = {};
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sawUrl = String(_input);
    sawHeaders = (init?.headers ?? {}) as Record<string, string>;
    sawBody = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'from-or' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const text = await generateText(
      {
        provider: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'deepseek-v4-flash',
        apiKey: USER_KEY,
      },
      'hi',
    );
    assert.strictEqual(text, 'from-or');
    assert.strictEqual(sawUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.strictEqual(sawBody.model, 'deepseek/deepseek-v4-flash');
    assert.strictEqual(sawHeaders.authorization, `Bearer ${USER_KEY}`);
    assert.strictEqual(sawHeaders['HTTP-Referer'], 'https://sequence.dev');
    assert.strictEqual(sawHeaders['X-Title'], 'Sequence');
  } finally {
    globalThis.fetch = prevFetch;
  }

  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-SECRET-should-not-leak';
  try {
    const pre = readAiEnvPrefill();
    assert.ok(pre);
    assert.strictEqual(pre!.keyEnv, 'OPENROUTER_API_KEY');
    assert.strictEqual(pre!.provider, 'openai-compatible');
    assert.ok(pre!.baseUrl?.includes('openrouter.ai'));
    assert.ok(!JSON.stringify(pre).includes('SECRET'));
    const fromEnv = aiConfigFromEnv();
    assert.ok(fromEnv?.apiKey?.includes('SECRET'));
    const red = redactAiConfig(fromEnv!);
    assert.ok(!JSON.stringify(red).includes('SECRET'));
    assert.ok(String((red as { apiKey?: string }).apiKey).startsWith('••••'));
  } finally {
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
  }
});

test('resolveEndpoint: default mode → gateway /v1/chat/completions, NO user key, NO funded key', () => {
  const cfg: AiConfig = { mode: 'default', provider: 'openai-compatible', baseUrl: DEFAULT_GATEWAY_URL, model: DEFAULT_MODEL };
  const { url, headers } = resolveEndpoint(cfg);
  assert.strictEqual(url, `${DEFAULT_GATEWAY_URL}/v1/chat/completions`);
  // No app token in the env here ⇒ no auth header at all; and never a user secret.
  assert.ok(!('authorization' in headers), 'no app token set ⇒ no auth header');
  assert.ok(!('x-api-key' in headers));
  assert.ok(!JSON.stringify(headers).includes(USER_KEY));
});

test('resolveEndpoint: default mode picks up an APP token from the env (never a user/funded key)', () => {
  const prev = process.env.SEQUENCE_GATEWAY_TOKEN;
  process.env.SEQUENCE_GATEWAY_TOKEN = 'app-instance-token-123';
  try {
    const cfg: AiConfig = { mode: 'default', provider: 'openai-compatible', baseUrl: DEFAULT_GATEWAY_URL, model: DEFAULT_MODEL };
    const { headers } = resolveEndpoint(cfg);
    assert.strictEqual(headers.authorization, 'Bearer app-instance-token-123');
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_GATEWAY_TOKEN;
    else process.env.SEQUENCE_GATEWAY_TOKEN = prev;
  }
});

/* ------------------------------------------------ validate / redact (mode-aware) */

test('validateAiConfig: a mode-less body → api-key config with NO mode field (byte-identical)', () => {
  const { config, error } = validateAiConfig({ provider: 'anthropic', model: 'claude-x', apiKey: USER_KEY });
  assert.strictEqual(error, undefined);
  assert.ok(config);
  assert.strictEqual(config!.mode, undefined, 'no mode field is added to an api-key config');
  assert.strictEqual(config!.apiKey, USER_KEY);
});

test('validateAiConfig: {mode:"default"} → gateway config, default model, NO apiKey', () => {
  const { config, error } = validateAiConfig({ mode: 'default' });
  assert.strictEqual(error, undefined);
  assert.strictEqual(config!.mode, 'default');
  assert.strictEqual(config!.provider, 'openai-compatible');
  assert.strictEqual(config!.baseUrl, DEFAULT_GATEWAY_URL);
  assert.strictEqual(config!.model, DEFAULT_MODEL);
  assert.strictEqual(config!.apiKey, undefined, 'the default carries no user key');
});

test('validateAiConfig: default mode accepts an optional model override', () => {
  const { config } = validateAiConfig({ mode: 'default', model: 'glm-4.6' });
  assert.strictEqual(config!.model, 'glm-4.6');
});

test('validateAiConfig: an unknown mode is rejected', () => {
  const { config, error } = validateAiConfig({ mode: 'subscription', provider: 'anthropic', model: 'm', apiKey: 'k' });
  assert.strictEqual(config, undefined);
  assert.match(error!, /mode/);
});

test('validateAiConfig: keyless OpenAI-compatible is a loopback-only local config', () => {
  const { config, error } = validateAiConfig({
    mode: 'api-key',
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'granite4-hermes:latest',
  });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(config, {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'granite4-hermes:latest',
  });
});

test('resolveEndpoint: keyless private-LAN OpenAI-compatible is refused', () => {
  assert.throws(
    () => resolveEndpoint({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.44:11434/v1',
      model: 'local-model',
    }),
    /apiKey|loopback/,
  );
});

test('validateAiConfig: keyless private-LAN OpenAI-compatible is refused as non-loopback', () => {
  const { config, error } = validateAiConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://192.168.1.44:11434/v1',
    model: 'local-model',
  });
  assert.strictEqual(config, undefined);
  assert.match(error!, /loopback/);
});

test('resolveEndpoint: keyless loopback sends no Authorization header', () => {
  const { url, headers } = resolveEndpoint({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'local-model',
  });
  assert.strictEqual(url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.ok(!('authorization' in headers));
  assert.deepStrictEqual(headers, { 'content-type': 'application/json' });
});

test('redactAiConfig: default mode → {configured, mode, model, gatewayLive} with NO key field', () => {
  // No gateway stamped ⇒ the free tier is NOT live, and the view says so. This is
  // the field the web's freeTierLive() honesty check reads: before r179 the
  // server never stamped it, so a real deployed gateway still read "not live".
  const red = redactAiConfig({ mode: 'default', provider: 'openai-compatible', baseUrl: DEFAULT_GATEWAY_URL, model: DEFAULT_MODEL });
  assert.deepStrictEqual(red, { configured: true, mode: 'default', model: DEFAULT_MODEL, gatewayLive: false });
  assert.ok(!('apiKey' in red));
});

test('redactAiConfig: a LIVE gateway stamp reaches the client as gatewayLive:true — never the URL or a key', () => {
  const red = redactAiConfig({
    mode: 'default',
    provider: 'openai-compatible',
    baseUrl: 'https://gateway.internal.example/v1',
    model: DEFAULT_MODEL,
    gatewayLive: true,
  }) as Record<string, unknown>;
  assert.strictEqual(red.gatewayLive, true, 'a configured gateway reads live');
  assert.deepStrictEqual(red, { configured: true, mode: 'default', model: DEFAULT_MODEL, gatewayLive: true });
  const asText = JSON.stringify(red);
  assert.ok(!asText.includes('gateway.internal.example'), 'the gateway host never crosses the wire');
  assert.ok(!asText.includes(USER_KEY) && !asText.includes('sk-'), 'no key material of any kind');
});

test('redactAiConfig: api-key mode is byte-identical to pre-v9 (masked key, no mode field)', () => {
  const red = redactAiConfig({ provider: 'anthropic', model: 'claude-x', apiKey: USER_KEY }) as Record<string, unknown>;
  assert.strictEqual(red.configured, true);
  assert.strictEqual(red.provider, 'anthropic');
  assert.strictEqual(red.model, 'claude-x');
  assert.ok(String(red.apiKey).startsWith('••••'));
  assert.ok(!('mode' in red), 'no mode field leaks into an api-key redaction');
  assert.ok(!String(red.apiKey).includes(USER_KEY));
});

test('redactAiConfig: a key shorter than the visible suffix is fully hidden', () => {
  const red = redactAiConfig({ provider: 'anthropic', model: 'claude-x', apiKey: 'abc' }) as Record<string, unknown>;
  assert.strictEqual(red.apiKey, '••••');
  assert.ok(!JSON.stringify(red).includes('abc'), 'a short key is still a key');
});

test('redactAiConfig: a short role key is fully hidden too', () => {
  const red = redactAiConfig({
    provider: 'anthropic',
    model: 'claude-x',
    apiKey: 'long-enough-key',
    roles: { advisor: { model: 'claude-y', apiKey: 'xy' } },
  }) as { roles?: { advisor?: { apiKey?: string } } };
  assert.strictEqual(red.roles?.advisor?.apiKey, '••••');
  assert.ok(!JSON.stringify(red).includes('xy'), 'a short role key is still a key');
});

test('redactAiConfig: a keyless loopback config has no apiKey field to mask', () => {
  const red = redactAiConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'local-model',
  }) as Record<string, unknown>;
  assert.deepStrictEqual(red, {
    configured: true,
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'local-model',
  });
  assert.ok(!('apiKey' in red), 'absence represents keyless; an empty mask would claim a credential exists');
});

/* ------------------------------------------------ default mode round-trips a mock gateway */

test('default mode round-trips through a MOCK gateway (openai wire) and carries NO user secret', async () => {
  const gateway = await startMockProvider(() => ({ text: 'hello from the gateway' }), 'openai');
  try {
    // A default-mode config pointed at the mock gateway — the exact shape the
    // server builds, with the gateway base URL substituted AND the gatewayLive
    // stamp set (the test/deploy seam; v18 honest free-tier gate keys on the stamp).
    const cfg: AiConfig = { mode: 'default', provider: 'openai-compatible', baseUrl: gateway.baseUrl, model: DEFAULT_MODEL, gatewayLive: true };
    const text = await generateText(cfg, 'explain this repo');
    assert.strictEqual(text, 'hello from the gateway');

    assert.strictEqual(gateway.requests.length, 1);
    const req = gateway.requests[0];
    // The request hit the OpenAI-compatible path, named the default model, and
    // carried the prompt — but NEVER a user key or a funded key.
    const bodyStr = JSON.stringify(req.body);
    assert.ok(bodyStr.includes(DEFAULT_MODEL));
    assert.ok(bodyStr.includes('explain this repo'));
    assert.ok(!('x-api-key' in req.headers), 'no anthropic key header to a gateway');
    // No SEQUENCE_GATEWAY_TOKEN set ⇒ no Authorization header, and certainly no user secret.
    assert.ok(!('authorization' in req.headers));
    assert.ok(!bodyStr.includes('sk-'), 'no api key material anywhere in the body');
  } finally {
    await gateway.close();
  }
});

test('aiConfigFromEnv: SEQUENCE_AI_MAX_RETRIES reaches params, clamped, and absent means absent', () => {
  const base = {
    SEQUENCE_AI_KEY: 'k',
    SEQUENCE_AI_PROVIDER: 'openai-compatible',
    SEQUENCE_AI_BASE_URL: 'https://openrouter.ai/api/v1',
    SEQUENCE_AI_MODEL: 'minimax/minimax-m3:free',
  } as NodeJS.ProcessEnv;

  // Absent ⇒ no params object at all — byte-identical old behaviour.
  assert.strictEqual(aiConfigFromEnv(base)?.params, undefined);

  // Set ⇒ retries reach the retry machinery that always existed.
  assert.deepStrictEqual(
    aiConfigFromEnv({ ...base, SEQUENCE_AI_MAX_RETRIES: '3' })?.params,
    { maxRetries: 3 },
  );
  // Clamped to the same AI_PARAM_BOUNDS ceiling the app enforces.
  assert.deepStrictEqual(
    aiConfigFromEnv({ ...base, SEQUENCE_AI_MAX_RETRIES: '99' })?.params,
    { maxRetries: 5 },
  );
  // Garbage ⇒ ignored, never a NaN in the config.
  assert.strictEqual(
    aiConfigFromEnv({ ...base, SEQUENCE_AI_MAX_RETRIES: 'lots' })?.params,
    undefined,
  );
});

test('aiConfigFromEnv: SEQUENCE_AI_TEMPERATURE pins decoding; junk and out-of-range are refused', async () => {
  const { aiConfigFromEnv } = await import('../server/provider.js');
  const base = {
    SEQUENCE_AI_KEY: 'sk-x',
    SEQUENCE_AI_PROVIDER: 'openai-compatible',
    SEQUENCE_AI_BASE_URL: 'https://example.test/v1',
    SEQUENCE_AI_MODEL: 'm',
  };
  const pinned = aiConfigFromEnv({ ...base, SEQUENCE_AI_TEMPERATURE: '0' });
  assert.strictEqual(pinned?.params?.temperature, 0);
  const combined = aiConfigFromEnv({
    ...base,
    SEQUENCE_AI_TEMPERATURE: '0.2',
    SEQUENCE_AI_MAX_RETRIES: '3',
  });
  assert.strictEqual(combined?.params?.temperature, 0.2);
  assert.strictEqual(combined?.params?.maxRetries, 3);
  for (const bad of ['9', '-1', 'warm', '']) {
    const cfg = aiConfigFromEnv({ ...base, SEQUENCE_AI_TEMPERATURE: bad });
    assert.strictEqual(cfg?.params?.temperature, undefined, `refused: ${bad}`);
  }
});
