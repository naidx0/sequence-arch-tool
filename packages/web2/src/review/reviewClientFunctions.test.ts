import { describe, expect, it, vi } from 'vitest';

import { createReviewClient } from './reviewClient';

const body = { functionGraph: { nodes: [], edges: [] } };
const ok = () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('GET /api/functions is asked once per scan', () => {
  it('two clients asking for the same scan share one request and one parse', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const scan = {};
    const parse = vi.spyOn(JSON, 'parse');
    const a = createReviewClient(fetchImpl as unknown as typeof fetch);
    const b = createReviewClient(fetchImpl as unknown as typeof fetch);
    const [x, y] = await Promise.all([a.functions(undefined, scan), b.functions(undefined, scan)]);
    const z = await a.functions(undefined, scan);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls.filter(([t]) => typeof t === 'string' && t.includes('functionGraph'))).toHaveLength(1);
    parse.mockRestore();
    expect(x.outcome).toBe('ok');
    expect(y).toBe(x);
    expect(z).toBe(x);
  });
  it('a new scan asks again; a refusal is not kept; no scan key means no sharing', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const c = createReviewClient(fetchImpl as unknown as typeof fetch);
    await c.functions(undefined, {});
    await c.functions(undefined, {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await c.functions();
    await c.functions();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const failing = vi.fn(async () => new Response('{"error":"x"}', { status: 500 }));
    const d = createReviewClient(failing as unknown as typeof fetch);
    const scan = {};
    await d.functions(undefined, scan);
    await d.functions(undefined, scan);
    expect(failing).toHaveBeenCalledTimes(2);
  });
  it('one caller leaving does not cancel the shared read', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const c = createReviewClient(fetchImpl as unknown as typeof fetch);
    const scan = {};
    const gone = new AbortController();
    const first = c.functions(gone.signal, scan);
    const second = c.functions(undefined, scan);
    gone.abort();
    expect((await first).outcome).toBe('unreachable');
    expect((await second).outcome).toBe('ok');
  });
});
