/**
 * THE KNOBS AROUND THE MODEL, AND THE MODELS AROUND THE KNOBS.
 *
 * Two defects, one config object.
 *
 * (1) NO KNOBS. The complete request body for a real ask was `{model, messages}`
 *     (+ a hardcoded `max_tokens: 8192` on the anthropic wire only). No
 *     temperature, no output cap the reader controls, and — the one that
 *     actually hurt — NO TIMEOUT ON A PROVIDER CALL AT ALL. The only
 *     `AbortSignal` in the ask chain came from `requestAbort(res)`, whose sole
 *     trigger is `res.on('close')`, i.e. the browser tab closing. A stalled
 *     local generation hung until the user closed the tab, while `doctor.ts` had
 *     used `AbortSignal.timeout(20_000)` for its probe all along.
 *
 * (2) ONE MODEL. The whole persisted model state was one flat object. No named
 *     configs, no default, nothing to switch between: changing your mind meant
 *     retyping provider + model + baseUrl + key.
 *
 * WHAT THESE FIXTURES ARE CAREFUL ABOUT. The body assertions are `deepEqual`
 * against the WHOLE body, not `ok(body.temperature)`, because the property that
 * matters for a picky local server (llama.cpp, LM Studio, older vLLM all 400 on
 * unexpected fields) is that an unset knob sends NO FIELD — which only a
 * whole-body comparison can see. The keyless-loopback rule is checked on a
 * PROFILE as well as on a lone config, because a profile is just as capable of
 * pointing repository context at another machine.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import {
  AI_PARAM_BOUNDS,
  migrateAiConfigToProfiles,
  parseAiParams,
  redactAiConfig,
  validateAiConfig,
  generateText,
  generateTextStream,
  generateTextWithUsage,
  type AiConfig,
} from '../server/provider.js';

/* ─────────────────────────────────────────────────────────── knob validation */

test('knobs are refused with a named field and a range, never clamped', () => {
  assert.equal(parseAiParams({ temperature: 9 }).error, 'params.temperature must be between 0 and 2');
  assert.equal(parseAiParams({ topP: -0.1 }).error, 'params.topP must be between 0 and 1');
  assert.equal(parseAiParams({ maxTokens: 1.5 }).error, 'params.maxTokens must be a whole number');
  assert.equal(parseAiParams({ timeoutMs: 10 }).error, 'params.timeoutMs must be between 1000 and 3600000');
  assert.equal(parseAiParams({ maxRetries: 6 }).error, 'params.maxRetries must be between 0 and 5');
  assert.equal(parseAiParams({ temperature: 'hot' }).error, 'params.temperature must be a finite number');
  /* A knob we silently dropped is a knob the reader believes they set. */
  assert.equal(
    parseAiParams({ reasoning_effort: 'high' }).error,
    'params has unsupported field(s): reasoning_effort',
  );

  /* PROTOTYPE-NAMED KEYS ARE UNKNOWN TOO. The filter used `k in AI_PARAM_BOUNDS`,
     and `in` walks the prototype chain — so {toString: 1} answered "known", skipped
     the bounds loop (which iterates the BOUNDS, not the input) and was dropped in
     total silence. The refusal exists precisely so a dropped knob is never silent. */
  assert.equal(
    parseAiParams({ toString: 1 }).error,
    'params has unsupported field(s): toString',
  );
  assert.equal(
    parseAiParams({ constructor: 2, hasOwnProperty: 3 }).error,
    'params has unsupported field(s): constructor, hasOwnProperty',
  );
});

test('an ABSENT knob set is not an empty one', () => {
  assert.deepEqual(parseAiParams(undefined), {});
  /* `params:{}` must not become `params:{}` on disk — an empty object would put
     the pre-knobs body at risk of growing a field for no reader. */
  assert.deepEqual(parseAiParams({}), {});
  assert.deepEqual(parseAiParams({ temperature: 0 }), { params: { temperature: 0 } });
});

