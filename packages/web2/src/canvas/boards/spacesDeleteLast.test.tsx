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
 * B7 (Jaden): "when you close the whiteboard right now it gives you an error and it doesn't actually close the page, so
 * if I delete whiteboard when I'm on the whiteboard section it should auto close the whiteboard page surface, because
 * there's nothing else to look at."
 *
 * The shape that was reported: on the Spaces surface, delete the only board. The tab answered the store's delete event
 * by reading the board it had been showing (gone, 404) and printed "This board could not be saved: no board ..." under
 * a "No spaces" note, on a surface that stayed open.
 */

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

const deleteBoard = async (id: string) => {
  await waitFor(() => expect(screen.getByTestId(`board-tab-delete-${id}`)).toBeTruthy());
  fireEvent.click(screen.getByTestId(`board-tab-delete-${id}`));
  fireEvent.click(screen.getByTestId('board-delete-ok'));
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('B7: deleting the last Space closes the Spaces surface, with no error text', () => {
  it('asks the shell to close the Spaces surface once the last board is gone', async () => {
    mount();
    await deleteBoard('whiteboard');
    await waitFor(() => expect(server.boards().map((b) => b.id)).toEqual(['architecture']));
    await waitFor(() => expect(asked).toContain('whiteboard.close'));
    expect(asked.filter((c) => c === 'whiteboard.close')).toHaveLength(1);
  });

  it('prints no "could not be saved" error for the board that was just deleted', async () => {
    mount();
    await deleteBoard('whiteboard');
    await waitFor(() => expect(server.boards()).toHaveLength(1));
    await settle();
    expect(screen.queryByTestId('wb-boards-error')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/could not be saved|no board/i);
  });

  it('does not close while another Space is left, and shows no error either', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('board-tab-new')).toBeTruthy());
    fireEvent.click(screen.getByTestId('board-tab-new'));
    await waitFor(() => expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('space-2'));
    await deleteBoard('space-2');
    await waitFor(() => expect(server.boards().map((b) => b.id)).toEqual(['architecture', 'whiteboard']));
    await settle();
    expect(asked).not.toContain('whiteboard.close');
    expect(screen.queryByTestId('wb-boards-error')).toBeNull();
    expect(screen.getByTestId('wb-boards').getAttribute('data-board')).toBe('whiteboard');
  });
});
