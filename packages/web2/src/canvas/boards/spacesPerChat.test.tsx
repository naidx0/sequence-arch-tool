import { act, render, screen, waitFor } from '@testing-library/react';
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
 * 0.1.8.4 (Jaden): "spaces are auto shared with each chat in that workspace ... each chat has its own surface
 * workspaces". A Space belongs to the chat that made it; a chat lists its own and the architecture map.
 */

installResizeObserver();

const A = 'chat-a';
const B = 'chat-b';
const entry = (id: string, title: string): SessionIndexEntry => ({ id, title, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' });
const LIST = [entry(A, 'Fix the gateway'), entry(B, 'Plan billing')];

let server: ReturnType<typeof fakeBoardsServer>;
beforeEach(() => {
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
  const view = render(
    <StoreProvider store={store}>
      <ConnectedWhiteboard />
    </StoreProvider>,
  );
  return { store, ...view };
}
const whiteboardTabs = () => screen.queryAllByRole('tab').filter((t) => t.getAttribute('data-board-kind') === 'whiteboard');
const settle = () => new Promise((r) => setTimeout(r, 80));

describe('each chat has its own Spaces', () => {
  it('a chat that opens Spaces gets its own, recorded against it, and the architecture map stays in every chat', async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    mountIn(A);
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    expect(screen.getByTestId('board-tab-architecture')).toBeTruthy();
    expect(server.boards().find((b) => b.kind === 'whiteboard')!.chats).toEqual([A]);
  });

  it("another chat does not see this chat's Space, and makes its own", async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    const first = mountIn(A);
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    first.unmount();
    mountIn(B);
    await waitFor(() => expect(server.boards().filter((b) => b.kind === 'whiteboard')).toHaveLength(2));
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    const boards = server.boards().filter((b) => b.kind === 'whiteboard');
    expect(boards.map((b) => b.chats)).toEqual([[A], [B]]);
    expect(whiteboardTabs()[0]!.getAttribute('data-testid')).toBe(`board-tab-${boards[1]!.id}`);
  });

  it('switching chat on the open surface swaps to that chat list, without leaking the old one', async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    const { store } = mountIn(A);
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    const aTab = whiteboardTabs()[0]!.getAttribute('data-testid');
    act(() => store.dispatch({ type: 'session/index', sessions: LIST, activeId: B }));
    await waitFor(() => expect(server.boards().filter((b) => b.kind === 'whiteboard')).toHaveLength(2));
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    expect(whiteboardTabs()[0]!.getAttribute('data-testid')).not.toBe(aTab);
    await settle();
    expect(server.boards().filter((b) => b.kind === 'whiteboard')).toHaveLength(2);
  });

  it('a Space from before the chats field is in no chat; the chat makes its own and the old one is kept', async () => {
    server = fakeBoardsServer();
    vi.stubGlobal('fetch', server.fetch);
    mountIn(A);
    await waitFor(() => expect(server.boards().filter((b) => b.kind === 'whiteboard')).toHaveLength(2));
    await waitFor(() => expect(whiteboardTabs()).toHaveLength(1));
    expect(screen.queryByTestId('board-tab-whiteboard')).toBeNull();
    expect(server.boards().some((b) => b.id === 'whiteboard')).toBe(true);
  });
});
