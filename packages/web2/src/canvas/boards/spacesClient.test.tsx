import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../tokens/graphite.css';

import { setHostCommandHandler, type HostCommandId } from '../../app/hostCommands';
import { StoreProvider, createStore } from '../../state';
import { readShellPersisted, readShellTokens } from '../../shell';
import { ConnectedWhiteboard } from '../../whiteboard/ConnectedWhiteboard';
import { askFromWhiteboard } from '../../whiteboard/whiteboardAsk';
import { resetBoardsStreamForTests } from './boardsClient';
import { FakeEventSource, fakeBoardsServer } from './fakeBoardsServer';
import { installResizeObserver } from '../testResizeObserver';

installResizeObserver();

let server: ReturnType<typeof fakeBoardsServer>;
const asked: HostCommandId[] = [];

beforeEach(() => {
  server = fakeBoardsServer();
  vi.stubGlobal('fetch', server.fetch);
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

function mount() {
  const store = createStore({
    project: () => ({ nodes: [], edges: [] }) as never,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  return render(
    <StoreProvider store={store}>
      <ConnectedWhiteboard />
    </StoreProvider>,
  );
}
const settle = () => new Promise((r) => setTimeout(r, 60));

describe('an untouched default board shows as Board (0.1.8.1 C9: Spaces holds boards)', () => {
  it('names the tab, its label, its delete control and the confirm Board, and the confirm button says board', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('board-tab-whiteboard')).toBeTruthy());
    expect(server.boards().find((b) => b.id === 'whiteboard')!.name).toBe('Whiteboard');
    const tab = screen.getByTestId('board-tab-whiteboard');
    expect(tab.textContent).toBe('Board');
    expect(tab.getAttribute('aria-label')).toBe('Board');
    expect(screen.getByTestId('board-tab-delete-whiteboard').getAttribute('aria-label')).toBe('Delete Board');
    fireEvent.click(screen.getByTestId('board-tab-delete-whiteboard'));
    expect(screen.getByTestId('board-delete-confirm').textContent).toMatch(/Delete "Board"\?/);
    expect(screen.getByTestId('board-delete-ok').textContent).toBe('Delete board');
    expect(document.body.textContent ?? '').not.toMatch(/whiteboard/i);
  });

  it('the ask text says Space, not whiteboard', () => {
    const request = askFromWhiteboard({ version: 1, items: [{ kind: 'text', id: 't', at: { x: 0, y: 0 }, text: 'idea' }] }, 'what is this?');
    expect(request?.prompt).toMatch(/Space sketch/);
    expect(request?.prompt).not.toMatch(/whiteboard sketch/i);
  });
});

describe('a save that fails after the person has left the Space is not the next Space\'s error', () => {
  it('holds the /ops answer, switches Space, then fails it: nothing is printed on the board now showing', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('board-tab-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('board-tab-new'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board-2'));
    /* from here every ops POST is held until we say */
    let release!: (r: Response) => void;
    const held = new Promise<Response>((r) => (release = r));
    const real = server.fetch;
    let sent = 0;
    let gone = false;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/ops') && init?.method === 'POST') {
        sent += 1;
        return held;
      }
      /* the Space it was drawn on is gone by the time the save fails: re-reading it answers 404 */
      if (gone && String(input).endsWith('/api/boards/board-2')) return Promise.resolve(new Response(JSON.stringify({ error: 'no board' }), { status: 404 }));
      return real(input, init);
    });
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    for (const [t, x, y] of [['pointerdown', 10, 10], ['pointermove', 30, 40], ['pointermove', 60, 15], ['pointerup', 60, 15]] as const) {
      fireEvent(canvas, new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }));
    }
    expect(sent).toBe(1);
    fireEvent.click(screen.getByTestId('board-tab-whiteboard'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    gone = true;
    release(new Response(JSON.stringify({ error: 'disk full' }), { status: 500, headers: { 'content-type': 'application/json' } }));
    await settle();
    expect(screen.queryByTestId('wb-boards-error')).toBeNull();
  });

  it('and a failure on the board that IS showing is still told', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard'));
    const real = server.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/ops') && init?.method === 'POST'
        ? Promise.resolve(new Response(JSON.stringify({ error: 'disk full' }), { status: 500, headers: { 'content-type': 'application/json' } }))
        : real(input, init),
    );
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    const canvas = screen.getByTestId('wb-canvas');
    for (const [t, x, y] of [['pointerdown', 10, 10], ['pointermove', 30, 40], ['pointermove', 60, 15], ['pointerup', 60, 15]] as const) {
      fireEvent(canvas, new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }));
    }
    await waitFor(() => expect(screen.getByTestId('wb-boards-error').textContent).toMatch(/disk full/));
  });
});

describe('the surface closes whenever the list of Spaces becomes empty, whoever emptied it', () => {
  it('an agent or another tab deleting the last Space closes it, once, with no error', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('board-tab-whiteboard')).toBeTruthy());
    /* not this tab's delete control: the store's own change, then its stream */
    await server.fetch('/api/boards/whiteboard', { method: 'DELETE' });
    await waitFor(() => expect(asked).toContain('whiteboard.close'));
    await settle();
    expect(asked.filter((c) => c === 'whiteboard.close')).toHaveLength(1);
    expect(screen.queryByTestId('wb-boards-error')).toBeNull();
  });

  it('a project that opens with no Space makes one (contract change: no "Spaces is empty" screen) and does not close the surface', async () => {
    await server.fetch('/api/boards/whiteboard', { method: 'DELETE' });
    mount();
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('board'));
    expect(screen.queryByTestId('wb-boards-none')).toBeNull();
    await settle();
    expect(asked).not.toContain('whiteboard.close');
  });
});
