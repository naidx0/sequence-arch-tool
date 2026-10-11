import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';
import { CHAT_CAP, capChats, chatCountLabel } from './projectList';
import cssRaw from './shell2.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

/** n chats, newest first by id (c1 is the newest). */
const chats = (n: number): SessionIndexEntry[] =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(2026, 9, 6, 20 - i)).toISOString();
    return { id: `c${i + 1}`, title: `Chat ${i + 1}`, createdAt: t, updatedAt: t } as SessionIndexEntry;
  });

function mount(index: SessionIndexEntry[]) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') return new Response(JSON.stringify({ index: { version: 1, activeId: index[0]?.id ?? '', sessions: index }, scope: 'workspace', repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  render(
    <StoreProvider store={createStore({})}>
      <SessionPanel client={createSessionsClient(fetchImpl)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('the rule, as functions', () => {
  it('the cap is ten, and a count exists only over it', () => {
    expect(CHAT_CAP).toBe(10);
    expect([0, 1, 9, 10].map(chatCountLabel)).toEqual([null, null, null, null]);
    expect([11, 12, 40].map(chatCountLabel)).toEqual([11, 12, 40]);
  });

  it('ten or fewer show whole; eleven show ten with one hidden; expanded shows all', () => {
    const rows = chats(11);
    expect(capChats(rows.slice(0, 10), false)).toMatchObject({ hidden: 0 });
    expect(capChats(rows.slice(0, 10), false).shown).toHaveLength(10);
    expect(capChats(rows, false)).toMatchObject({ hidden: 1 });
    expect(capChats(rows, false).shown.map((r) => r.id)).toEqual(rows.slice(0, 10).map((r) => r.id));
    expect(capChats(rows, true)).toMatchObject({ hidden: 0 });
    expect(capChats(rows, true).shown).toHaveLength(11);
  });
});

describe('the sidebar draws it', () => {
  it('10 chats: no count, no Show all, all ten rows', async () => {
    mount(chats(10));
    await waitFor(() => expect(screen.getAllByTestId('s2-session')).toHaveLength(10));
    expect(screen.queryByTestId('s2-project-count')).toBeNull();
    expect(screen.queryByTestId('s2-show-all')).toBeNull();
  });

  it('12 chats: the count 12, the newest ten, a quiet "Show all 12" that opens the rest in place', async () => {
    mount(chats(12));
    await waitFor(() => expect(screen.getAllByTestId('s2-session')).toHaveLength(10));
    expect(screen.getByTestId('s2-project-count').textContent).toBe('12');
    const more = screen.getByTestId('s2-show-all');
    expect(more.textContent).toBe('Show all 12');
    expect(more.className).toContain('s2-empty');
    /* It sits under the ten, inside the same project list. */
    expect(more.parentElement?.className).toContain('s2-proj-chats');
    expect(screen.queryByText('Chat 11')).toBeNull();
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId('s2-session')).toHaveLength(12));
    expect(screen.queryByTestId('s2-show-all')).toBeNull();
    expect(screen.getByTestId('s2-project-count').textContent).toBe('12');
  });

  it('a search shows every match, not the first ten', async () => {
    mount(chats(12));
    await waitFor(() => expect(screen.getAllByTestId('s2-session')).toHaveLength(10));
    fireEvent.click(screen.getByTestId('s2-search-toggle'));
    fireEvent.change(screen.getByTestId('s2-search'), { target: { value: 'Chat' } });
    await waitFor(() => expect(screen.getAllByTestId('s2-session')).toHaveLength(12));
    expect(screen.queryByTestId('s2-show-all')).toBeNull();
  });

  it('the count sits in a box as wide as the + slot, text centred in it', () => {
    const r = rule('.s2-proj-count');
    expect(r).toContain('width: var(--target-min);');
    expect(r).toContain('right: var(--sp-4);'); /* the + slot's own offset */
    expect(r).toContain('height: var(--row-h);');
    expect(r).toContain('justify-content: center;');
    expect(r).toContain('align-items: center;');
  });
});
