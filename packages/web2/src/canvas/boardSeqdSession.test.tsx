import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider, useDoc } from './docChannel';
import { emptyScratchDoc } from './localScratch';
import { toBoardSeqd } from '../sessions/boardMemory';
import { installResizeObserver } from './testResizeObserver';
import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';

installResizeObserver();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.removeItem(`sequence.arch-scratch.${SESSION_A}`);
    localStorage.removeItem(`sequence.arch-scratch.${SESSION_B}`);
  } catch {
    /* jsdom may lack storage in some runners */
  }
});

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const BOARD_A = {
  ...emptyScratchDoc(SESSION_A),
  nodes: [{ id: 'svc:orders', label: 'Orders', kind: 'service' as const }],
};

const BOARD_B = {
  ...emptyScratchDoc(SESSION_B),
  nodes: [{ id: 'svc:auth', label: 'Auth', kind: 'service' as const }],
};

function cards(): string[] {
  return screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');
}

function stubSessionsFetch(boards: Record<string, string | undefined>) {
  const puts: { id: string; boardSeqd: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      const sessionMatch = /\/api\/sessions\/([^/]+)$/.exec(path);
      if (sessionMatch && method === 'GET') {
        const id = decodeURIComponent(sessionMatch[1]!);
        const boardSeqd = boards[id];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chat: { version: 1, sessionId: id, turns: [] },
            meta: {},
            ...(boardSeqd ? { boardSeqd } : {}),
          }),
        } as Response;
      }
      if (sessionMatch && method === 'PUT') {
        const id = decodeURIComponent(sessionMatch[1]!);
        const body = JSON.parse(String(init?.body ?? '{}')) as { boardSeqd?: string };
        if (typeof body.boardSeqd === 'string') puts.push({ id, boardSeqd: body.boardSeqd });
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, index: { version: 1, activeId: id, sessions: [] } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => null } as Response;
    }),
  );
  return puts;
}

function mountBoard(activeId: string) {
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
        id: SESSION_A,
        title: 'A',
        mode: 'code',
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
      {
        id: SESSION_B,
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

  return store;
}

describe('architecture boardSeqd is per session', () => {
  it('hydrates session A from boardSeqd and session B stays empty', async () => {
    stubSessionsFetch({
      [SESSION_A]: toBoardSeqd(BOARD_A),
      [SESSION_B]: undefined,
    });

    mountBoard(SESSION_A);
    await waitFor(() => {
      expect(cards()).toContain('Orders');
    });

    cleanup();
    mountBoard(SESSION_B);
    await waitFor(() => {
      expect(screen.getByTestId('board-empty')).toBeTruthy();
    });
    expect(cards()).toEqual([]);
  });

  it('session A board ≠ session B after switch — each hydrates its own boardSeqd', async () => {
    stubSessionsFetch({
      [SESSION_A]: toBoardSeqd(BOARD_A),
      [SESSION_B]: toBoardSeqd(BOARD_B),
    });

    mountBoard(SESSION_A);
    await waitFor(() => expect(cards()).toContain('Orders'));
    expect(cards()).not.toContain('Auth');

    cleanup();
    mountBoard(SESSION_B);
    await waitFor(() => expect(cards()).toContain('Auth'));
    expect(cards()).not.toContain('Orders');
  });

  it('persists a meaningful board edit via PUT boardSeqd', async () => {
    const puts = stubSessionsFetch({
      [SESSION_A]: toBoardSeqd(BOARD_A),
    });

    const store = createStore({
      project: () => ({ nodes: [], edges: [] }) as never,
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    store.dispatch({
      type: 'session/index',
      activeId: SESSION_A,
      sessions: [
        {
          id: SESSION_A,
          title: 'A',
          mode: 'code',
          createdAt: '2026-08-22T00:00:00.000Z',
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
      ],
    });

    function Probe() {
      const { dispatch } = useDoc();
      return (
        <button
          type="button"
          data-testid="add-payments"
          onClick={() =>
            dispatch({
              type: 'doc/add-node',
              id: 'svc:payments',
              label: 'Payments',
              kind: 'service',
            })
          }
        >
          add
        </button>
      );
    }

    render(
      <StoreProvider store={store}>
        <CanvasProvider>
          <DocProvider>
            <ConnectedBoard />
            <Probe />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );

    await waitFor(() => expect(cards()).toContain('Orders'));
    screen.getByTestId('add-payments').click();

    await waitFor(() => {
      const last = puts[puts.length - 1];
      expect(last?.id).toBe(SESSION_A);
      expect(last?.boardSeqd).toContain('Payments');
    });
  });

  it('A1.5 — after session A accepted board, New chat B Architecture is empty', async () => {
    /* Accept persists boardSeqd for A. New chat B has no boardSeqd — remount
       is what App does on session switch (reload). B must not show A's nodes. */
    stubSessionsFetch({
      [SESSION_A]: toBoardSeqd(BOARD_A),
      [SESSION_B]: undefined,
    });

    mountBoard(SESSION_A);
    await waitFor(() => expect(cards()).toContain('Orders'));

    cleanup();
    mountBoard(SESSION_B);
    await waitFor(() => expect(cards()).not.toContain('Orders'));
    expect(cards()).toEqual([]);
  });
});
