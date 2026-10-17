import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';
import { createAgentRunStore } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { AgentChatLayer } from './AgentChatLayer';

/* The Opus walk of 2026-10-15: "node chips (api, worker) stay in the composer and ride along with later prompts".
   A board action pins its node as a chip for the run; the run being over takes the chip back. */

const entry = (over: Partial<SessionIndexEntry> = {}) => ({ id: 's1', title: 'New chat', createdAt: '', updatedAt: '', ...over }) as SessionIndexEntry;
afterEach(() => vi.unstubAllGlobals());

const sse = (...events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

function mount() {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }));
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [entry({ id: 'pin-1' })], activeId: 'pin-1' });
  const runs = createAgentRunStore();
  render(
    <StoreProvider store={store}>
      <AgentChatLayer empty runs={runs} />
    </StoreProvider>,
  );
  return { store, runs };
}

describe('a node pinned for a board action', () => {
  it('is a chip while the run works and gone when it is over', async () => {
    const { store, runs } = mount();
    const f = vi.fn(async (url: string) => (url === '/api/acp/agents' ? new Response(JSON.stringify({ agents: [{ id: 'codex' }] })) : sse({ type: 'acp:result', stopReason: 'end_turn', text: 'Done.' })));
    await act(async () => {
      await runs.start({ nodeId: 'svc:api', agentRef: 'codex', question: 'Explain', sessionId: 'pin-1' }, f as never);
    });
    expect(runs.get().runs[0]!.status).toBe('done');
    expect(store.getState().composer.chips.filter((c) => c.ref === 'svc:api')).toHaveLength(0);
  });

  it('never takes back a chip the person put there themselves', async () => {
    const { store, runs } = mount();
    store.dispatch({ type: 'composer/chip-add', chip: { id: 'node:svc:api', kind: 'node', ref: 'svc:api', label: 'api', nodeKind: null } });
    const f = vi.fn(async (url: string) => (url === '/api/acp/agents' ? new Response(JSON.stringify({ agents: [{ id: 'codex' }] })) : sse({ type: 'acp:result', stopReason: 'end_turn', text: 'Done.' })));
    await act(async () => {
      await runs.start({ nodeId: 'svc:api', agentRef: 'codex', question: 'Explain', sessionId: 'pin-1' }, f as never);
    });
    expect(store.getState().composer.chips.filter((c) => c.ref === 'svc:api')).toHaveLength(1);
  });
});
