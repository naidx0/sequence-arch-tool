/* ══════════════════════════════════════════════════════════════════════════
   A CHAT IS OPENED IN ITS OWN REPOSITORY
   packages/web2/src/v3/railOpensInItsRepo.test.tsx

   Owner, 2026-09-20: "every time you switch on the session rail it should
   switch to that folder ... each chat has a different path. If it doesn't
   match the path then there's no point of showing it in the session rail.
   That's a big problem."

   ── WHY THIS IS A CORRECTNESS TEST AND NOT A UI ONE ───────────────────────

   The rail used to SOFT-BROWSE a foreign thread: read its transcript with a
   `repoPath` query and paint it, leaving the engine attached to whatever it
   was attached to before. The owner saw the visible half — the path under the
   composer did not move.

   The half he could not see is that `/api/ask/stream` carries NO `repoPath`.
   The attached root is the only root a question can be answered against, so a
   soft-browsed thread put one repository's transcript on screen and another
   repository's answer underneath it, with nothing saying so.

   So what is locked here is not "the heading updates". It is that the rail
   cannot put a reader in a thread the engine will not answer as.

   ── THE THREE PROPERTIES ──────────────────────────────────────────────────

   1. A catalogue row OPENS ITS REPO, and does not soft-read it behind the
      engine's back.
   2. A chat CREATED in a foreign section is opened in that section's root too
      — creating one and landing softly is the same defect as clicking one.
   3. The home section NAMES the attached repository, in that repository's own
      name and with its absolute root on hover. Something on screen has to
      claim which root these chats belong to.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

const GRAPH = {
  repoName: 'sequence',
  scannedAt: '2026-09-20T09:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

const REPO = '/home/max/ml-harness';
const HOME_THREAD = 'session-home';
const REPO_THREAD = 'session-repo';
const MINTED = 'session-minted';

function sessionsIndex(activeId: string, ids: string[]) {
  return {
    version: 1,
    activeId,
    sessions: ids.map((id) => ({
      id,
      title: id,
      createdAt: '2026-09-20T09:00:00.000Z',
      updatedAt: '2026-09-20T09:00:00.000Z',
    })),
  };
}

interface Wire {
  posts: { body: Record<string, unknown> }[];
  reads: string[];
}

function wiredClient(wire: Wire) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/sessions' && method === 'GET') {
      return new Response(
        JSON.stringify({
          index: sessionsIndex(HOME_THREAD, [HOME_THREAD]),
          scope: 'workspace',
          repos: [
            { path: REPO, name: 'ml-harness', index: sessionsIndex(REPO_THREAD, [REPO_THREAD]) },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === '/api/sessions' && method === 'POST') {
      wire.posts.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          index: sessionsIndex(MINTED, [REPO_THREAD, MINTED]),
          session: { id: MINTED, chat: { version: 1, sessionId: MINTED, turns: [] }, meta: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.startsWith('/api/sessions/') && method === 'GET') {
      wire.reads.push(url);
      return new Response(
        JSON.stringify({ chat: { version: 1, sessionId: MINTED, turns: [] }, meta: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

/** The host that CAN attach — every shipping one. `V3App` passes this prop. */
function mountWithAttach(wire: Wire): { store: Store; opened: ReturnType<typeof vi.fn> } {
  const store = createStore({});
  const opened = vi.fn();
  render(
    <StoreProvider store={store}>
      <V3SessionsRail client={wiredClient(wire)} onOpenProject={opened} />
    </StoreProvider>,
  );
  return { store, opened };
}

describe('the rail opens a chat in the chat s own repository', () => {
  it('a catalogue row opens that repo rather than soft-reading it', async () => {
    const wire: Wire = { posts: [], reads: [] };
    const { store, opened } = mountWithAttach(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    fireEvent.click(screen.getByText(REPO_THREAD));

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(opened).toHaveBeenCalledWith(REPO, REPO_THREAD);

    /*
     * AND IT DID NOT ALSO BROWSE. This is the assertion that would have caught
     * the original defect: a click that attaches AND soft-marks the reader as
     * browsing a foreign root leaves two answers to "which repo is this" in
     * the store at once, which is the state the whole change exists to end.
     */
    expect(store.getState().session.browseRepoPath).toBeNull();
    expect(wire.reads.some((u) => u.includes(encodeURIComponent(REPO)))).toBe(false);
  });

  it('a chat created in a foreign section is opened in that section s root', async () => {
    const wire: Wire = { posts: [], reads: [] };
    const { opened } = mountWithAttach(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'New chat in ml-harness' }));

    /* The POST still names the root — that part was always right. */
    await waitFor(() => expect(wire.posts).toHaveLength(1));
    expect(wire.posts[0]!.body.repoPath).toBe(REPO);

    /* What is new is that the reader is then PUT IN that root. */
    await waitFor(() => expect(opened).toHaveBeenCalledWith(REPO, MINTED));
  });

  it('the home section says "Workspace" only when nothing is attached', async () => {
    const wire: Wire = { posts: [], reads: [] };
    mountWithAttach(wire);
    await waitFor(() => expect(screen.getByText('ml-harness')).toBeTruthy());

    /*
     * `createStore({})` has no repo attached, so this is the case the bare
     * word is TRUE of. The attached case is covered by the store test below,
     * because attaching here would mean standing up a whole boot ladder to
     * assert one string.
     */
    expect(screen.getByTestId('v3-rail-section-home').textContent).toContain('Workspace');
    expect(screen.getByTestId('v3-rail-section-home').getAttribute('title')).toContain(
      'no repository attached',
    );
  });

  it('names the attached repository when there is one', async () => {
    const wire: Wire = { posts: [], reads: [] };
    /*
     * ATTACHED THE WAY THE BOOT LADDER ATTACHES. `groundedRepoName` reads
     * `state.repo.repo.repoName` in the `attached` and `stale` phases and
     * nowhere else, so a fixture that dispatched anything less than a real
     * `repo/loaded` would be asserting against a state the app cannot reach.
     */
    const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: '/home/max/sequence',
        repoName: 'sequence',
        graph: GRAPH,
        summary: summarizeGraph(GRAPH),
        scannedAt: '2026-09-20T09:00:00.000Z',
      },
      at: 1,
    });

    render(
      <StoreProvider store={store}>
        <V3SessionsRail client={wiredClient(wire)} onOpenProject={vi.fn()} />
      </StoreProvider>,
    );

    /*
     * THE HOME SECTION, AGAIN. For a few hours this read a scope control
     * instead, while the rail had a `this project | All` toggle. The toggle is
     * gone — owner, same day: "side rail should be simple, always show one
     * wide scope of rails" — so the claim is back where it started, on the
     * heading of the section these chats are under.
     */
    await waitFor(() =>
      expect(screen.getByTestId('v3-rail-section-home').textContent).toContain('sequence'),
    );
    expect(screen.getByTestId('v3-rail-section-home').textContent).not.toContain('Workspace');

    /* The ABSOLUTE root on hover: two folders named `sequence` is not an
       unusual thing to have. */
    expect(screen.getByTestId('v3-rail-section-home').getAttribute('title')).toBe(
      '/home/max/sequence',
    );
  });
});
