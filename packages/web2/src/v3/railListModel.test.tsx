/* ══════════════════════════════════════════════════════════════════════════
   ONE RAIL, EVERY PROJECT, AND WHAT YOU CAN DO TO EACH
   packages/web2/src/v3/railListModel.test.tsx

   Owner, 2026-09-21:

     "side rail should be simple, always show one wide scope of rails. in these
      rails you have projects, either started from scratch (project folder
      workspace made at runtime there) or started in a project folder in path
      from somewhere else like ML-Max or Sequence ... each project has chats
      under it that refer to it in specific ... from there you can fork chats,
      move chats, delete chats, etc. project folders you can also drag and move
      delete minimize expand, and start a new chat from."

   ── THE SCOPE PAIR WAS A MISREADING, AND THIS FILE RECORDS IT ─────────────

   An earlier version of this test locked a `this project | All` toggle, taken
   from Codex's `SessionFilterMode::Cwd`. It came from him saying he was "not a
   fan of that format" about the grouped rail — but the rail he was looking at
   had a stylesheet fault that stopped any section opening, so what he was not
   a fan of was a list that would not expand, not the grouping.

   Codex scopes to one working directory because a terminal session has one.
   This window has a rail, and the rail is where every project lives at once.
   So: no filter mode. One list, all projects, search to narrow it, and the
   operations on the object they belong to — project-level on the project,
   chat-level on the chat.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

const REPO = '/home/max/sequence';
const OTHER = '/home/max/ml-harness';

const GRAPH = {
  repoName: 'sequence',
  scannedAt: '2026-09-21T09:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function sessionsIndex(activeId: string, rows: { id: string; title: string }[]) {
  return {
    version: 1,
    activeId,
    sessions: rows.map((r) => ({
      ...r,
      createdAt: '2026-09-21T09:00:00.000Z',
      updatedAt: '2026-09-21T09:00:00.000Z',
    })),
  };
}

const HOME = sessionsIndex('s-1', [
  { id: 's-1', title: 'why is the gateway hot' },
  { id: 's-2', title: 'session 8573' },
  { id: 's-3', title: 'what calls runAskPipeline' },
]);

interface Wire {
  moves: { id: string; from: string; to: string }[];
}

const WORKSPACE = '/home/max';

function client(wire: Wire) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/sessions' && method === 'GET') {
      return new Response(
        JSON.stringify({
          index: HOME,
          scope: 'workspace',
          repos: [
            /* The home workspace as the server synthesises it — a project you
               started from scratch rather than one opened from a path. */
            {
              path: WORKSPACE,
              name: 'Workspace',
              home: true,
              index: sessionsIndex('w-1', [{ id: 'w-1', title: 'a workspace chat' }]),
            },
            { path: REPO, name: 'sequence', index: HOME },
            {
              path: OTHER,
              name: 'ml-harness',
              index: sessionsIndex('m-1', [{ id: 'm-1', title: 'tune the harness' }]),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url === '/api/sessions/move' && method === 'POST') {
      wire.moves.push(JSON.parse(String(init?.body ?? '{}')) as Wire['moves'][number]);
      return new Response(JSON.stringify({ from: null, to: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

/** The repository attached the way the boot ladder attaches one. */
function attach(store: Store): void {
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'sequence',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-09-21T09:00:00.000Z',
    },
    at: 1,
  });
}

function mount(): Wire & {
  openProject: ReturnType<typeof vi.fn>;
  openWorkspace: ReturnType<typeof vi.fn>;
} {
  const wire: Wire = { moves: [] };
  const openProject = vi.fn();
  const openWorkspace = vi.fn();
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
  attach(store);
  render(
    <StoreProvider store={store}>
      <V3SessionsRail
        client={client(wire)}
        onOpenProject={openProject}
        onOpenWorkspace={openWorkspace}
      />
    </StoreProvider>,
  );
  return { ...wire, openProject, openWorkspace };
}

function sectionNamed(name: string): HTMLElement {
  const label = screen
    .getAllByRole('button')
    .find((b) => b.className.includes('v3-rail-section-label') && b.textContent?.includes(name));
  if (!label) throw new Error(`no section named ${name}`);
  return label.closest('.v3-rail-section') as HTMLElement;
}

describe('the rail is one list of projects', () => {
  it('shows every project at once, with no scope to choose', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    /*
     * NO TOGGLE. "always show one wide scope of rails" — every project is on
     * screen, including the home workspace, which is a project you started
     * from scratch rather than opened from a path.
     */
    expect(screen.queryByTestId('v3-rail-scope-project')).toBeNull();
    expect(screen.queryByTestId('v3-rail-scope-all')).toBeNull();
    expect(screen.queryByTestId('v3-rail-flat')).toBeNull();
    expect(document.querySelectorAll('.v3-rail-section').length).toBeGreaterThan(1);
  });

  it('expands and collapses a project without touching the others', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    const mlh = sectionNamed('ml-harness');
    const other = sectionNamed('sequence');
    const label = mlh.querySelector('.v3-rail-section-label') as HTMLElement;

    expect(mlh.className).not.toContain('is-collapsed');
    fireEvent.click(label);

    /*
     * "minimize expand" — and only the one pressed. The class is what the
     * stylesheet keys the hide on, and the hide itself is asserted in
     * `railChromeGeometry.test.ts`, which reads the sheet because jsdom does
     * no layout and cannot tell a hidden box from a visible one.
     */
    expect(mlh.className).toContain('is-collapsed');
    expect(other.className).not.toContain('is-collapsed');
    expect(label.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(label);
    expect(mlh.className).not.toContain('is-collapsed');
  });

  it('starts a chat in the project you are looking at', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    /* "start a new chat from" — per project, not only the rail head's button,
       which has only ever meant the attached root. */
    expect(
      screen.getByRole('button', { name: 'New chat in ml-harness' }),
    ).toBeTruthy();
  });

  it('narrows to what the reader types, across every project', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    fireEvent.change(screen.getByTestId('v3-rail-search'), { target: { value: 'harness' } });

    expect(screen.getByText(/tune the harness/)).toBeTruthy();
    expect(screen.queryByText(/why is the gateway hot/)).toBeNull();
  });

  it('never titles a row with an identifier', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    /*
     * `session 8573` is in the fixture because it is on his disk — the server
     * stopped minting them and the written ones remain. It is a fact about our
     * filing system and answers nothing a reader is asking; the timestamp
     * beside the row tells two new chats apart.
     */
    expect(screen.queryByText(/session 8573/)).toBeNull();
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0);
  });
});