test('every bound the settings pane states is a bound the server enforces', () => {
  for (const [key, bound] of Object.entries(AI_PARAM_BOUNDS)) {
    assert.equal(parseAiParams({ [key]: bound.min }).error, undefined, `${key} min`);
    assert.equal(parseAiParams({ [key]: bound.max }).error, undefined, `${key} max`);
    assert.ok(parseAiParams({ [key]: bound.max + 1 }).error, `${key} over`);
  }
});

test('validateAiConfig carries the knobs, and redact returns them unmasked', () => {
  const { config, error } = validateAiConfig({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: 'sk-secret-1234',
    params: { temperature: 0, maxTokens: 4096 },
  });
  assert.equal(error, undefined);
  assert.deepEqual(config?.params, { temperature: 0, maxTokens: 4096 });
  const view = redactAiConfig(config!) as { apiKey?: string; params?: unknown };
  /* A temperature is not a credential; a key still is. */
  assert.deepEqual(view.params, { temperature: 0, maxTokens: 4096 });
  assert.ok(view.apiKey && !view.apiKey.includes('secret'));
});

/* ────────────────────────────────────────────────────── knobs onto the wire */

interface Recorded {
  baseUrl: string;
  requests: unknown[];
  close: () => Promise<void>;
}

async function serve(reply: string, opts: { stallMs?: number } = {}): Promise<Recorded> {
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        requests.push(null);
      }
      const finish = () => {
        res.setHeader('content-type', 'application/json');
        res.end(reply);
      };
      if (opts.stallMs) setTimeout(finish, opts.stallMs).unref();
      else finish();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const OPENAI_REPLY = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });

function localCfg(baseUrl: string, params?: AiConfig['params']): AiConfig {
  return { provider: 'openai-compatible', baseUrl, model: 'granite4-hermes:latest', ...(params ? { params } : {}) };
}

test('NO params ⇒ the openai-compatible body is byte-identical to the pre-knobs shape', async () => {
  const srv = await serve(OPENAI_REPLY);
  try {
    await generateText(localCfg(srv.baseUrl), 'q');
  } finally {
    await srv.close();
  }
  /* Whole-body equality on purpose: several local servers 400 on a field they
     did not expect, so "no knob set" must mean "no key present". */
  assert.deepEqual(srv.requests[0], {
    model: 'granite4-hermes:latest',
    messages: [{ role: 'user', content: 'q' }],
  });
});

test('set knobs reach the wire under their provider names', async () => {
  const srv = await serve(OPENAI_REPLY);
  try {
    await generateText(localCfg(srv.baseUrl, { temperature: 0, topP: 0.9, maxTokens: 256 }), 'q');
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests[0], {
    model: 'granite4-hermes:latest',
    messages: [{ role: 'user', content: 'q' }],
    temperature: 0,
    top_p: 0.9,
    max_tokens: 256,
  });
});

test('reasoningEffort reaches the wire, and its absence puts NOTHING there', async () => {
  /*
   * THE DEFECT: `granite42-hermes`'s chat template sets `enable_thinking = True`
   * unless the request defines it otherwise, so every Teach turn opened a
   * reasoning block the reader never sees. Measured against a live Ollama on one
   * short question: 1,200 ms and 316 characters of unseen reasoning by default,
   * 343 ms and none with `reasoning_effort: 'none'` — first content at 921 ms
   * against 21 ms.
   *
   * `reasoning_effort` and NOT `think`: on this OpenAI-shaped wire Ollama
   * accepts and IGNORES the native `think` option, exactly as it accepts and
   * ignores `num_ctx` there. Both were measured; only this one took effect.
   */
  const srv = await serve(OPENAI_REPLY);
  try {
    await generateText(localCfg(srv.baseUrl, { reasoningEffort: 'none' }), 'q');
  } finally {
    await srv.close();
  }
  assert.equal((srv.requests[0] as Record<string, unknown>).reasoning_effort, 'none');

  /* And unset stays byte-identical to what shipped: several openai-compatible
     servers reject unknown request fields with a 400, which is why this wire
     sends nothing it was not asked to. */
  const bare = await serve(OPENAI_REPLY);
  try {
    await generateText(localCfg(bare.baseUrl, {}), 'q');
  } finally {
    await bare.close();
  }
  assert.ok(
    !Object.hasOwn(bare.requests[0] as Record<string, unknown>, 'reasoning_effort'),
    `absent must mean absent, got: ${JSON.stringify(bare.requests[0])}`,
  );
});

