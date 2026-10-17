import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { emptyScratchDoc, scratchKey, writeScratch } from './localScratch';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';

installResizeObserver();

function mountWithActiveId(activeId: string) {
  localStorage.removeItem(scratchKey('session-a'));
  localStorage.removeItem(scratchKey('session-b'));

  writeScratch(
    {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    },
    'session-a',
    {
      ...emptyScratchDoc('session-a'),
      nodes: [{ id: 'svc:orders', label: 'Orders', kind: 'service' }],
    },
  );

  const store = createStore({
    project: () => ({ nodes: [], edges: [] }) as never,
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'session/index',
    activeId,
    sessions: [
      {
        id: 'session-a',
        title: 'A',
        mode: 'code',
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: 'session-b',
        title: 'B',
        mode: 'code',
        createdAt: '2026-08-22T01:00:00.000Z',
        updatedAt: '2026-08-22T01:00:00.000Z',
      },
    ],
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
}

function cards(): string[] {
  return screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');
}

describe('architecture scratch is per session id', () => {
  it('a new chat (session-b) shows empty Architecture, not the previous session nodes', async () => {
    /* Legacy bug: every thread wrote to `sequence.arch-scratch.workspace`. */
    writeScratch(
      {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
      },
      'workspace',
      {
        ...emptyScratchDoc('workspace'),
        nodes: [{ id: 'svc:orders', label: 'Orders', kind: 'service' }],
      },
    );
    mountWithActiveId('session-b');
    await waitFor(() => {
      expect(screen.getByTestId('board-empty')).toBeTruthy();
    });
    expect(cards()).toEqual([]);
  });

  it('loads scratch for the active session when one exists', async () => {
    mountWithActiveId('session-a');
    await waitFor(() => {
      expect(cards()).toContain('Orders');
    });
  });

  it('without activeId in the store every thread still shares the legacy workspace key', () => {
    localStorage.clear();
    writeScratch(
      {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
      },
      'workspace',
      {
        ...emptyScratchDoc('workspace'),
        nodes: [{ id: 'svc:shared', label: 'Shared', kind: 'service' }],
      },
    );

    const store = createStore({
      project: () => ({ nodes: [], edges: [] }) as never,
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

    return waitFor(() => {
      expect(cards()).toContain('Shared');
    });
  });
});
