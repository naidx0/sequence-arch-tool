import { describe, expect, it } from 'vitest';

import { createAgentRunStore, type AgentRun } from './agentRuns';
import { loadSavedRuns } from './savedRuns';

/* Round 10: a send after an answered run frees its held stream; saved history merges; a failed fetch is retryable. */

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 150));
};

function trackedFetch() {
  const enc = new TextEncoder();
  const aborted: boolean[] = [];
  const ctrls: ReadableStreamDefaultController<Uint8Array>[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }), { status: 200 });
    const at = aborted.length;
    aborted.push(false);
    const body = new ReadableStream<Uint8Array>({ start: (c) => void ctrls.push(c) });
    init?.signal?.addEventListener('abort', () => {
      aborted[at] = true;
      try {
        ctrls[at]!.error(new DOMException('aborted', 'AbortError'));
      } catch {
        /* closed */
      }
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, aborted, send: (i: number, e: Record<string, unknown>) => ctrls[i]!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)) };
}

const saved = (id: string): AgentRun => ({ id, sessionId: 'c', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: id, status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null });

describe('round 10 runtime in the page', () => {
  it('starting a send on a chat whose earlier run is answered stops that run stream', async () => {
    const b = trackedFetch();
    const store = createAgentRunStore({ clock: () => 1000, fetch: b.fetch });
    void store.start({ question: 'Explain HOLD', agentRef: 'claude', sessionId: 'c' }, b.fetch);
    await flush();
    b.send(0, { type: 'acp:turn', state: 'answered', text: 'ok' });
    await flush();
    expect(store.get().runs[0]!.status).toBe('done');
    void store.start({ question: 'next', agentRef: 'claude', sessionId: 'c' }, b.fetch);
    await flush();
    expect(b.aborted[0]).toBe(true);
    expect(b.aborted[1]).toBe(false);
    expect(store.get().runs[0]!.status).toBe('done');
    expect(store.get().runs[0]!.error).toBeNull();
    store.stop(store.get().runs[1]!.id);
    await flush();
  });

  it('hydrating after a send keeps the live run and puts saved history ahead of it, once', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, runs: [{ ...saved('live'), status: 'running' as const }] }));
    store.hydrate('c', [saved('old1'), saved('old2'), saved('live')]);
    expect(store.get().runs.map((r) => r.id)).toEqual(['old1', 'old2', 'live']);
    store.hydrate('c', [saved('old1')]);
    expect(store.get().runs).toHaveLength(3);
  });

  it('a failed saved-runs fetch is reported as null so it can be asked again', async () => {
    expect(await loadSavedRuns('c', async () => new Response('no', { status: 500 }))).toBeNull();
    expect(
      await loadSavedRuns('c', async () => {
        throw new Error('down');
      }),
    ).toBeNull();
    expect(await loadSavedRuns('c', async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }))).toEqual([]);
  });
});
