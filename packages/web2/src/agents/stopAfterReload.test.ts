import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from './agentRuns';
import { fromSavedRun } from './savedRuns';

/* Stop on a turn that was already running when the page loaded has no stream to drop: it asks the server. */
describe('Stop after a reload mid-turn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the turn id to /api/acp/stop and frees the chat at once', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
      return new Response(JSON.stringify({ stopped: true }), { status: 200 });
    }));
    const store = createAgentRunStore();
    const run = fromSavedRun({ id: 'turn-9', agentRef: 'claude', prompt: 'p', text: '', status: 'running', startedAt: 1, tools: [] }, 'chat-1')!;
    store.hydrate('chat-1', [run]);
    expect(store.get().runs[0]!.status).toBe('running');
    store.stop('saved-turn-9');
    expect(store.get().runs[0]!.status).toBe('failed');
    /* The page also follows the running turn (GET /api/acp/attach); the Stop is the one POST. */
    await vi.waitFor(() => expect(calls.filter((c) => c.url === '/api/acp/stop')).toEqual([{ url: '/api/acp/stop', body: { turnId: 'turn-9' } }]));
  });
});
