import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionIndexEntry } from '@sequence/api-types';
import { createAgentRunStore } from '../agents/agentRuns';
import { CHAT_TITLE_EVENT } from '../agents/savedRuns';
import { createStore, StoreProvider } from '../state';
import { AgentChatLayer } from './AgentChatLayer';
import { ChatTitle } from './ChatTitle';

/* Round 9 (items 6 and 7): an agent chat comes back after a relaunch, and the
   title the server writes from its first exchange reaches the header. */

const entry = (over: Partial<SessionIndexEntry> = {}) => ({ id: 's1', title: 'New chat', createdAt: '', updatedAt: '', ...over }) as SessionIndexEntry;

afterEach(() => vi.unstubAllGlobals());

describe('the chat layer restores agent chats and takes their titles', () => {
  it('asks the server for the open chat\'s saved turns once, and draws them', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      calls.push(input);
      return new Response(JSON.stringify({ runs: [{ id: 't1', agentRef: 'claude', prompt: 'Explain the parser', text: 'It is a Pratt parser.', status: 'done', startedAt: 1, endedAt: 2, tools: [] }] }), { status: 200 });
    });
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 'restore-1' })], activeId: 'restore-1' });
    const runs = createAgentRunStore();
    const view = render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={runs} />
      </StoreProvider>,
    );
    await act(async () => await new Promise((r) => setTimeout(r, 30)));
    /* The refine notes card reads its own endpoint (/api/harness/refine/cards) as the layer mounts, at a time that depends on the machine; this test counts the reads of the chat's turns. */
    const turnReads = () => calls.filter((c) => c.startsWith('/api/acp/runs'));
    expect(turnReads()).toEqual(['/api/acp/runs?chatId=restore-1']);
    expect(runs.get().runs.map((r) => r.prompt)).toEqual(['Explain the parser']);
    expect(runs.get().agents?.['restore-1']).toBe('claude');
    expect(await screen.findByText('It is a Pratt parser.')).toBeTruthy();
    view.rerender(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={runs} />
      </StoreProvider>,
    );
    expect(turnReads()).toHaveLength(1);
  });

  it('a title from the server renames the chat in the header; a person\'s rename is kept', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ runs: [] }), { status: 200 }));
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 's1' }), entry({ id: 's2', title: 'Mine', titleEdited: true })], activeId: 's1' });
    render(
      <StoreProvider store={store}>
        <ChatTitle />
        <AgentChatLayer empty runs={createAgentRunStore()} />
      </StoreProvider>,
    );
    expect(screen.getByText('New chat')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_TITLE_EVENT, { detail: { sessionId: 's1', title: 'Fix the flaky login test' } }));
      window.dispatchEvent(new CustomEvent(CHAT_TITLE_EVENT, { detail: { sessionId: 's2', title: 'Something else' } }));
    });
    expect(screen.getByText('Fix the flaky login test')).toBeTruthy();
    expect(store.getState().session.sessions.find((s) => s.id === 's2')!.title).toBe('Mine');
  });
});

describe('a chat whose saved file is damaged says so', () => {
  it('shows the notice the server sends, and the turns it restored', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ runs: [{ id: 't1', agentRef: 'claude', prompt: 'Explain', text: 'Answer', status: 'done', startedAt: 1, endedAt: 2, tools: [] }], damaged: { restored: true }, archived: 2 }), { status: 200 }));
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 'damaged-1' })], activeId: 'damaged-1' });
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={createAgentRunStore()} />
      </StoreProvider>,
    );
    expect((await screen.findByTestId('chat-saved-note')).textContent).toMatch(/restored from the last backup/);
  });

  it('says how many older turns are kept off screen', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ runs: [], archived: 3 }), { status: 200 }));
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 'archived-1' })], activeId: 'archived-1' });
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={createAgentRunStore()} />
      </StoreProvider>,
    );
    expect((await screen.findByTestId('chat-older-note')).textContent).toMatch(/^3 older turns are saved on disk but not shown here\./);
  });
});

describe('older turns and a turn still running', () => {
  const saved = (id: string, over: Record<string, unknown> = {}) => ({ id, agentRef: 'claude', prompt: `ask ${id}`, text: `answer ${id}`, status: 'done', startedAt: 1, endedAt: 2, tools: [], ...over });

  it('"Show older turns" pages the archive in, ahead of the newest, until none remain', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      urls.push(input);
      if (input.includes('older=0')) return new Response(JSON.stringify({ runs: [saved('o2'), saved('o3')], remaining: 1 }), { status: 200 });
      if (input.includes('older=2')) return new Response(JSON.stringify({ runs: [saved('o1')], remaining: 0 }), { status: 200 });
      return new Response(JSON.stringify({ runs: [saved('n1')], archived: 3 }), { status: 200 });
    });
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 'pager-1' })], activeId: 'pager-1' });
    const runs = createAgentRunStore();
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={runs} />
      </StoreProvider>,
    );
    expect((await screen.findByTestId('chat-older-note')).textContent).toMatch(/^3 older turns are saved on disk but not shown here\./);
    await act(async () => void screen.getByTestId('chat-show-older').click());
    await waitFor(() => expect(runs.get().runs.map((r) => r.prompt)).toEqual(['ask o2', 'ask o3', 'ask n1']));
    expect(screen.getByTestId('chat-older-note').textContent).toMatch(/^1 older turn is saved/);
    await act(async () => void screen.getByTestId('chat-show-older').click());
    await waitFor(() => expect(runs.get().runs.map((r) => r.prompt)).toEqual(['ask o1', 'ask o2', 'ask o3', 'ask n1']));
    expect(screen.queryByTestId('chat-older-note')).toBeNull();
    expect(urls.filter((u) => u.includes('older='))).toEqual(['/api/acp/runs?chatId=pager-1&older=0', '/api/acp/runs?chatId=pager-1&older=2']);
  });

  it('a page reloaded mid-turn shows that turn as running, then as finished when the server says so', async () => {
    let finished = false;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ runs: [saved('t1', finished ? { text: 'all done' } : { status: 'running', text: 'half' })] }), { status: 200 }));
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [entry({ id: 'live-1' })], activeId: 'live-1' });
    const runs = createAgentRunStore();
    render(
      <StoreProvider store={store}>
        <AgentChatLayer empty runs={runs} />
      </StoreProvider>,
    );
    await waitFor(() => expect(runs.get().runs[0]?.status).toBe('running'));
    expect(runs.get().runs[0]!.endedAt).toBeNull();
    finished = true;
    await waitFor(() => expect(runs.get().runs[0]?.status).toBe('done'), { timeout: 6000 });
    expect(runs.get().runs[0]!.items.some((i) => i.kind === 'message' && i.text === 'all done')).toBe(true);
  }, 10000);
});
