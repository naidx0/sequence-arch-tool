import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import '../tokens/graphite.css';
import './board.css';

import { setHostCommandHandler } from '../app/hostCommands';
import { summarizeGraph } from '../boot';
import { CanvasProvider } from './canvasChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';

/* P2-9: THE EMPTY BOARD SAYS WHAT IS ACTUALLY TRUE. With nothing read (no project open, or a folder the
   scan found nothing in), it said "The scan read this folder and found no services or datastores", and
   offered to draw from code that is not there. */

installResizeObserver();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setHostCommandHandler(null);
});

function mount(): Store {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null }) as Response));
  const store = createStore({
    /* The real projection, with every node it would draw taken off: the scan read code, the board places none. */
    project: (g) => ({ ...seqdFromGraph(g, g.nodeDetail), nodes: [], edges: [] }),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

function attach(store: Store, nodes: { id: string; label: string; kind: string; file?: string; line?: number }[]) {
  const graph = { repoName: 'lib', scannedAt: '2026-10-05T09:00:00.000Z', nodes, edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
  act(() => {
    store.dispatch({
      type: 'boot/settled',
      outcome: {
        kind: 'attached',
        repo: { root: '/home/max/lib', repoName: 'lib', graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt },
        platform: { reachable: true, detail: 'ok', at: 1 },
      },
    });
  });
}

const NO_CODE = 'This folder has no code Sequence can read yet.';

describe('empty-folder copy (P2-9)', () => {
  it('no project open: the no-project words, never "the scan read this folder"', async () => {
    const store = mount();
    const empty = await screen.findByTestId('board-empty');
    expect(empty.querySelector('.t')!.textContent).toBe('No graph yet');
    expect(empty.textContent).not.toMatch(/scan read this folder/);
    expect(empty.textContent).not.toContain(NO_CODE);
    fireEvent.click(screen.getByTestId('board-empty-action'));
    expect(screen.getByTestId('board-empty-action').textContent).toBe('Open a project');
    expect(store.getState().shell.overlay).toMatchObject({ kind: 'attach' });
  });

  it('a project whose scan read no source file: "This folder has no code Sequence can read yet." with Open another and Start from a sketch', async () => {
    const store = mount();
    const seen: string[] = [];
    setHostCommandHandler((id) => seen.push(id));
    attach(store, [{ id: 'repo:lib', label: 'lib', kind: 'repo' }]);
    await waitFor(() => expect(screen.getByTestId('board-empty').querySelector('.t')!.textContent).toBe(NO_CODE));
    expect(screen.getByTestId('board-empty').textContent).not.toMatch(/Draw it from the code/);
    fireEvent.click(screen.getByTestId('board-empty-action'));
    expect(screen.getByTestId('board-empty-action').textContent).toBe('Open another');
    expect(store.getState().shell.overlay).toMatchObject({ kind: 'attach' });
    fireEvent.click(screen.getByTestId('board-empty-secondary'));
    expect(screen.getByTestId('board-empty-secondary').textContent).toBe('Start from a sketch');
    expect(seen).toEqual(['canvas.whiteboard']);
  });

  it('a manifest-less folder WITH code (the t3code case) keeps "Draw it from the code"', async () => {
    const store = mount();
    attach(store, [
      { id: 'repo:lib', label: 'lib', kind: 'repo' },
      { id: 'file:src/math.ts', label: 'math.ts', kind: 'file', file: 'src/math.ts', line: 1 },
    ]);
    await waitFor(() => expect(screen.getByTestId('board-empty-action').textContent).toBe('Draw it from the code'));
    expect(screen.getByTestId('board-empty').textContent).not.toContain(NO_CODE);
    expect(screen.queryByTestId('board-empty-secondary')).toBeNull();
  });
});
