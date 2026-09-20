import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

import {
  LOCAL_CONTEXT_MAX_TOKENS,
  LOCAL_PROBES,
  contextLengthFrom,
  effectiveContextFrom,
  matchLocalOllama,
  isLocalOllama,
  detectLocalProviders,
  probeContextWindow,
  modelsFrom,
  probeLocal,
} from '../server/localProviders.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * LOCAL-FIRST, SAID OUT LOUD
 *
 * CLAUDE.md: "the app boots and delivers its core with no network and no key."
 * The ENGINE honours that — a full grounded answer ran on 2026-08-23 against a
 * 6.9B model on localhost with no key and no network. THE PRODUCT DOES NOT SAY
 * SO: the shipped config points at an undeployed gateway and the first failure
 * a new reader meets is a form asking for an API key, for a capability already
 * running on their machine.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** A fetch that answers one URL and refuses everything else. */
function only(url: string, answer: { status?: number; body?: unknown; text?: string }) {
  /* `string | URL`, not `RequestInfo`: this package compiles without the DOM
     lib, so that name does not exist here. */
  return (async (input: string | URL) => {
    if (String(input) !== url) throw new Error('ECONNREFUSED');
    const status = answer.status ?? 200;
    return new Response(answer.text ?? JSON.stringify(answer.body ?? {}), { status });
  }) as unknown as typeof fetch;
}

const OLLAMA = LOCAL_PROBES[0]!;
const LIST = { data: [{ id: 'granite4-hermes:latest' }, { id: 'ornith:9b' }] };