test('reasoningEffort is refused, not clamped, when it is not one of the four', () => {
  const bad = parseAiParams({ reasoningEffort: 'maximum' });
  assert.match(bad.error ?? '', /must be one of: none, low, medium, high/);
  const good = parseAiParams({ reasoningEffort: 'low' });
  assert.deepEqual(good.params, { reasoningEffort: 'low' });
});

test('maxTokens REPLACES the hardcoded 8192 on the anthropic wire', async () => {
  const srv = await serve(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
  try {
    await generateText(
      { provider: 'anthropic', baseUrl: srv.baseUrl, model: 'claude-sonnet-4-5', apiKey: 'k', params: { maxTokens: 1024 } },
      'q',
    );
  } finally {
    await srv.close();
  }
  assert.deepEqual(srv.requests[0], {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'q' }],
  });
});

test('a stalled generation is CUT at the deadline instead of hanging forever', async () => {
  /* THE DEFECT, reproduced: this server accepts the request and then never
     answers. With no `timeoutMs` there is nothing in the ask chain that would
     ever end this call — the only abort signal fires when the browser tab
     closes. */
  const srv = await serve(OPENAI_REPLY, { stallMs: 60_000 });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      () => generateText(localCfg(srv.baseUrl, { timeoutMs: 1_000 }), 'q'),
      (e: Error) => {
        /* Named as the deadline it was — a bare AbortError here reads as "the
           user cancelled", and the reader who set the timeout is the one person
           who needs to know it was hit. */
        assert.match(e.message, /did not answer within 1000 ms/);
        return true;
      },
    );
  } finally {
    await srv.close();
  }
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 20_000, `deadline must actually cut the call; took ${elapsed}ms`);
});

test('a caller abort is still a caller abort, not a fabricated timeout', async () => {
  /* The deadline must not swallow the OTHER reason a call ends. A tab closed
     mid-answer is an AbortError the caller recognises; reporting it as "the
     provider did not answer within 30000 ms" would be a fact we invented. */
  const srv = await serve(OPENAI_REPLY, { stallMs: 60_000 });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50);
  timer.unref();
  const startedAt = Date.now();
  try {
    await assert.rejects(
      () =>
        generateTextWithUsage(localCfg(srv.baseUrl, { timeoutMs: 30_000 }), 'q', {
          signal: ctl.signal,
        }),
      (e: Error) => {
        assert.equal(e.name, 'AbortError');
        assert.doesNotMatch(e.message, /did not answer within/);
        return true;
      },
    );
  } finally {
    clearTimeout(timer);
    await srv.close();
  }
  /* And it ends when the CALLER said so, not when the deadline would have. */
  assert.ok(Date.now() - startedAt < 5_000, 'the caller abort must cut the call immediately');
});

/* ────────────────────────────────────────────────────────────────── retries */

/** A server that answers `status` for the first `failures` requests, then 200. */
async function flakyServer(failures: number, status = 503): Promise<Recorded> {
  let seen = 0;
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        requests.push(null);
      }
      seen += 1;
      if (seen <= failures) {
        res.statusCode = status;
        res.end('{"error":"upstream busy"}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(OPENAI_REPLY);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('maxRetries defaults to 0 — one request, exactly as before', async () => {
  const srv = await flakyServer(1);
  try {
    await assert.rejects(() => generateText(localCfg(srv.baseUrl), 'q'), /HTTP 503/);
  } finally {
    await srv.close();
  }
  assert.equal(srv.requests.length, 1);
});

test('a transient 503 is re-sent when the reader asked for retries', async () => {
  const srv = await flakyServer(2);
  let text;
  try {
    text = await generateText(localCfg(srv.baseUrl, { maxRetries: 2 }), 'q');
  } finally {
    await srv.close();
  }
  assert.equal(text, 'ok');
  assert.equal(srv.requests.length, 3);
});

