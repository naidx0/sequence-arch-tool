import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import {
  ModelListService,
  contextWindowFast,
  resetContextWindowCache,
  handleModelListRoute,
  idsFrom,
  targetFor,
} from '../server/modelListRoutes.js';
import type { AiConfig } from '../server/provider.js';

/* A fake provider on a free loopback port. No real network, no real key. */
async function fake(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ base: string; seen: { url: string; headers: http.IncomingHttpHeaders }[]; close: () => Promise<void> }> {
  const seen: { url: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
const json = (res: http.ServerResponse, body: unknown, status = 200) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

describe('model list from the provider itself', () => {
  it('Ollama: GET /api/tags on the base URL', async () => {
    const f = await fake((req, res) =>
      req.url === '/api/tags' ? json(res, { models: [{ name: 'qwen3:4b' }, { name: 'llama3:8b' }] }) : json(res, {}, 404),
    );
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.deepEqual(out, { ok: true, models: ['qwen3:4b', 'llama3:8b'], source: 'ollama', cached: false });
      assert.equal(f.seen[0]!.url, '/api/tags');
    } finally {
      await f.close();
    }
  });

  it('Ollama with nothing pulled says so in one line', async () => {
    const f = await fake((_q, res) => json(res, { models: [] }));
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.equal(out.ok, false);
      assert.match((out as { reason: string }).reason, /no models pulled/);
    } finally {
      await f.close();
    }
  });

  it('OpenAI-compatible (LM Studio shape): falls from /api/tags to /v1/models, sends the bearer key', async () => {
    const f = await fake((req, res) =>
      req.url === '/v1/models' ? json(res, { data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }) : json(res, {}, 404),
    );
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1`, apiKey: 'sk-test-123' });
      assert.deepEqual(out, { ok: true, models: ['a', 'b'], source: 'openai', cached: false });
      assert.equal(f.seen.at(-1)!.headers.authorization, 'Bearer sk-test-123');
    } finally {
      await f.close();
    }
  });

  it('a base without /v1 gets /v1/models', async () => {
    const f = await fake((req, res) =>
      req.url === '/v1/models' ? json(res, { data: [{ id: 'x' }] }) : json(res, {}, 404),
    );
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: f.base });
      assert.equal(out.ok, true);
    } finally {
      await f.close();
    }
  });

  it('Anthropic: GET /v1/models with x-api-key and a version header; a base with /v1 is not doubled', async () => {
    const f = await fake((req, res) =>
      req.url?.startsWith('/v1/models') ? json(res, { data: [{ id: 'claude-x' }, { id: 'claude-y' }] }) : json(res, {}, 404),
    );
    try {
      const out = await new ModelListService().list({ provider: 'anthropic', baseUrl: `${f.base}/v1`, apiKey: 'sk-ant-test' });
      assert.deepEqual(out, { ok: true, models: ['claude-x', 'claude-y'], source: 'anthropic', cached: false });
      assert.equal(f.seen[0]!.headers['x-api-key'], 'sk-ant-test');
      assert.equal(f.seen[0]!.headers['anthropic-version'], '2023-06-01');
    } finally {
      await f.close();
    }
  });

  it('Anthropic without a saved key never makes a request', async () => {
    let called = 0;
    const svc = new ModelListService((async () => {
      called++;
      return new Response('{}');
    }) as typeof fetch);
    const out = await svc.list({ provider: 'anthropic' });
    assert.equal(out.ok, false);
    assert.equal(called, 0);
  });

  it('a rejected key is one line and never echoes the key', async () => {
    const f = await fake((_q, res) => json(res, { error: 'bad sk-secret-999' }, 401));
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1`, apiKey: 'sk-secret-999' });
      assert.equal(out.ok, false);
      const reason = (out as { reason: string }).reason;
      assert.match(reason, /refused the saved key \(401\)/);
      assert.ok(!JSON.stringify(out).includes('sk-secret-999'));
    } finally {
      await f.close();
    }
  });

  it('a server that never answers gives up at the deadline instead of hanging', async () => {
    const f = await fake(() => {
      /* never respond */
    });
    try {
      const t0 = Date.now();
      const out = await new ModelListService(fetch, Date.now, 300).list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.equal(out.ok, false);
      assert.match((out as { reason: string }).reason, /did not answer within/);
      assert.ok(Date.now() - t0 < 2_500, 'bounded: each request stops at the deadline');
    } finally {
      await f.close();
    }
  });

  it('a refused connection is a reason, not a throw', async () => {
    const f = await fake((_q, res) => json(res, {}));
    const base = f.base;
    await f.close();
    const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${base}/v1` });
    assert.equal(out.ok, false);
    assert.match((out as { reason: string }).reason, /Could not reach 127\.0\.0\.1/);
  });

  it('a body that is not a list, and a missing base URL, each say so', async () => {
    const f = await fake((_q, res) => {
      res.end('<html>nope</html>');
    });
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.equal(out.ok, false);
    } finally {
      await f.close();
    }
    const none = await new ModelListService().list({ provider: 'openai-compatible' });
    assert.match((none as { reason: string }).reason, /no base URL/);
  });

  it('caches briefly; refresh bypasses; a different key is a different entry', async () => {
    let clock = 1_000;
    let hits = 0;
    const svc = new ModelListService(
      (async () => {
        hits++;
        return new Response(JSON.stringify({ data: [{ id: 'm' + hits }] }), { status: 200 });
      }) as typeof fetch,
      () => clock,
    );
    const t = { provider: 'openai-compatible' as const, baseUrl: 'https://api.example.test/v1', apiKey: 'k1' };
    assert.equal(((await svc.list(t)) as { cached: boolean }).cached, false);
    assert.deepEqual(await svc.list(t), { ok: true, models: ['m1'], source: 'openai', cached: true });
    assert.equal(hits, 1);
    await svc.list({ ...t, apiKey: 'k2' });
    assert.equal(hits, 2);
    const forced = await svc.list(t, true);
    assert.deepEqual(forced, { ok: true, models: ['m3'], source: 'openai', cached: false });
    clock += 61_000;
    assert.equal(((await svc.list(t)) as { cached: boolean }).cached, false);
  });

  it('idsFrom is total over junk', () => {
    assert.deepEqual(idsFrom(null, 'data'), []);
    assert.deepEqual(idsFrom({ data: [1, null, { id: '' }, { id: 'ok' }] }, 'data'), ['ok']);
  });
});

describe('GET /api/ai-models', () => {
  const cfg: AiConfig = {
    provider: 'openai-compatible',
    model: 'm',
    baseUrl: 'http://x.invalid/v1',
    profiles: [{ id: 'p1', name: 'One', provider: 'anthropic', model: 'c', apiKey: 'sk-ant-route' }],
    defaultProfileId: 'p1',
  };

  it('targetFor picks the named profile with its key, else the active config, else null', () => {
    assert.deepEqual(targetFor(cfg, 'p1'), { provider: 'anthropic', apiKey: 'sk-ant-route' });
    assert.equal(targetFor(cfg, 'nope'), null);
    assert.equal(targetFor(undefined, null), null);
  });

  async function serve(authOn: boolean, service: ModelListService) {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      void handleModelListRoute({ req, res, url, method: req.method ?? 'GET', authOn, loadConfig: () => cfg, service }).then((h) => {
        if (!h) {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return {
      port: (server.address() as AddressInfo).port,
      close: () =>
        new Promise<void>((r) => {
          server.closeAllConnections();
          server.close(() => r());
        }),
    };
  }

  it('answers {ok, models} and the key is nowhere in the response', async () => {
    const svc = new ModelListService((async () => new Response(JSON.stringify({ data: [{ id: 'claude-z' }] }), { status: 200 })) as typeof fetch);
    const s = await serve(false, svc);
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/api/ai-models?profile=p1`);
      const text = await r.text();
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(text), { ok: true, models: ['claude-z'], source: 'anthropic', cached: false });
      assert.ok(!text.includes('sk-ant-route'));
      const bad = await (await fetch(`http://127.0.0.1:${s.port}/api/ai-models?profile=zzz`)).json();
      assert.equal((bad as { ok: boolean }).ok, false);
    } finally {
      await s.close();
    }
  });

  it('is refused in hosted (auth-on) mode', async () => {
    const s = await serve(true, new ModelListService());
    try {
      assert.equal((await fetch(`http://127.0.0.1:${s.port}/api/ai-models`)).status, 403);
    } finally {
      await s.close();
    }
  });
});