describe('THE PROBE IS LOCALHOST-ONLY, and that is a security property', () => {
  it('every probe is a 127.0.0.1 literal', () => {
    /*
     * A list a caller could extend is a server-side request forgery with a
     * configuration file in front of it. There is no setting that widens these,
     * which is what makes the whole feature safe to run unasked.
     */
    for (const probe of LOCAL_PROBES) {
      assert.match(probe.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    }
  });

  it('names the two that exist', () => {
    assert.deepEqual(
      LOCAL_PROBES.map((p) => p.name),
      ['Ollama', 'LM Studio'],
    );
  });
});

describe('reading a model list', () => {
  it('takes the ids it was given', () => {
    assert.deepEqual(modelsFrom(LIST), ['granite4-hermes:latest', 'ornith:9b']);
  });

  it('INVENTS NOTHING when the shape is unfamiliar', () => {
    /* This runs on a developer's machine, where 1234 is a port people use for
       all sorts of things. A body that is not a model list means "not one of
       these", never a guess at what it might have meant. */
    for (const junk of [null, 'text', {}, { data: 'no' }, { data: [1, 2] }, { data: [{}] }]) {
      assert.deepEqual(modelsFrom(junk), []);
    }
  });

  it('caps the number of model buttons an endpoint can create', () => {
    const body = { data: Array.from({ length: 101 }, (_, i) => ({ id: `model-${i}` })) };
    assert.equal(modelsFrom(body).length, 100);
  });

  it('drops a model id too long to be a usable provider identifier', () => {
    const tooLong = 'x'.repeat(257);
    assert.deepEqual(modelsFrom({ data: [{ id: tooLong }, { id: 'usable' }] }), ['usable']);
  });
});

describe('asking one probe', () => {
  it('reports what answered', async () => {
    const found = await probeLocal(OLLAMA, only(`${OLLAMA.baseUrl}/models`, { body: LIST }));
    assert.equal(found?.name, 'Ollama');
    assert.equal(found?.baseUrl, OLLAMA.baseUrl);
    assert.deepEqual(found?.models, ['granite4-hermes:latest', 'ornith:9b']);
  });

  it('PRESENT WITH NO MODELS IS A REAL ANSWER, not an absence', async () => {
    /*
     * "Ollama is running and has nothing pulled" is a different thing to fix
     * from "Ollama is not running", and one of them the reader can fix in
     * thirty seconds. Collapsing them would hide that one.
     */
    const found = await probeLocal(OLLAMA, only(`${OLLAMA.baseUrl}/models`, { body: { data: [] } }));
    assert.notEqual(found, null);
    assert.deepEqual(found?.models, []);
  });

  it('NOTHING THERE IS THE ORDINARY CASE, and it does not throw', async () => {
    /* Most machines run neither. An exception for the common answer would make
       every caller wrap it, and one of them would forget. */
    const found = await probeLocal(OLLAMA, only('http://nowhere', {}));
    assert.equal(found, null);
  });

  it('something else on the port is not a provider', async () => {
    const found = await probeLocal(OLLAMA, only(`${OLLAMA.baseUrl}/models`, { text: '<html>' }));
    assert.equal(found, null);
  });

  it('a refusal is not a provider', async () => {
    const found = await probeLocal(OLLAMA, only(`${OLLAMA.baseUrl}/models`, { status: 404 }));
    assert.equal(found, null);
  });

  it('does not follow a redirect away from the literal probe URL', async () => {
    let redirectedRequests = 0;
    const target = http.createServer((_req, res) => {
      redirectedRequests++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(LIST));
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address();
    const targetPort = typeof targetAddress === 'object' && targetAddress ? targetAddress.port : 0;

    const source = http.createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${targetPort}/admin`);
      res.end();
    });
    await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve));
    const sourceAddress = source.address();
    const sourcePort = typeof sourceAddress === 'object' && sourceAddress ? sourceAddress.port : 0;

    try {
      const found = await probeLocal(
        { name: 'redirecting probe', baseUrl: `http://127.0.0.1:${sourcePort}/v1` },
        fetch,
      );
      assert.equal(redirectedRequests, 0, 'the redirect target must never receive a request');
      assert.equal(found, null, 'a redirect is not a model list');
    } finally {
      await new Promise<void>((resolve) => source.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it('rejects an oversized response even when the prefix is valid model JSON', async () => {
    const body = JSON.stringify({ data: [{ id: 'would-have-been-relayed' }] }) + ' '.repeat(300_000);
    const oversized = (async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    assert.equal(await probeLocal(OLLAMA, oversized), null);
  });

  it('gives up rather than hanging', async () => {
    /* A probe that waits forever makes opening Settings wait forever. */
    const hangs = (async () =>
      new Promise<Response>(() => {
        /* never resolves */
      })) as unknown as typeof fetch;
    const started = Date.now();
    assert.equal(await probeLocal(OLLAMA, hangs, 40), null);
    assert.ok(Date.now() - started < 2_000);
  });
});

describe('asking both', () => {
  it('reports only what answered', async () => {
    const found = await detectLocalProviders(only(`${OLLAMA.baseUrl}/models`, { body: LIST }));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.name, 'Ollama');
  });

  it('an empty list is the honest answer on a machine with neither', async () => {
    assert.deepEqual(await detectLocalProviders(only('http://nowhere', {})), []);
  });

  it('coalesces concurrent detection and caches a recent answer', async () => {
    let requests = 0;
    const answers = (async (input: string | URL) => {
      requests++;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const body = String(input).startsWith(OLLAMA.baseUrl) ? LIST : { data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    await Promise.all([
      detectLocalProviders(answers),
      detectLocalProviders(answers),
      detectLocalProviders(answers),
    ]);
    assert.equal(requests, 2, 'three callers share the same two in-flight probes');

    await detectLocalProviders(answers);
    assert.equal(requests, 2, 'a recent result is reused instead of polling localhost again');
  });
});

/* ── the context window, asked for rather than assumed ─────────────────── */
describe('the context window is asked for, never assumed', () => {


  it('contextLengthFrom reads the real number, and refuses everything else', () => {
    /*
     * Max, 2026-08-24: "I can see many tokens were used, but I can't see my
     * context window." The product could not tell him. Inventing a ceiling was
     * never an option - a confident wrong number is the failure this product
     * exists to catch in other tools - so it asks Ollama, which knows.
     */
    assert.strictEqual(
      contextLengthFrom({ model_info: { 'granitehybrid.context_length': 1_048_576 } }),
      1_048_576,
    );
    /* The key is architecture-prefixed, so it is found by suffix rather than by a
       list of architectures nobody could keep complete. */
    assert.strictEqual(contextLengthFrom({ model_info: { 'llama.context_length': 8192 } }), 8192);

    /* Everything that is not a positive integer in a sane range is UNKNOWN, and
       unknown must stay unknown rather than degrade into a plausible default. */
    for (const bad of [
      undefined,
      null,
      {},
      { model_info: null },
      { model_info: { 'x.context_length': 0 } },
      { model_info: { 'x.context_length': -1 } },
      { model_info: { 'x.context_length': 1.5 } },
      { model_info: { 'x.context_length': '8192' } },
      { model_info: { 'x.context_length': LOCAL_CONTEXT_MAX_TOKENS + 1 } },
    ]) {
      assert.strictEqual(contextLengthFrom(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('probeContextWindow only ever calls a loopback literal it already knew', async () => {
    /*
     * The guard the models probe earned, restated here because this one takes a
     * baseUrl from a stored config: "a list a caller could extend is a
     * server-side request forgery with a configuration file in front of it." The
     * caller's value is MATCHED against the literals, never used as one.
     */
    const called: string[] = [];
    const spy: typeof fetch = async (input) => {
      called.push(String(input));
      return new Response('{}', { status: 200 });
    };

    assert.strictEqual(await probeContextWindow('http://evil.example/v1', 'm', spy, 200), null);
    assert.strictEqual(await probeContextWindow('http://127.0.0.1:1234/v1', 'm', spy, 200), null);
    assert.deepStrictEqual(called, [], 'no request may leave for an origin that is not in the list');

    /* And the known one is asked at its OWN origin, not at the /v1 base. */
    await probeContextWindow('http://127.0.0.1:11434/v1', 'granite', spy, 200);
    assert.deepStrictEqual(called, ['http://127.0.0.1:11434/api/show']);
  });

  it('probeContextWindow refuses a redirect rather than following it off localhost', async () => {
    let options: RequestInit | undefined;
    const spy: typeof fetch = async (_input, init) => {
      options = init;
      return new Response(JSON.stringify({ model_info: { 'a.context_length': 4096 } }), { status: 200 });
    };
    assert.strictEqual(await probeContextWindow('http://127.0.0.1:11434/v1', 'm', spy, 200), 4096);
    assert.strictEqual(options?.redirect, 'manual', 'a followed redirect leaves loopback');
  });

  it('an empty model name asks nothing', async () => {
    const called: string[] = [];
    const spy: typeof fetch = async (input) => {
      called.push(String(input));
      return new Response('{}', { status: 200 });
    };
    assert.strictEqual(await probeContextWindow('http://127.0.0.1:11434/v1', '  ', spy, 200), null);
    assert.deepStrictEqual(called, []);
  });
});

describe('effectiveContextFrom — the window the server will actually run', () => {
  /*
   * MEASURED 2026-09-04 against the live Ollama (v0.33.2) on this machine. The
   * `parameters` block is the Modelfile, and the Modelfile's num_ctx is what the
   * server honours: granite42-hermes says 65536 there and `/api/ps` reports the
   * loaded slot at exactly 65536.
   *
   * `model_info` says 131072 for the same model. That is the TRAINED ceiling and
   * it is never the effective window — 2x wrong here, 32x wrong on stock
   * granite4.2:3b (ceiling 131072, server default 4096), 64x on granite-bench
   * (ceiling 1048576, Modelfile 16384). It is also exactly the field a reasonable
   * person reaches for, which is why the two live side by side with this note.
   */
  const REAL_SHOW = {
    parameters: 'num_batch                      1024\nnum_ctx                        65536\ntemperature                    1\ntop_p                          0.95',
    model_info: { 'granite.context_length': 131072 },
  };

  it('reads the Modelfile num_ctx, not the trained ceiling', () => {
    assert.strictEqual(effectiveContextFrom(REAL_SHOW), 65536);
    assert.strictEqual(contextLengthFrom(REAL_SHOW), 131072, 'the ceiling is still readable');
  });

  it('ABSENT is the answer, not a gap — it is the case that truncates', () => {
    /*
     * Stock granite4.2:3b bakes no num_ctx, so the SERVER DEFAULT applies and
     * /api/show does not report it. Unknowable from this endpoint, and the
     * caller must say so rather than guess — the same move as `unverifiable` on
     * the premise check.
     */
    assert.strictEqual(
      effectiveContextFrom({ parameters: 'temperature 1\ntop_p 0.95', model_info: { 'granite.context_length': 131072 } }),
      null,
      'no Modelfile num_ctx means the window is not knowable here',
    );
  });

  it('is total: junk, missing blocks and absurd values are all "unknown"', () => {
    for (const body of [null, undefined, 42, 'nope', {}, { parameters: 12 }, { parameters: '' }]) {
      assert.strictEqual(effectiveContextFrom(body), null);
    }
    assert.strictEqual(effectiveContextFrom({ parameters: 'num_ctx 0' }), null);
    assert.strictEqual(effectiveContextFrom({ parameters: 'num_ctx -8' }), null);
    assert.strictEqual(
      effectiveContextFrom({ parameters: `num_ctx ${LOCAL_CONTEXT_MAX_TOKENS + 1}` }),
      null,
    );
  });

  it('does not mistake a different parameter for num_ctx', () => {
    assert.strictEqual(effectiveContextFrom({ parameters: 'num_batch 1024' }), null);
    assert.strictEqual(effectiveContextFrom({ parameters: 'num_ctx_extra 999' }), null);
  });
});

describe('matchLocalOllama — the four spellings that mean the same machine', () => {
  /*
   * The first cut compared the config's baseUrl to the probe table with `===`.
   * It worked only because the shipped config happened to match character for
   * character, and the failure mode was the absence-of-a-signal law in its
   * purest form: the context-fit planner did not refuse, did not report
   * `unknown`, did not exist — silent truncation at HTTP 200 behind a config
   * that reads as correct. Someone typing `localhost`, the single most natural
   * thing to type, got none of that work.
   */
  it('accepts every spelling of the same loopback endpoint', () => {
    for (const spelling of [
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434/v1',
      'http://127.0.0.1:11434/v1/',
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434/',
      'HTTP://127.0.0.1:11434/V1',
      '  http://localhost:11434/v1  ',
    ]) {
      assert.ok(matchLocalOllama(spelling), `should match: ${spelling}`);
      assert.strictEqual(isLocalOllama('openai-compatible', spelling), true, spelling);
    }
  });

  it('returns the LITERAL probe, so no caller-supplied origin is ever fetched', () => {
    /*
     * The security property this must not cost. Matching is by meaning; what
     * comes back is the hardcoded entry, and `showBody` builds its request from
     * THAT. A config file can therefore never point a fetch somewhere new — the
     * reason LOCAL_PROBES is literals in the first place.
     */
    const probe = matchLocalOllama('http://localhost:11434/v1');
    assert.strictEqual(probe?.baseUrl, 'http://127.0.0.1:11434/v1');
  });

  it('refuses anything that is not loopback:11434', () => {
    for (const other of [
      'http://evil.example/v1',
      'http://10.0.0.5:11434/v1',
      'http://127.0.0.1:1234/v1', // LM Studio, a different service
      'http://127.0.0.1:11434/admin',
      'file:///etc/passwd',
      'not a url',
      '',
      undefined,
    ]) {
      assert.strictEqual(matchLocalOllama(other), undefined, String(other));
    }
    /* And the provider still has to be the right one. */
    assert.strictEqual(isLocalOllama('anthropic', 'http://127.0.0.1:11434/v1'), false);
  });
});