describe('the home workspace is opened by detaching, not by attaching', () => {
  /*
   * ── EVERY WORKSPACE ROW WAS DEAD ─────────────────────────────────────────
   *
   * When the Workspace section joined the catalogue its rows went through
   * `onOpenProject` like every other section's, and that ATTACHES the row's
   * path. The workspace's path is the reader's home directory, which the
   * browse jail refuses by name:
   *
   *   POST /api/attach -> 400
   *   "Pick a project folder inside your home directory, not the home
   *    directory itself."
   *
   * So clicking one logged a 400 and did nothing at all. It was found by a
   * layout probe's POSITIVE CONTROL — the check that the chat had actually
   * changed before comparing layouts — not by anything that was looking for
   * it. Without that control the run printed "identical" and read as a pass.
   */
  it('a workspace row asks for the workspace, not for an attach', async () => {
    const m = mount();
    await waitFor(() => expect(screen.getByText('a workspace chat')).toBeTruthy());

    fireEvent.click(screen.getByText('a workspace chat'));

    expect(m.openWorkspace).toHaveBeenCalledWith('w-1');
    expect(
      m.openProject,
      'attaching the home directory is the call the server refuses',
    ).not.toHaveBeenCalled();
  });

  it('a repository row still asks for an attach', async () => {
    const m = mount();
    await waitFor(() => expect(screen.getByText('tune the harness')).toBeTruthy());

    fireEvent.click(screen.getByText('tune the harness'));

    /* The fork has to keep the ordinary case ordinary: a real project is still
       opened by attaching it, which is what puts the engine in that root. */
    expect(m.openProject).toHaveBeenCalledWith(OTHER, 'm-1');
    expect(m.openWorkspace).not.toHaveBeenCalled();
  });
});

describe('a chat can be moved to another project', () => {
  it('offers every project except the one holding it', async () => {
    mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    const row = screen.getByText(/why is the gateway hot/).closest('.v3-session') as HTMLElement;
    fireEvent.click(row.querySelector('.v3-session-menu button') as HTMLElement);

    /*
     * The chat lives in `sequence`, so `sequence` is not a destination. A row
     * that offered it would be a control the server correctly refuses, pressed
     * after the reader had every reason to think it would work.
     */
    expect(screen.getByTestId('v3-session-move-ml-harness')).toBeTruthy();
    expect(screen.queryByTestId('v3-session-move-sequence')).toBeNull();
  });

  it('sends the chat and both projects, and waits for the answer', async () => {
    const wire = mount();
    await waitFor(() => expect(sectionNamed('ml-harness')).toBeTruthy());

    const row = screen.getByText(/why is the gateway hot/).closest('.v3-session') as HTMLElement;
    fireEvent.click(row.querySelector('.v3-session-menu button') as HTMLElement);
    fireEvent.click(screen.getByTestId('v3-session-move-ml-harness'));

    await waitFor(() => expect(wire.moves).toHaveLength(1));
    expect(wire.moves[0]).toEqual({ id: 's-1', from: REPO, to: OTHER });
  });
});