describe('the context window never holds the config read hostage', () => {
  it('a first look waits only briefly, later reads are instant, a stale value is served while it refreshes', async () => {
    resetContextWindowCache();
    let clock = 0;
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 600));
      return 32768;
    };
    const t0 = Date.now();
    assert.equal(await contextWindowFast('http://h/v1', 'm', fetch, slow, () => clock, 100), null);
    assert.ok(Date.now() - t0 < 450, `first read answered unknown in ${Date.now() - t0} ms, not the probe's 600`);
    await new Promise((r) => setTimeout(r, 700));
    const t1 = Date.now();
    assert.equal(await contextWindowFast('http://h/v1', 'm', fetch, slow, () => clock, 100), 32768);
    assert.ok(Date.now() - t1 < 50);
    assert.equal(calls, 1, 'one probe, not one per read');
    clock += 61_000;
    const t2 = Date.now();
    assert.equal(await contextWindowFast('http://h/v1', 'm', fetch, slow, () => clock, 100), 32768, 'stale value served while it refreshes');
    assert.ok(Date.now() - t2 < 50);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(calls, 2);
  });

  it('a probe that throws is an unknown, not a failed read', async () => {
    resetContextWindowCache();
    const boom = async () => {
      throw new Error('x');
    };
    assert.equal(await contextWindowFast('http://h2/v1', 'm', fetch, boom, () => 0, 100), null);
  });
});

