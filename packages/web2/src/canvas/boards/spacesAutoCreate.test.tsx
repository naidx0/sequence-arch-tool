import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../tokens/graphite.css';

import { setHostCommandHandler, type HostCommandId } from '../../app/hostCommands';
import { StoreProvider, createStore } from '../../state';
import { readShellPersisted, readShellTokens } from '../../shell';
import { ConnectedWhiteboard } from '../../whiteboard/ConnectedWhiteboard';
import { resetBoardsStreamForTests } from './boardsClient';
import { FakeEventSource, fakeBoardsServer } from './fakeBoardsServer';
import { installResizeObserver } from '../testResizeObserver';

/*
 * 0.1.8.4 (Jaden): "when you open up spaces with an empty space it opens an ugly screen that says no spaces, make sure
 * that the spaces when opened up to no space creates a new space by default."
 */

installResizeObserver();

let server: ReturnType<typeof fakeBoardsServer>;
const asked: HostCommandId[] = [];
const posts = () => server.calls.filter((c) => c.startsWith('POST /api/boards') && !c.includes('/ops'));

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  resetBoardsStreamForTests();
  localStorage.clear();
  asked.length = 0;
  setHostCommandHandler((id) => void asked.push(id));
});
afterEach(() => {
  setHostCommandHandler(null);
  vi.unstubAllGlobals();
  resetBoardsStreamForTests();
});

function mount(strict = false) {
  const store = createStore({
    project: () => ({ nodes: [], edges: [] }) as never,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  const tree = (
    <StoreProvider store={store}>
      <ConnectedWhiteboard />
    </StoreProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
const settle = () => new Promise((r) => setTimeout(r, 80));

describe('opening Spaces with none makes one', () => {
  it('creates a Space, shows it ready to draw, and never shows the empty screen', async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    mount();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board'));
    expect(screen.getByTestId('wb-canvas')).toBeTruthy();
    expect(screen.queryByTestId('wb-boards-none')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/Spaces is empty/);
    expect(server.boards().map((b) => b.id)).toEqual(['architecture', 'board']);
    expect(posts()).toHaveLength(1);
    await settle();
    expect(posts()).toHaveLength(1);
  });

  it('draws the new Space as soon as the create answers, without waiting for the list to be read again (first open, perf 0.1.8.4)', async () => {
    server = fakeBoardsServer({ empty: true });
    let lists = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      /* The first list read is answered; every later one never is. */
      if (String(input) === '/api/boards' && (init?.method ?? 'GET') === 'GET' && ++lists > 1) return new Promise<Response>(() => {});
      return server.fetch(input, init);
    });
    mount();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board'));
    expect(screen.getByTestId('wb-canvas')).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it('is one create under a StrictMode double effect', async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    mount(true);
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board'));
    await settle();
    expect(posts()).toHaveLength(1);
    expect(server.boards().filter((b) => b.kind === 'whiteboard')).toHaveLength(1);
  });

  it('is one create when the surface is opened twice at once', async () => {
    server = fakeBoardsServer({ empty: true });
    vi.stubGlobal('fetch', server.fetch);
    mount();
    mount();
    await waitFor(() => expect(screen.getAllByTestId('wb-boards').every((e) => e.getAttribute('data-board') === 'board')).toBe(true));
    await settle();
    expect(posts()).toHaveLength(1);
  });

  it('makes nothing while the list is still loading', async () => {
    server = fakeBoardsServer({ empty: true });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/boards' && (init?.method ?? 'GET') === 'GET') await held;
      return server.fetch(input, init);
    });
    mount();
    await settle();
    expect(posts()).toHaveLength(0);
    release();
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('makes nothing when a Space is already there', async () => {
    server = fakeBoardsServer();
    vi.stubGlobal('fetch', server.fetch);
    mount();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    await settle();
    expect(posts()).toHaveLength(0);
  });

  it('does not make another when the last Space is deleted (that closes the surface)', async () => {
    server = fakeBoardsServer();
    vi.stubGlobal('fetch', server.fetch);
    mount();
    await waitFor(() => expect(screen.getByTestId('board-tab-delete-whiteboard')).toBeTruthy());
    fireEvent.click(screen.getByTestId('board-tab-delete-whiteboard'));
    fireEvent.click(screen.getByTestId('board-delete-ok'));
    await waitFor(() => expect(asked).toContain('whiteboard.close'));
    await settle();
    expect(posts()).toHaveLength(0);
  });
});
