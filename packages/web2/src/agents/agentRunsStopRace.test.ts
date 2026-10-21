import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from './agentRuns';

/* On Windows the store's lazy `import('./agentRunner')` behind Stop resolves
   later than the agent lookup does, so the abort arrives after discovery has
   already answered. Here the stop is held back on purpose to force that order. */
vi.mock('./agentRunner', async (load) => {
  const m = await load<typeof import('./agentRunner')>();
  return { ...m, stopRun: (id: string) => void setTimeout(() => m.stopRun(id), 50) };
});

describe('Stop during agent discovery', () => {
  it('holds when discovery answers before the abort lands: no turn is sent', async () => {
    let reply!: (r: Response) => void;
    const f = vi.fn(async () => new Promise<Response>((r) => { reply = r; }));
    const store = createAgentRunStore({ fetch: f });
    const work = store.start({ question: 'q' });
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    store.stop(store.get().runs[0].id);
    expect(store.get().runs[0]).toMatchObject({ status: 'failed', error: 'Stopped.' });
    reply(new Response(JSON.stringify({ agents: [{ id: 'codex' }] })));
    expect((await work).status).toBe('failed');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