describe('one deadline for the whole refresh', () => {
  it('a hung loopback server is given up on once, not once per endpoint', async () => {
    const f = await fake(() => {
      /* never respond to either /api/tags or /v1/models */
    });
    try {
      const t0 = Date.now();
      const out = await new ModelListService(fetch, Date.now, 500).list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      const took = Date.now() - t0;
      assert.equal(out.ok, false);
      assert.ok(took < 850, `took ${took} ms; two sequential 500 ms waits would be about 1000`);
      assert.deepEqual(f.seen.map((x) => x.url), ['/api/tags'], 'no fallback request after a timeout');
    } finally {
      await f.close();
    }
  });

  it('a slow /api/tags that then 404s still leaves the fallback only the remaining time', async () => {
    const f = await fake((req, res) => {
      if (req.url === '/api/tags') setTimeout(() => json(res, {}, 404), 300);
      /* /v1/models never answers */
    });
    try {
      const t0 = Date.now();
      const out = await new ModelListService(fetch, Date.now, 500).list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.equal(out.ok, false);
      assert.ok(Date.now() - t0 < 750, `took ${Date.now() - t0} ms`);
    } finally {
      await f.close();
    }
  });
});

describe('a capped list says so', () => {
  it('reports the provider total when more than 1000 were listed', async () => {
    const data = Array.from({ length: 1200 }, (_, i) => ({ id: `m${i}` }));
    const f = await fake((req, res) => (req.url === '/v1/models' ? json(res, { data }) : json(res, {}, 404)));
    try {
      const out = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${f.base}/v1` });
      assert.equal(out.ok, true);
      assert.equal((out as { models: string[] }).models.length, 1000);
      assert.equal((out as { total?: number }).total, 1200);
      const small = await fake((_q, res) => json(res, { data: [{ id: 'a' }] }));
      try {
        const o2 = await new ModelListService().list({ provider: 'openai-compatible', baseUrl: `${small.base}/v1` });
        assert.equal('total' in o2, false);
      } finally {
        await small.close();
      }
    } finally {
      await f.close();
    }
  });
});
