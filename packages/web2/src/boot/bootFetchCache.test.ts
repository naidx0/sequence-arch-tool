import { describe, expect, it, vi } from 'vitest';

import { BOOT_CACHE_MS, bootFetchCache } from './bootFetchCache';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the boot GET cache', () => {
  it('answers the second GET of each listed route from the first, each caller reading its own body', async () => {
    const base = vi.fn(async () => json({ a: 1 }));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, () => t, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    await f('/api/sessions');
    await f('/api/sessions/active', { method: 'PUT', body: '{}' });
    await f('/api/sessions');
    expect(base).toHaveBeenCalledTimes(3);
  });
  it('leaves every other route, other methods and failed reads alone', async () => {
    const base = vi.fn(async (_i: unknown, init?: RequestInit) => (init?.method === 'POST' ? json({}) : new Response('no', { status: 500 })));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    await f('/api/status');
    await f('/api/status');
    await f('/api/skills');
    await f('/api/skills');
    expect(base).toHaveBeenCalledTimes(4);
  });
  it('an abort cancels only the caller that made it; the shared read still answers the others', async () => {
    const base = vi.fn(async () => json({ ok: true }));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    await f('/api/sessions?root=/a');
    await f('/api/sessions?root=/b');
    await f('/api/sessions?root=/a');
    expect(base).toHaveBeenCalledTimes(2);
  });
  it('any write under /api/ clears the cache: an attach drops the sessions list', async () => {
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
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
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    const slow = f('/api/sessions');
    await f('/api/attach', { method: 'POST' });
    release();
    await slow;
    await f('/api/sessions');
    expect(base).toHaveBeenCalledTimes(3);
  });
});

describe('the boot GET cache and the startup attach', () => {
  it('drops the lists when /api/status reports the attach finished: the chat list read after it is the repository\'s', async () => {
    let attached = false;
    const base = vi.fn(async (input: unknown) =>
      String(input) === '/api/status'
        ? json(attached ? { attached: true, root: '/r' } : { attached: false, scanning: { done: 2, total: 2, path: '/r' } })
        : json({ index: { activeId: attached ? 'repo-chat' : 'home-chat' } }),
    );
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    expect(await (await f('/api/status')).json()).toMatchObject({ attached: false });
    expect(await (await f('/api/sessions')).json()).toEqual({ index: { activeId: 'home-chat' } });
    attached = true;
    expect(await (await f('/api/status')).json()).toMatchObject({ attached: true });
    /* Well inside the window, and still not the cached home answer. */
    expect(await (await f('/api/sessions')).json()).toEqual({ index: { activeId: 'repo-chat' } });
  });
  it('keeps the lists while the status says nothing new', async () => {
    const base = vi.fn(async (input: unknown) => (String(input) === '/api/status' ? json({ attached: true, root: '/r' }) : json({})));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, false);
    await f('/api/status');
    await f('/api/sessions');
    await f('/api/status');
    await f('/api/sessions');
    expect(base.mock.calls.filter(([i]) => i === '/api/sessions')).toHaveLength(1);
  });
});

describe('the workspace gate', () => {
  const statusJson = (b: unknown) => json(b);
  it('holds workspace reads until /api/status says the repository is not still attaching', async () => {
    const base = vi.fn(async (i: unknown) => (String(i) === '/api/status' ? statusJson({ attached: true, root: '/r' }) : json({ ok: 1 })));
    const f = bootFetchCache(base as unknown as typeof fetch);
    const read = f('/api/sessions/abc/goal-run');
    await Promise.resolve();
    expect(base).not.toHaveBeenCalled();
    await f('/api/status');
    expect(await (await read).json()).toEqual({ ok: 1 });
    expect(base.mock.calls.map(([i]) => i)).toEqual(['/api/status', '/api/sessions/abc/goal-run']);
  });
  it('stays shut while the server reports scanning, then opens on the attached answer', async () => {
    let attached = false;
    const base = vi.fn(async (i: unknown) =>
      String(i) === '/api/status' ? statusJson(attached ? { attached: true, root: '/r' } : { attached: false, scanning: { done: 1, total: 9 } }) : json({}),
    );
    const f = bootFetchCache(base as unknown as typeof fetch);
    const read = f('/api/skills');
    await f('/api/status');
    await new Promise((r) => setTimeout(r, 5));
    expect(base.mock.calls.filter(([i]) => i === '/api/skills')).toHaveLength(0);
    attached = true;
    await f('/api/status');
    await read;
    expect(base.mock.calls.filter(([i]) => i === '/api/skills')).toHaveLength(1);
  });
  it('opens on a failed status read, and uses the early status answer instead of asking again', async () => {
    const down = vi.fn(async () => {
      throw new Error('down');
    });
    const f = bootFetchCache(down as unknown as typeof fetch);
    const read = f('/api/acp/runs').catch(() => 'failed');
    await f('/api/status').catch(() => undefined);
    expect(await read).toBe('failed');
    const base = vi.fn(async () => json({}));
    const g = bootFetchCache(base as unknown as typeof fetch, undefined, Promise.resolve(statusJson({ attached: true, root: '/r' })));
    await g('/api/status');
    await g('/api/canvas-doc');
    expect(base.mock.calls.map(([i]) => i)).toEqual(['/api/canvas-doc']);
  });
  it('opens when /api/status is not JSON (a static file host answers index.html, 200): reads do not wait the 20 s ceiling', async () => {
    const base = vi.fn(async (i: unknown) =>
      String(i) === '/api/status' ? new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }) : json({ ok: 1 }),
    );
    const f = bootFetchCache(base as unknown as typeof fetch);
    const read = f('/api/sessions');
    await f('/api/status');
    const won = await Promise.race([read.then(() => 'read'), new Promise((r) => setTimeout(() => r('waited'), 500))]);
    expect(won).toBe('read');
  });
  it('a write opens it', async () => {
    const base = vi.fn(async () => json({}));
    const f = bootFetchCache(base as unknown as typeof fetch);
    const read = f('/api/sessions');
    await f('/api/attach', { method: 'POST', body: '{}' });
    await read;
    expect(base).toHaveBeenCalledTimes(2);
  });
});