test('a 400 is an ANSWER, not weather — it is never re-sent', async () => {
  /* Re-sending a bad model id or a wrong key wastes the reader's time and hides
     the fix. Only 408/425/429/5xx and transport failures are transient. */
  const srv = await flakyServer(5, 400);
  try {
    await assert.rejects(() => generateText(localCfg(srv.baseUrl, { maxRetries: 3 }), 'q'), /HTTP 400/);
  } finally {
    await srv.close();
  }
  assert.equal(srv.requests.length, 1);
});

test('a call that EXHAUSTS its retries pins the count on the error it throws', async () => {
  /*
   * REVIEW (honesty): the run receipt sums `retries` from each call's RESULT,
   * and a call that ran out of retries has no result — so the receipt
   * undercounted on exactly the turn it exists for. The count rides on the
   * error instead; a first-try failure attaches nothing (there were none).
   */
  const srv = await flakyServer(5);
  try {
    await assert.rejects(
      () => generateText(localCfg(srv.baseUrl, { maxRetries: 2 }), 'q'),
      (e: unknown) => {
        assert.match((e as Error).message, /HTTP 503/);
        assert.equal((e as { retries?: number }).retries, 2, 'two retries were spent before giving up');
        return true;
      },
    );
  } finally {
    await srv.close();
  }
  assert.equal(srv.requests.length, 3);

  const once = await flakyServer(5);
  try {
    await assert.rejects(
      () => generateText(localCfg(once.baseUrl), 'q'),
      (e: unknown) => {
        assert.equal('retries' in (e as object), false, 'no retries taken ⇒ nothing attached, not 0');
        return true;
      },
    );
  } finally {
    await once.close();
  }
});

/* ──────────────────────────────────────────────────────────────── profiles */

