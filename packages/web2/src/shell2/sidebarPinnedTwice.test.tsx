import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number, extra: Partial<SessionIndexEntry> = {}): SessionIndexEntry =>
  ({ id, title, createdAt: at(h), updatedAt: at(h), ...extra }) as SessionIndexEntry;

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** The home workspace is the open project: h1 is open, h2 is pinned. Every request is recorded, GETs too. */
function mount() {
  const calls: Call[] = [];
  let sessions = [chat('h1', 'Open chat', 9), chat('h2', 'Pinned chat', 8, { pinned: true })];
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if (url === '/api/sessions' && method === 'GET') return json({ index: { version: 1, activeId: 'h1', sessions }, scope: 'workspace', repos: [] });
    if (method === 'PUT' && url.includes('/api/sessions/h2') && !url.includes('activate')) {
      sessions = sessions.map((e) => (e.id === 'h2' ? { ...e, ...(JSON.parse(String(init?.body)) as object) } : e));
      return json({ index: { version: 1, activeId: 'h1', sessions } });
    }
    return json({ index: { version: 1, activeId: 'h2', sessions }, session: { id: 'h2', turns: [] }, turns: [] });
  }) as typeof fetch;
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <SessionPanel client={createSessionsClient(fetchImpl)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
  return { calls, store };
}

const twins = () => screen.getAllByTestId('s2-session').filter((r) => r.getAttribute('data-session-id') === 'h2');
const hit = (row: HTMLElement) => row.querySelector<HTMLElement>('.s2-it-hit')!;
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 25));
  });

beforeEach(() => localStorage.clear());

describe('a pinned chat is two rows with one chat behind them', () => {
  it('shows in Pinned and in its project; clicking one opens it, clicking its twin loads nothing more', async () => {
    const { calls, store } = mount();
    await waitFor(() => expect(twins()).toHaveLength(2));
    const [inPinned, inProject] = twins();
    expect(within(screen.getByTestId('s2-group-pinned')).getAllByTestId('s2-session')).toContain(inPinned);
    expect(inProject!.closest('.s2-proj-chats')).not.toBeNull();

    const before = calls.length;
    fireEvent.click(hit(inPinned!));
    await waitFor(() => expect(store.getState().session.activeId).toBe('h2'));
    await settle();
    const afterFirst = calls.length;
    expect(afterFirst).toBeGreaterThan(before); /* positive control: the first click does load it */

    fireEvent.click(hit(twins()[1]!));
    await settle();
    expect(calls.length).toBe(afterFirst); /* the twin is the open chat already: no second fetch */
  });

  it('both rows carry the active state, and only the active chat does', async () => {
    const { store } = mount();
    await waitFor(() => expect(twins()).toHaveLength(2));
    expect(twins().some((r) => r.classList.contains('is-on'))).toBe(false);
    fireEvent.click(hit(twins()[0]!));
    await waitFor(() => expect(store.getState().session.activeId).toBe('h2'));
    await waitFor(() => expect(twins().every((r) => r.classList.contains('is-on'))).toBe(true));
    expect(twins().every((r) => hit(r).getAttribute('aria-current') === 'true')).toBe(true);
    const others = screen.getAllByTestId('s2-session').filter((r) => r.getAttribute('data-session-id') !== 'h2');
    expect(others.some((r) => r.classList.contains('is-on'))).toBe(false);
  });

  it('a row menu opens for the row it was asked on, not for its twin', async () => {
    mount();
    await waitFor(() => expect(twins()).toHaveLength(2));
    fireEvent.click(twins()[1]!.querySelector('.s2-it-more')!);
    await screen.findByRole('menu');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(twins()[1]!.querySelector('.s2-it-more')!.getAttribute('aria-expanded')).toBe('true');
    expect(twins()[0]!.querySelector('.s2-it-more')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('Unpin removes the chat from Pinned only: it stays in its project list', async () => {
    const { calls } = mount();
    await waitFor(() => expect(twins()).toHaveLength(2));
    fireEvent.click(twins()[0]!.querySelector('.s2-it-more')!);
    fireEvent.click(await screen.findByText('Unpin'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body?.pinned === false)).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('s2-group-pinned')).toBeNull());
    const left = twins();
    expect(left).toHaveLength(1);
    expect(left[0]!.closest('.s2-proj-chats')).not.toBeNull();
  });
});
