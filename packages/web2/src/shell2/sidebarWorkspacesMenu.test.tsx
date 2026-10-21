import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import { createSessionsClient } from '../sessions/sessionsClient';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createStore, StoreProvider } from '../state';
import { SessionPanel } from './SessionPanel';

/* SessionPanel draws the import panel through React.lazy: load it before a test waits on it. */
beforeAll(async () => {
  await import('./ImportHistory');
}, 120_000);

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number): SessionIndexEntry => ({ id, title, createdAt: at(h), updatedAt: at(h) }) as SessionIndexEntry;

function mount(attached: boolean) {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), persisted: null });
  if (attached) {
    const graph = { nodes: [], edges: [], warnings: [] };
    store.dispatch({ type: 'repo/loaded', draft: { root: 'C:/work/shopfront', repoName: 'shopfront', graph, summary: { nodes: 0, edges: 0 }, scannedAt: at(0) }, at: 0 } as never);
  }
  const index = [chat('h1', 'Notes', 5)];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/sessions') return new Response(JSON.stringify({ index: { version: 1, activeId: 'h1', sessions: index }, scope: 'workspace', repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  render(
    <StoreProvider store={store}>
      <SessionPanel client={createSessionsClient(fetchImpl)} onOpenProject={() => undefined} onOpenWorkspace={() => undefined} />
    </StoreProvider>,
  );
  return store;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the Workspaces header has one + with a menu; the unexplained import icon is gone', () => {
  it('no import/download icon button in the header, with or without a project attached', async () => {
    mount(true);
    await screen.findByTestId('s2-workspaces-add');
    const header = screen.getByTestId('s2-group-workspaces').querySelector('.s2-gh') as HTMLElement;
    expect(within(header).queryByTestId('s2-import-toggle')).toBeNull();
    expect(header.querySelectorAll('button')).toHaveLength(2); /* the fold header and the + */
  });

  it('the + opens a menu with two labelled items: Open a project and the import', async () => {
    mount(true);
    fireEvent.click(await screen.findByTestId('s2-workspaces-add'));
    const menu = await screen.findByRole('menu', { name: 'Add to Workspaces' });
    const labels = [...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent);
    expect(labels).toEqual(['Open a project…', 'Import chats…']);
  });

  it('Open a project… opens the attach overlay (what the + did before)', async () => {
    const store = mount(true);
    fireEvent.click(await screen.findByTestId('s2-workspaces-add'));
    fireEvent.click(await screen.findByTestId('s2-open-project'));
    expect(store.getState().shell.overlay).toMatchObject({ kind: 'attach' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Import… shows the import panel, as the icon did, and closes the menu', async () => {
    mount(true);
    fireEvent.click(await screen.findByTestId('s2-workspaces-add'));
    fireEvent.click(await screen.findByTestId('s2-import-toggle'));
    expect(screen.queryByRole('menu')).toBeNull();
    await screen.findByTestId('s2-import');
  });

  it('with no project attached the import has nothing to read into, so the menu offers Open a project only (as the icon was hidden then)', async () => {
    mount(false);
    fireEvent.click(await screen.findByTestId('s2-workspaces-add'));
    const menu = await screen.findByRole('menu');
    expect([...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent)).toEqual(['Open a project…']);
  });

  it('the + says it has a menu, and reports it open', async () => {
    mount(true);
    const plus = await screen.findByTestId('s2-workspaces-add');
    expect(plus.getAttribute('aria-haspopup')).toBe('menu');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(plus);
    await screen.findByRole('menu');
    expect(plus.getAttribute('aria-expanded')).toBe('true');
  });
  it('the + menu opens beside the button, to its right, like a chat row menu', async () => {
    mount(true);
    const plus = await screen.findByTestId('s2-workspaces-add');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
      if (this === plus) return box(200, 250, 24, 24);
      if (this.classList.contains('s2-menu-row')) return box(0, 0, 220, 64);
      return box(0, 0, 0, 0);
    });
    fireEvent.click(plus);
    const menu = (await screen.findByRole('menu')) as HTMLElement;
    await waitFor(() => expect(menu.style.left).toBe('228px')); /* button right 224 + 4 */
    expect(menu.style.top).toBe('250px');
  });
});
