import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { WARM_HOVER_REST_MS } from '../v3/sessionActions';
import { resetSnapshotsForTest } from '../v3/sessionSnapshots';
import { SessionPanel } from './SessionPanel';

/*
 * Owner: "switching between different chats is giving me a lot of latency".
 * The rail's ONE hover read-ahead (warmSnapshot on rest, v3/sessionActions): a pointer
 * resting on a chat reads it into the snapshot cache, and the click takes the answer.
 */
const chat = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: 'x', updatedAt: 'x' }) as SessionIndexEntry;

beforeEach(() => {
  localStorage.clear();
  resetSnapshotsForTest();
});

function mount() {
  const index = [chat('a', 'Alpha'), chat('b', 'Beta')];
  const repos: RepoSessionsSection[] = [{ path: 'C:/work/other', name: 'other', index: { version: 1, activeId: 'o1', sessions: [chat('o1', 'Elsewhere')] } }];
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ index: { version: 1, activeId: 'a', sessions: index }, scope: 'workspace', repos }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const base = createSessionsClient(fetchImpl);
  const prefetchSession = vi.fn((id: string) => base.readSession(id));
  const client = { ...base, readSession: prefetchSession };
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={client} onOpenProject={vi.fn()} />
    </StoreProvider>,
  );
  return { prefetchSession };
}

it('a pointer resting on a chat in the workspace being read starts reading it; one sweeping past does not', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { prefetchSession } = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-session').length).toBeGreaterThan(1));
    const beta = screen.getAllByTestId('s2-session').find((r) => r.textContent === 'Beta')!.querySelector('.s2-it-hit') as HTMLElement;
    fireEvent.pointerEnter(beta);
    fireEvent.pointerLeave(beta);
    act(() => void vi.advanceTimersByTime(WARM_HOVER_REST_MS * 2));
    expect(prefetchSession).not.toHaveBeenCalled();
    fireEvent.pointerEnter(beta);
    act(() => void vi.advanceTimersByTime(WARM_HOVER_REST_MS + 5));
    expect(prefetchSession).toHaveBeenCalledWith('b');
  } finally {
    vi.useRealTimers();
  }
});

it('a chat in another workspace is not read ahead (it reloads the page, there is nothing to warm)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { prefetchSession } = mount();
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    const other = screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'other')!;
    fireEvent.click(within(other).getByTestId('s2-project-fold'));
    fireEvent.pointerEnter(within(other).getByText('Elsewhere').closest('.s2-it-hit')!);
    act(() => void vi.advanceTimersByTime(WARM_HOVER_REST_MS * 3));
    expect(prefetchSession).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
