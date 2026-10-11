import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/* A pinned chat shows its pin in its own project (or Worktrees) list, not in the Pinned group where it is already pinned. */

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number, extra: Partial<SessionIndexEntry> = {}): SessionIndexEntry =>
  ({ id, title, createdAt: at(h), updatedAt: at(h), ...extra }) as SessionIndexEntry;
const SHOP = 'C:/work/shopfront';

function wired(repos: RepoSessionsSection[], index: SessionIndexEntry[]) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') {
      return new Response(JSON.stringify({ index: { version: 1, activeId: index[0]?.id ?? '', sessions: index }, scope: 'workspace', repos }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/recent') return new Response(JSON.stringify({ recent: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

beforeEach(() => localStorage.clear());

describe('a pinned chat carries its pin in its project list', () => {
  const repos: RepoSessionsSection[] = [
    {
      path: SHOP,
      name: 'shopfront',
      index: {
        version: 1,
        activeId: 'p1',
        sessions: [chat('p1', 'Rate limiting', 9, { pinned: true }), chat('u1', 'Orders health', 11)],
      },
    },
  ];

  async function mountOpen() {
    render(
      <StoreProvider store={createStore({})}>
        <SessionPanel client={wired(repos, repos[0]!.index.sessions)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(1));
    fireEvent.click(screen.getByLabelText('Unfold shopfront'));
    await waitFor(() => expect(screen.getAllByTestId('s2-session').some((r) => r.getAttribute('data-session-id') === 'u1' && r.getAttribute('data-pinned-group') !== 'true')).toBe(true));
  }

  const projectRow = (id: string) =>
    screen.getAllByTestId('s2-session').find((r) => r.getAttribute('data-session-id') === id && r.getAttribute('data-pinned-group') !== 'true')!;
  const pinnedRow = (id: string) => within(screen.getByTestId('s2-group-pinned')).getAllByTestId('s2-session').find((r) => r.getAttribute('data-session-id') === id)!;

  it('the pinned chat in its project list shows a pin icon after its title', async () => {
    await mountOpen();
    const row = projectRow('p1');
    const pin = row.querySelector('.s2-pin-mark');
    expect(pin).not.toBeNull();
    expect(pin!.getAttribute('data-icon')).toBe('pin');
    expect(pin!.getAttribute('aria-hidden')).toBe('true');
    /* The pin sits after the title, inside the row's own hit button, and does not change the accessible name. */
    const hit = row.querySelector('.s2-it-hit')!;
    expect(hit.textContent).toBe('Rate limiting');
    expect(hit.querySelector('.s2-t')!.nextElementSibling).toBe(pin);
  });

  it('the same chat in the Pinned group has no pin icon', async () => {
    await mountOpen();
    expect(pinnedRow('p1').querySelector('.s2-pin-mark')).toBeNull();
  });

  it('an unpinned chat in its project list has no pin icon', async () => {
    await mountOpen();
    expect(projectRow('u1').querySelector('.s2-pin-mark')).toBeNull();
  });
});
