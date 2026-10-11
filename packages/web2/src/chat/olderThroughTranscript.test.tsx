import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeLayout } from '../../test/support/fakeLayout';
import '../agents/agentRunFold';
import { createAgentRunStore } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { ChatTranscript } from './ChatTranscript';
import { resetKeptOpen } from './AgentRunThread';

/* The archive pager and the damaged-file notice survive the transcript going virtual (more than 60 rows)
   and a switch A -> B -> A, because they live in the run store and not in the layer. */

const saved = (id: string, n = 0) => ({ id, agentRef: 'claude', prompt: `ask ${id}`, text: `answer ${id}`, status: 'done', startedAt: n, endedAt: n + 1, tools: [] });
let restore: (() => void) | null = null;
beforeEach(() => void (restore = installFakeLayout()));
afterEach(() => {
  restore?.();
  vi.unstubAllGlobals();
  resetKeptOpen();
});

function mount(activeId: string, ids = ['ca', 'cb']) {
  const store = createStore({});
  const sessions = ids.map((id) => ({ id, title: id, pinned: false, updatedAt: '2026-10-06' }));
  store.dispatch({ type: 'session/index', sessions, activeId } as never);
  const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
  const view = render(
    <StoreProvider store={store}>
      <ChatTranscript turns={[]} renderTurn={() => null} tail={[]} empty={false} runStore={runs} />
    </StoreProvider>,
  );
  const go = (id: string) => act(() => store.dispatch({ type: 'session/index', sessions, activeId: id } as never));
  return { store, runs, view, go };
}

describe('older turns in the real transcript', () => {
  it('a chat with 200 shown turns and an archive shows the pager in the virtual layout, and it pages', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(u);
      if (u.includes('older=')) return new Response(JSON.stringify({ runs: [saved('old1', -5)], remaining: 0 }), { status: 200 });
      return new Response(JSON.stringify({ runs: Array.from({ length: 200 }, (_, i) => saved(`n${i}`, i)), archived: 1, damaged: { restored: true } }), { status: 200 });
    });
    const { runs } = mount('ca');
    expect((await screen.findByTestId('chat-older-note')).textContent).toMatch(/^1 older turn is saved/);
    expect(screen.getByTestId('chat-saved-note').textContent).toMatch(/restored from the last backup/);
    expect(runs.get().runs.length).toBe(200);
    await act(async () => void fireEvent.click(screen.getByTestId('chat-show-older')));
    await waitFor(() => expect(runs.get().runs[0]!.prompt).toBe('ask old1'));
    expect(screen.queryByTestId('chat-older-note')).toBeNull();
  });

  it('A (archived) -> B (archived) -> A still has A\'s pager', async () => {
    vi.stubGlobal('fetch', async (u: string) => {
      const chat = new URL(u, 'http://x').searchParams.get('chatId')!;
      return new Response(JSON.stringify({ runs: [saved(`${chat}-n`)], archived: chat === 'cc' ? 5 : 7 }), { status: 200 });
    });
    const { go } = mount('cc', ['cc', 'cd']);
    expect((await screen.findByTestId('chat-older-note')).textContent).toMatch(/^5 older/);
    go('cd');
    await waitFor(() => expect(screen.getByTestId('chat-older-note').textContent).toMatch(/^7 older/));
    go('cc');
    await waitFor(() => expect(screen.getByTestId('chat-older-note').textContent).toMatch(/^5 older/));
  });
});
