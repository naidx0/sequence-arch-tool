import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/* G10 on the rail: a chat whose last turn a restart cut off carries a small dot. */

const chat = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-06T09:00:00Z', updatedAt: '2026-10-06T09:00:00Z' }) as SessionIndexEntry;

function mount(interrupted: string[] | undefined) {
  const sessions = [chat('a', 'Refactor parser'), chat('b', 'Notes')];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === '/api/sessions' && (init?.method ?? 'GET') === 'GET'
      ? new Response(JSON.stringify({ index: { version: 1, activeId: 'a', sessions }, scope: 'workspace', repos: [], ...(interrupted ? { interrupted } : {}) }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('{}', { status: 404 })) as typeof fetch;
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={createSessionsClient(f)} />
    </StoreProvider>,
  );
}

/** A chat's row in the Workspaces tree (the flat Chats group is gone). */
const row = (title: string) => {
  const r = screen.getAllByTestId('s2-session').find((el) => el.textContent?.includes(title));
  if (!r) throw new Error(`no ${title} row`);
  return within(r).getByText(title);
};

beforeEach(() => localStorage.clear());

describe('the interrupted dot', () => {
  it('marks only the cut-off chat', async () => {
    mount(['a']);
    const parser = await waitFor(() => row('Refactor parser'));
    expect(parser.closest('button')!.querySelector('[data-testid="s2-interrupted"]')).toBeTruthy();
    expect(row('Notes').closest('button')!.querySelector('[data-testid="s2-interrupted"]')).toBeNull();
  });
  it('no dot when the server names none', async () => {
    mount(undefined);
    await waitFor(() => row('Refactor parser'));
    expect(screen.queryByTestId('s2-interrupted')).toBeNull();
  });
});
