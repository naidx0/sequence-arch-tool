import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';
import { capChats } from './projectList';
import cssRaw from './shell2.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

const at = (m: number) => new Date(Date.UTC(2026, 9, 6, 0, m)).toISOString();
const chat = (id: string, title: string, m: number, extra: Partial<SessionIndexEntry> = {}): SessionIndexEntry =>
  ({ id, title, createdAt: at(m), updatedAt: at(m), ...extra }) as SessionIndexEntry;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  method: string;
  url: string;
}

function mount(sessions: SessionIndexEntry[], activeId: string, opts: { failFirst?: boolean; repos?: RepoSessionsSection[]; onOpenProject?: (p: string, id: string) => void } = {}) {
  const calls: Call[] = [];
  let failed = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    if (url === '/api/sessions' && method === 'GET') return json({ index: { version: 1, activeId, sessions }, scope: 'workspace', repos: opts.repos ?? [] });
    if (opts.failFirst && failed < 2 && (url === '/api/sessions/active' || (method === 'GET' && url.startsWith('/api/sessions/x')))) {
      failed++;
      return json({ error: 'boom' }, 500);
    }
    if (url === '/api/sessions/active') return json({ index: { version: 1, activeId: 'x', sessions } });
    return json({ session: { id: 'x', turns: [] }, chat: { turns: [] }, turns: [] });
  }) as typeof fetch;
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <SessionPanel client={createSessionsClient(fetchImpl)} onOpenProject={opts.onOpenProject ?? (() => undefined)} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
  return { calls, store };
}
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
const row = (id: string) => screen.getAllByTestId('s2-session').filter((r) => r.getAttribute('data-session-id') === id);
const hit = (el: HTMLElement) => el.querySelector<HTMLElement>('.s2-it-hit')!;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('review fixes: opening a chat', () => {
  it('a failed open can be retried by clicking its row again', async () => {
    const { calls } = mount([chat('h1', 'One', 9), chat('x', 'Target', 8)], 'h1', { failFirst: true });
    await waitFor(() => expect(row('x')).toHaveLength(1));
    fireEvent.click(hit(row('x')[0]!));
    await settle();
    expect(calls.filter((c) => c.url === '/api/sessions/active')).toHaveLength(1);
    fireEvent.click(hit(row('x')[0]!));
    await settle();
    expect(calls.filter((c) => c.url === '/api/sessions/active')).toHaveLength(2);
  });

  it('a load in flight is not started twice by its twin row', async () => {
    const { calls } = mount([chat('h1', 'One', 9), chat('x', 'Pinned', 8, { pinned: true })], 'h1');
    await waitFor(() => expect(row('x')).toHaveLength(2));
    fireEvent.click(hit(row('x')[0]!));
    fireEvent.click(hit(row('x')[1]!));
    await settle();
    expect(calls.filter((c) => c.url === '/api/sessions/active')).toHaveLength(1);
  });

  it('another project: a click on a different chat of a project that is opening is not swallowed; the same chat is deduped', async () => {
    const opened: string[] = [];
    const shop: RepoSessionsSection = { path: 'C:/work/shop', name: 'shop', index: { version: 1, activeId: 'a', sessions: [chat('a', 'Alpha', 5), chat('b', 'Beta', 4)] } };
    mount([chat('h1', 'One', 9)], 'h1', { repos: [shop], onOpenProject: (_p, id) => opened.push(id) });
    await waitFor(() => expect(screen.getAllByTestId('s2-project').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByLabelText('Unfold shop'));
    await waitFor(() => expect(row('a')).toHaveLength(1));
    fireEvent.click(hit(row('a')[0]!));
    fireEvent.click(hit(row('a')[0]!));
    expect(opened).toEqual(['a']);
    fireEvent.click(hit(row('b')[0]!));
    expect(opened).toEqual(['a', 'b']);
  });
});

describe('review fixes: the ten-chat cap and the Pinned count', () => {
  const rows = Array.from({ length: 12 }, (_, i) => chat(`c${i}`, `Chat ${i}`, 50 - i));

  it('capChats keeps the open chat when it is older than the newest ten', () => {
    const r = capChats(rows, false, 'c11');
    expect(r.shown.map((e) => e.id)).toEqual([...rows.slice(0, 10).map((e) => e.id), 'c11']);
    expect(r.hidden).toBe(1);
    expect(capChats(rows, false, 'c3').shown).toHaveLength(10); /* already inside the ten: nothing added */
    expect(capChats(rows, false, null).shown).toHaveLength(10);
  });

  it('the sidebar shows the open chat even as the 12th newest', async () => {
    mount(rows, 'c11');
    await waitFor(() => expect(screen.getByTestId('s2-show-all')).toBeTruthy());
    expect(row('c11')).toHaveLength(1);
  });

  it('the Pinned header carries a count only over 10 pinned chats', async () => {
    mount([chat('h1', 'One', 9), chat('p1', 'P1', 8, { pinned: true }), chat('p2', 'P2', 7, { pinned: true })], 'h1');
    await waitFor(() => expect(screen.getByTestId('s2-group-pinned')).toBeTruthy());
    expect(within(screen.getByTestId('s2-section-pinned')).queryByText('2')).toBeNull();
  });
});

describe('review fixes: the menus', () => {
  it('the row menu hairline is --edge, and the menu may grow to 300 px so no label overflows', () => {
    const r = rule('.s2-menu.s2-menu-row');
    expect(r).toContain('border: 1px solid var(--edge);');
    expect(r).toContain('max-width: 300px;');
  });

  it('the + menu import item is short, the full text is its title', async () => {
    const graph = { nodes: [], edges: [], warnings: [] };
    const store = createStore({ project: (g) => g as never, persisted: null });
    store.dispatch({ type: 'repo/loaded', draft: { root: 'C:/work/shop', repoName: 'shop', graph, summary: { nodes: 0, edges: 0 }, scannedAt: at(0) }, at: 0 } as never);
    render(
      <StoreProvider store={store}>
        <SessionPanel client={createSessionsClient((async () => json({ index: { version: 1, activeId: '', sessions: [] }, scope: 'repo', repos: [] })) as typeof fetch)} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('s2-workspaces-add'));
    const item = await screen.findByTestId('s2-import-toggle');
    expect(item.textContent).toBe('Import chats…');
    expect(item.getAttribute('title')).toBe('Import chats from Claude Code or Codex');
  });

  it('with no room on either side (a 360 px window) the + menu hangs below its button, not over it', async () => {
    mount([chat('h1', 'One', 9)], 'h1');
    const plus = await screen.findByTestId('s2-workspaces-add');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
      if (this === plus) return box(100, 250, 24, 24);
      if (this.classList.contains('s2-menu-row')) return box(0, 0, 260, 64);
      return box(0, 0, 0, 0);
    });
    fireEvent.click(plus);
    const menu = (await screen.findByRole('menu')) as HTMLElement;
    await waitFor(() => expect(menu.style.top).toBe('278px')); /* button bottom 274 + 4 */
  });
});