const TWO_PROFILES = {
  profiles: [
    {
      id: 'local',
      name: 'Local, cheap',
      provider: 'openai-compatible',
      model: 'granite4-hermes:latest',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    {
      id: 'claude',
      name: 'Claude, for the hard edit',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-secret-9f3a',
    },
  ],
  defaultProfileId: 'claude',
};

test('the ACTIVE profile IS the config every downstream reader already takes', () => {
  const { config, error } = validateAiConfig(TWO_PROFILES);
  assert.equal(error, undefined);
  /* The flat fields are the resolved default — resolveEndpoint, both ask routes
     and the label pipeline keep seeing the shape they always saw. */
  assert.equal(config?.provider, 'anthropic');
  assert.equal(config?.model, 'claude-sonnet-4-5');
  assert.equal(config?.apiKey, 'sk-ant-secret-9f3a');
  assert.equal(config?.baseUrl, undefined);
  assert.equal(config?.profiles?.length, 2);
  assert.equal(config?.defaultProfileId, 'claude');
});

test('switching the default switches WHO ANSWERS, with nothing retyped', () => {
  const switched = validateAiConfig({ ...TWO_PROFILES, defaultProfileId: 'local' });
  assert.equal(switched.config?.provider, 'openai-compatible');
  assert.equal(switched.config?.model, 'granite4-hermes:latest');
  assert.equal(switched.config?.baseUrl, 'http://127.0.0.1:11434/v1');
  /* The local profile is keyless; the switch must not inherit Claude's key. */
  assert.equal(switched.config?.apiKey, undefined);
});

test('a default that names no profile is REFUSED, not quietly re-pointed', () => {
  const bad = validateAiConfig({ ...TWO_PROFILES, defaultProfileId: 'nope' });
  assert.equal(bad.config, undefined);
  assert.equal(bad.error, "defaultProfileId 'nope' names no profile");
});

test('a profile earns a keyless config only on loopback — same rule as a lone config', () => {
  const remote = validateAiConfig({
    profiles: [
      { id: 'a', name: 'Remote', provider: 'openai-compatible', model: 'm', baseUrl: 'https://api.example.com/v1' },
    ],
  });
  assert.equal(remote.config, undefined);
  assert.match(remote.error ?? '', /^profiles\[0\]: apiKey must be a non-empty string unless/);
  const lan = validateAiConfig({
    profiles: [
      { id: 'a', name: 'LAN', provider: 'openai-compatible', model: 'm', baseUrl: 'http://192.168.1.9:11434/v1' },
    ],
  });
  /* A private-LAN address is another machine and therefore a wider disclosure
     boundary for repository context. */
  assert.equal(lan.config, undefined);
});

test('profile shape errors name WHICH profile', () => {
  assert.equal(
    validateAiConfig({ profiles: [{ id: 'a', name: 'A', provider: 'anthropic', model: 'm', apiKey: 'k' }, { id: 'a', name: 'B', provider: 'anthropic', model: 'm', apiKey: 'k' }] }).error,
    "profiles[1]: duplicate id 'a'",
  );
  assert.equal(
    validateAiConfig({ profiles: [{ id: 'a', name: '', provider: 'anthropic', model: 'm', apiKey: 'k' }] }).error,
    'profiles[0]: name must be a non-empty string of at most 80 characters',
  );
  assert.equal(validateAiConfig({ profiles: [] }).error, 'profiles must be a non-empty array');
});

test('redact serves the LIST and masks every key in it', () => {
  const { config } = validateAiConfig(TWO_PROFILES);
  const view = redactAiConfig(config!) as {
    profiles?: { id: string; apiKey?: string }[];
    defaultProfileId?: string;
  };
  assert.equal(view.defaultProfileId, 'claude');
  assert.equal(view.profiles?.length, 2);
  const claude = view.profiles!.find((pr) => pr.id === 'claude')!;
  assert.ok(claude.apiKey && !claude.apiKey.includes('secret'), 'the key must never come back');
  assert.match(claude.apiKey!, /9f3a$/);
  /* Absence is the keyless representation and survives the round trip. */
  assert.equal(view.profiles!.find((pr) => pr.id === 'local')!.apiKey, undefined);
});

test('the pre-profiles config migrates to a one-entry list, keeping its key', () => {
  const { config } = validateAiConfig({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'granite4-hermes:latest',
  });
  const migrated = migrateAiConfigToProfiles(config!);
  assert.equal(migrated.profiles.length, 1);
  assert.equal(migrated.defaultProfileId, migrated.profiles[0]!.id);
  /* Named by its model id — the only name the reader ever gave it. */
  assert.equal(migrated.profiles[0]!.name, 'granite4-hermes:latest');
  assert.equal(migrated.profiles[0]!.baseUrl, 'http://127.0.0.1:11434/v1');
  /* And the migrated list must itself be a valid config, or the first save
     after a migration would 400 on a shape we produced ourselves. */
  const round = validateAiConfig(migrated);
  assert.equal(round.error, undefined);
  assert.equal(round.config?.model, 'granite4-hermes:latest');
});

test('a mode-less flat config is STILL accepted, unchanged', () => {
  const { config, error } = validateAiConfig({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: 'sk-x',
  });
  assert.equal(error, undefined);
  assert.deepEqual(config, { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-x' });
  assert.equal(config?.profiles, undefined);
});

test('a retry NEVER happens once a delta has been shown to the reader', async () => {
  /*
   * THE RULE, enforced rather than assumed: a delta already handed over has
   * already been shown to someone. Appending a second generation to a first the
   * reader watched appear would store a turn no model ever produced — the same
   * reason `ModelRequestOptions.onDelta` blocks failover.
   *
   * This server streams one real text delta and THEN dies mid-body, which is
   * the shape that would tempt a naive retry.
   */
  const requests: unknown[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push(1);
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"choices":[{"index":0,"delta":{"content":"half"}}]}\n\n');
      /* Let the delta actually reach the client before the socket dies — the
         point of the fixture is a stream that BROKE after the reader saw text,
         not one that never delivered any. */
      setTimeout(() => res.destroy(), 60).unref();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const deltas: string[] = [];
  try {
    await generateTextStream(localCfg(baseUrl, { maxRetries: 3 }), 'q', (d) => deltas.push(d)).catch(
      () => undefined,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.deepEqual(deltas, ['half']);
  assert.equal(requests.length, 1, 'the delta was already rendered; nothing may be re-sent');
});
