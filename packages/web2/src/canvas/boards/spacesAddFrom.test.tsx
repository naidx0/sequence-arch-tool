import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionIndexEntry } from '@sequence/api-types';

import '../../tokens/graphite.css';

import { setHostCommandHandler } from '../../app/hostCommands';
import { StoreProvider, createStore } from '../../state';
import { readShellPersisted, readShellTokens } from '../../shell';
import { ConnectedWhiteboard } from '../../whiteboard/ConnectedWhiteboard';
import { resetBoardsStreamForTests } from './boardsClient';
import { FakeEventSource, fakeBoardsServer } from './fakeBoardsServer';
import { installResizeObserver } from '../testResizeObserver';

/*
 * 0.1.8.4 (Jaden): "it should be an option to hit + and add from another chat but each chat has its own surface
 * workspaces". + is a small menu: New space, Add from another chat. Adding LINKS (the same board, no copy); removing it
 * from a chat unlinks, and deletes only when no chat is left.
 */

installResizeObserver();

const A = 'chat-a';
const B = 'chat-b';
const entry = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
const LIST = [entry(A, 'Fix the gateway'), entry(B, 'Plan billing')];

let server: ReturnType<typeof fakeBoardsServer>;
const posts = () => server.calls.filter((c) => c.startsWith('POST /api/boards') && !c.includes('/ops') && !c.includes('/link'));
const make = (name: string, chat: string) =>
  server.fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind: 'whiteboard', chat }) });

beforeEach(() => {
  server = fakeBoardsServer({ empty: true });
  vi.stubGlobal('fetch', server.fetch);
  vi.stubGlobal('EventSource', FakeEventSource);
  resetBoardsStreamForTests();
  localStorage.clear();
  setHostCommandHandler(() => undefined);
});
afterEach(() => {
  setHostCommandHandler(null);
  vi.unstubAllGlobals();
  resetBoardsStreamForTests();
});