describe('the early list read', () => {
  const att = () => json({ attached: true, root: '/r' });
  it('answers the first list read when the first status already says attached', async () => {
    const base = vi.fn(async (i: unknown) => (String(i) === '/api/status' ? att() : json({ from: 'late' })));
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, true, Promise.resolve(json({ from: 'early' })));
    await f('/api/status');
    expect(await (await f('/api/sessions')).json()).toEqual({ from: 'early' });
    expect(base.mock.calls.map(([i]) => i)).toEqual(['/api/status']);
  });
  it('is dropped when the first status says the repository is still attaching', async () => {
    const base = vi.fn(async (i: unknown) =>
      String(i) === '/api/status' ? json({ attached: false, scanning: { done: 0, total: 1 } }) : json({ from: 'late' }),
    );
    const f = bootFetchCache(base as unknown as typeof fetch, undefined, null, true, Promise.resolve(json({ from: 'early' })));
    await f('/api/status');
    base.mockImplementation(async (i: unknown) => (String(i) === '/api/status' ? att() : json({ from: 'late' })));
    await f('/api/status');
    expect(await (await f('/api/sessions')).json()).toEqual({ from: 'late' });
  });
});

describe('boot asks the server each thing once', () => {
  const status = () => json({ attached: true, root: '/r' });
  it('concurrent and in-window GET /api/status share one request; sessions too', async () => {
    let t = 0;
    const base = vi.fn(async (i: unknown) => (i === '/api/status' ? status() : json([])));
    const f = bootFetchCache(base as unknown as typeof fetch, () => t, null, false);
    const [a, b] = await Promise.all([f('/api/status'), f('/api/status')]);
    t = 800;
    const c = await f('/api/status');
    await f('/api/sessions');
    await f('/api/sessions');
    expect(await a.json()).toEqual({ attached: true, root: '/r' });
    expect(await b.json()).toEqual({ attached: true, root: '/r' });
    expect(await c.json()).toEqual({ attached: true, root: '/r' });
    expect(base.mock.calls.filter(([i]) => i === '/api/status')).toHaveLength(1);
    expect(base.mock.calls.filter(([i]) => i === '/api/sessions')).toHaveLength(1);
  });
  it('the shared status is dropped after the boot window and by any write: polls stay fresh', async () => {
    let t = 0;
    const base = vi.fn(async () => status());
    const f = bootFetchCache(base as unknown as typeof fetch, () => t, null, false);
    await f('/api/status');
    await f('/api/attach', { method: 'POST', body: '{}' });
    await f('/api/status');
    expect(base.mock.calls.filter(([i]) => i === '/api/status')).toHaveLength(2);
    t = BOOT_CACHE_MS + 1;
    await f('/api/status');
    expect(base.mock.calls.filter(([i]) => i === '/api/status')).toHaveLength(3);
  });
  it('the page-prefetched status counts as the first answer and is shared', async () => {
    const base = vi.fn(async () => status());
    const f = bootFetchCache(base as unknown as typeof fetch, () => 0, Promise.resolve(status()), false);
    await Promise.all([f('/api/status'), f('/api/status'), f('/api/status')]);
    expect(base).toHaveBeenCalledTimes(0);
  });
});
