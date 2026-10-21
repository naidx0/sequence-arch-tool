// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GENUI_ROUTE, HttpAgent } from './agent';

/** HttpAgent speaks the routes the analyzer serves (genuiRoutes.ts); the names are literal so the reachability scan sees them. */
describe('HttpAgent routes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the SSE stream and posts turn, action and repair at the served paths, for the session', async () => {
    const urls: string[] = [];
    class FakeES {
      onmessage: ((m: { data: string }) => void) | null = null;
      constructor(url: string) {
        urls.push(url);
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ kind: 'ui.end', surfaceId: 's' }) }));
      }
      close() {}
    }
    const posts: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('EventSource', FakeES);
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ops: [] }));
    });
    const agent = new HttpAgent(undefined, 'chat 1');
    const got: unknown[] = [];
    agent.subscribe((e) => got.push(e));
    agent.start('upgrade x');
    await Promise.resolve();
    agent.sendAction({ kind: 'ui.action', surfaceId: 's', name: 'fix', params: {}, elementId: 'b', state: {}, at: 1 });
    await agent.repair({ kind: 'ui.diagnostics', surfaceId: 's', issues: [], prompt: 'p', round: 1 });
    expect(urls).toEqual([`${GENUI_ROUTE.events}?session=chat%201`]);
    expect(got).toEqual([{ kind: 'ui.end', surfaceId: 's' }]);
    expect(posts.map((p) => p.url)).toEqual(['/api/genui/turn', '/api/genui/action', '/api/genui/repair']);
    expect(posts.every((p) => p.body.session === 'chat 1')).toBe(true);
  });

  it('a different base moves all four routes', async () => {
    const urls: string[] = [];
    vi.stubGlobal('EventSource', class { onmessage = null; constructor(u: string) { urls.push(u); } close() {} });
    vi.stubGlobal('fetch', async (u: string) => (urls.push(u), new Response('{}')));
    const agent = new HttpAgent('http://127.0.0.1:9/api/genui', 's');
    agent.start('hi');
    await Promise.resolve();
    expect(urls).toEqual(['http://127.0.0.1:9/api/genui/events?session=s', 'http://127.0.0.1:9/api/genui/turn']);
  });
});