function mountIn(chat: string) {
  const store = createStore({
    project: () => ({ nodes: [], edges: [] }) as never,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({ type: 'session/index', sessions: LIST, activeId: chat });
  return render(
    <StoreProvider store={store}>
      <ConnectedWhiteboard />
    </StoreProvider>,
  );
}
const tabs = () => screen.queryAllByRole('tab').filter((t) => t.getAttribute('data-board-kind') === 'whiteboard').map((t) => t.getAttribute('data-testid'));
const openPlus = async () => {
  await waitFor(() => expect((screen.getByTestId('board-tab-new') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('board-tab-new'));
};

describe('+ is a menu when a chat is open', () => {
  it('offers New space and Add from another chat, and makes nothing until one is chosen', async () => {
    await make('Mine', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    const before = posts().length;
    await openPlus();
    const menu = screen.getByTestId('board-tab-add-menu');
    expect(within(menu).getByTestId('board-tab-add-new').textContent).toBe('New board');
    expect(within(menu).getByTestId('board-tab-add-from').textContent).toBe('Add from another chat…');
    expect(posts()).toHaveLength(before);
  });

  it('New board makes a Space in this chat', async () => {
    await make('Mine', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    await openPlus();
    fireEvent.click(screen.getByTestId('board-tab-add-new'));
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(server.boards().filter((b) => b.kind === 'whiteboard').every((b) => b.chats?.[0] === A)).toBe(true);
    expect(screen.queryByTestId('board-tab-add-menu')).toBeNull();
  });
});

describe('Add from another chat', () => {
  it('lists the other chats Spaces grouped by chat title, and earlier Spaces last, never this chat own', async () => {
    await make('Mine', A);
    await make('Billing plan', B);
    await server.fetch('/api/boards/billing-plan/link', { method: 'POST', body: JSON.stringify({ chat: 'chat-gone' }) });
    await server.fetch('/api/boards', { method: 'POST', body: JSON.stringify({ name: 'Old sketch', kind: 'whiteboard' }) });
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    await openPlus();
    fireEvent.click(screen.getByTestId('board-tab-add-from'));
    await waitFor(() => expect(screen.getByTestId('board-tab-add-group-chat-b')).toBeTruthy());
    const groupB = screen.getByTestId('board-tab-add-group-chat-b');
    expect(groupB.textContent).toContain('Plan billing');
    expect(within(groupB).getByTestId('board-tab-add-chat-b-billing-plan').textContent).toBe('Billing plan');
    expect(screen.getByTestId('board-tab-add-group-chat-gone').textContent).toContain('Earlier chat');
    const earlier = screen.getByTestId('board-tab-add-group-earlier');
    expect(earlier.textContent).toContain('Earlier boards');
    expect(within(earlier).getByTestId('board-tab-add-earlier-old-sketch')).toBeTruthy();
    expect(screen.queryByTestId('board-tab-add-chat-a-mine')).toBeNull();
    const order = [...screen.getByTestId('board-tab-add-menu').children].map((c) => c.getAttribute('data-testid'));
    expect(order[order.length - 1]).toBe('board-tab-add-group-earlier');
  });

  it('picking one links it: same board, this chat added, no copy, and it shows here', async () => {
    await make('Mine', A);
    await make('Billing plan', B);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    const count = server.boards().length;
    await openPlus();
    fireEvent.click(screen.getByTestId('board-tab-add-from'));
    fireEvent.click(await screen.findByTestId('board-tab-add-chat-b-billing-plan'));
    await waitFor(() => expect(tabs()).toContain('board-tab-billing-plan'));
    expect(server.boards()).toHaveLength(count);
    expect(server.boards().find((b) => b.id === 'billing-plan')!.chats).toEqual([B, A]);
  });

  it('says so when no other chat has a Space', async () => {
    await make('Mine', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    await openPlus();
    fireEvent.click(screen.getByTestId('board-tab-add-from'));
    await waitFor(() => expect(screen.getByTestId('board-tab-add-status').textContent).toBe('No boards in other chats.'));
  });
});

describe('removing a Space from a chat', () => {
  it('unlinks a linked Space after the same confirmation, and the other chat keeps it and its drawing', async () => {
    await make('Billing plan', B);
    await server.fetch('/api/boards/billing-plan/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: A }) });
    await server.fetch('/api/boards/billing-plan/ops', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'put', item: { kind: 'text', id: 't1', at: { x: 1, y: 1 }, text: 'kept' } }] }),
    });
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-billing-plan']));
    fireEvent.click(screen.getByTestId('board-tab-delete-billing-plan'));
    expect(screen.getByTestId('board-delete-confirm').textContent).toMatch(/Remove "Billing plan" from this chat\?/);
    expect(screen.getByTestId('board-delete-ok').textContent).toBe('Remove from chat');
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    await waitFor(() => expect(server.boards().find((b) => b.id === 'billing-plan')!.chats).toEqual([B]));
    expect(server.items('billing-plan')).toHaveLength(1);
  });

  it('deletes a Space no other chat holds, still after asking', async () => {
    await make('Mine', A);
    await make('Second', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine', 'board-tab-second']));
    fireEvent.click(screen.getByTestId('board-tab-delete-second'));
    expect(screen.getByTestId('board-delete-confirm').textContent).toMatch(/Delete "Second"\?/);
    expect(server.boards().some((b) => b.id === 'second')).toBe(true);
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    await waitFor(() => expect(server.boards().some((b) => b.id === 'second')).toBe(false));
    expect(tabs()).toEqual(['board-tab-mine']);
  });
});

describe('review: the + menu is not clipped by the strip', () => {
  it('opens outside the scrolling strip (.board-tabs is overflow hidden), anchored with position fixed', async () => {
    await make('Mine', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    await openPlus();
    const menu = screen.getByTestId('board-tab-add-menu');
    expect(menu.closest('.board-tabs'), 'a menu inside .board-tabs is cut off by its overflow').toBeNull();
    expect(menu.closest('[data-testid="board-tab-add-wrap"]')).toBeNull();
    expect(menu.style.position).toBe('fixed');
    expect(within(menu).getByTestId('board-tab-add-from')).toBeTruthy();
  });

  it('still closes on Escape and on a press outside, and a picked chat still links', async () => {
    await make('Mine', A);
    mountIn(A);
    await waitFor(() => expect(tabs()).toEqual(['board-tab-mine']));
    await openPlus();
    fireEvent.pointerDown(within(screen.getByTestId('board-tab-add-menu')).getByTestId('board-tab-add-from'));
    expect(screen.queryByTestId('board-tab-add-menu')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('board-tab-add-menu')).toBeNull();
  });
});
