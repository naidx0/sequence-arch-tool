import { describe, expect, it, vi } from 'vitest';

import { BOOT_CACHE_MS, bootFetchCache } from './bootFetchCache';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the boot GET cache', () => {
  it('answers the second GET of each listed route from the first, each caller reading its own body', async () => {
    const base = vi.fn(async () => json({ a: 1 }));
    const f = bootFetchCache(base as unknown as typeof fetch);
    for (const route of ['/api/sessions', '/api/skills', '/api/acp/agents']) {
      const [x, y] = [await f(route), await f(route)];
      expect(await x.json()).toEqual({ a: 1 });
      expect(await y.json()).toEqual({ a: 1 });
    }
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('forgets after the window', async () => {
    let t = 0;
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch, () => t);
    await f('/api/skills');
    t = BOOT_CACHE_MS + 1;
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(2);
  });
  it('a POST that only computes (annotate) neither drops the cache nor bypasses it while in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = vi.fn(async (i: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') await gate;
      return json({});
    });
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/acp/agents');
    const annotate = f('/api/annotate', { method: 'POST' });
    await f('/api/acp/agents');
    expect(base.mock.calls.filter(([i]) => i === '/api/acp/agents')).toHaveLength(1);
    release();
    await annotate;
    await f('/api/acp/agents');
    expect(base.mock.calls.filter(([i]) => i === '/api/acp/agents')).toHaveLength(1);
  });
  it('a write to the route family drops it: the next read is fresh', async () => {
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/sessions');
    await f('/api/sessions/active', { method: 'PUT', body: '{}' });
    await f('/api/sessions');
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('leaves every other route, other methods and failed reads alone', async () => {
    const base = vi.fn(async (_i: unknown, init?: RequestInit) => (init?.method === 'POST' ? json({}) : new Response('no', { status: 500 })));
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/status');
    await f('/api/status');
    await f('/api/skills');
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(4);
  });
  it('an abort cancels only the caller that made it; the shared read still answers the others', async () => {
    const base = vi.fn(async () => json({ ok: true }));
    const f = bootFetchCache(base as unknown as typeof fetch);
    const ctl = new AbortController();
    const mine = f('/api/acp/agents', { signal: ctl.signal });
    const other = f('/api/acp/agents');
    ctl.abort();
    await expect(mine).rejects.toMatchObject({ name: 'AbortError' });
    expect(await (await other).json()).toEqual({ ok: true });
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0]![1]?.signal).toBeUndefined();
  });

  it('keys on the query string: different queries are different answers', async () => {
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/sessions?root=/a');
    await f('/api/sessions?root=/b');
    await f('/api/sessions?root=/a');
    expect(base).toHaveBeenCalledTimes(2);
  });
  it('any write under /api/ clears the cache: an attach drops the sessions list', async () => {
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/sessions');
    await f('/api/attach', { method: 'POST', body: '{}' });
    await f('/api/sessions');
    expect(base).toHaveBeenCalledTimes(3);
    await f('/api/file/op', { method: 'POST' });
    await f('/api/skills');
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(5);
  });
  it('a list read during an in-flight write neither uses nor fills the cache', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = vi.fn(async (_i: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') await gate;
      return json({});
    });
    const f = bootFetchCache(base as unknown as typeof fetch);
    await f('/api/skills');
    const write = f('/api/detach', { method: 'POST' });
    await f('/api/skills');
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(4);
    release();
    await write;
    await f('/api/skills');
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(5);
  });
  it('a read that began before the latest write settled is not kept', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = vi.fn(async (_i: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') return json({});
      await gate;
      return json({ old: true });
    });
    const f = bootFetchCache(base as unknown as typeof fetch);
    const slow = f('/api/sessions');
    await f('/api/attach', { method: 'POST' });
    release();
    await slow;
    await f('/api/sessions');
    expect(base).toHaveBeenCalledTimes(3);
  });
});
