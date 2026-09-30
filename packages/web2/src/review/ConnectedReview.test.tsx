import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';

import { ConnectedReview } from './ConnectedReview';
import { createReviewClient } from './reviewClient';
import { REVIEW } from './anchors';
import { StoreProvider, createStore, type Store } from '../state';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

/**
 * THE HOST HAS TO CONNECT THE TWO ENDS, AND NOTHING WAS CHECKING THAT IT DID.
 *
 * `ReviewPane.test.tsx` proves the pane fires `onWrote` with the paths that
 * landed. `staleAfterWrite.test.ts` proves the store moves to `stale` when it
 * is told. Neither proves the host WIRES them — and it did not, for long
 * enough that `RepoStale` and the four surfaces branching on it existed as a
 * state no run could reach.
 *
 * Measured while writing this: deleting the `onWrote` prop from
 * `ConnectedReview` broke NO test. Two green suites either side of a missing
 * wire is the shape of defect this package has now paid for four times.
 */

const REPO = '/tmp/connected-review';

const GRAPH = {
  repoName: 'cr',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

const PROPOSAL_FILES = [{ path: 'src/api.ts', content: 'CHANGED\n' }];

function attachedStore(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'cr',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  /* A turn that proposed an edit, so the pane has something to apply. The
     draft is what `turn/send` turns into the user turn — without it there is no
     turn for the assistant reply to close. */
  store.dispatch({ type: 'composer/draft', text: 'change the api' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({
    type: 'turn/event',
    at: 2,
    event: { type: 'edit:proposal', title: 'change it', files: PROPOSAL_FILES } as never,
  });
  store.dispatch({ type: 'turn/event', at: 3, event: { type: 'result', text: 'done' } as never });
  return store;
}

/** A fetch that accepts the write and reports the path back. */
function fetchImpl(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    if (url.startsWith('/api/file')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { path?: string };
      return new Response(JSON.stringify({ ok: true, path: body.path }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('/api/functions')) {
      /* The pane's impact panel reads `functionGraph.edges`; falling through to
         the git-status shape leaves it undefined and the render throws. */
      return new Response(JSON.stringify({ functionGraph: { nodes: [], edges: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('/api/git/diff')) {
      return new Response(JSON.stringify({ path: 'src/api.ts', diff: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ branch: 'main', files: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('ConnectedReview wires the write to the store', () => {
  it('an applied edit moves the repo to stale, naming the file it wrote', async () => {
    const store = attachedStore();
    expect(store.getState().repo.phase).toBe('attached');

    render(
      <StoreProvider store={store}>
        <ConnectedReview client={createReviewClient(fetchImpl())} scope="last-turn" />
      </StoreProvider>,
    );

    const files = await screen.findAllByTestId(REVIEW.file);
    fireEvent.click(within(files[0]!).getByTestId(REVIEW.accept));
    fireEvent.click(screen.getByTestId(REVIEW.apply));

    await waitFor(() => expect(store.getState().repo.phase).toBe('stale'));
    const repo = store.getState().repo;
    if (repo.phase !== 'stale') throw new Error('unreachable');
    /*
     * `PUT /api/file` clears the graph cache WITHOUT re-scanning, so this is the
     * moment the board's every citation may stop matching the file it points
     * at. The cause is named because "graph is stale" with no cause is a shrug.
     */
    expect(repo.reason).toBe('file-written');
    expect(repo.changedPaths).toEqual(['src/api.ts']);
    /* And the graph survives — a stale graph is still a graph, and four
       surfaces keep painting it. */
    expect(repo.repo.graph).toBeTruthy();
    /* B4.2 — Accept + Apply sync into session.proposals, not only local review. */
    const proposals = Object.values(store.getState().session.proposals);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]!.status).toBe('applied');
    expect(proposals[0]!.files[0]!.decision).toBe('accepted');
  });
});

describe('ConnectedReview shows ALL of the last turn\'s edits (Wave 6)', () => {
  it('merges a write→fix turn by path, last write winning', async () => {
    const store = attachedStore();
    /* A second and third applied write in the SAME turn — the shape a Full
       permission write→test→fix turn now produces. The third re-edits the
       first path; disk holds v2, so the pane must show v2 once. */
    store.dispatch({ type: 'composer/draft', text: 'fix it properly' });
    store.dispatch({ type: 'turn/send', at: 10 });
    store.dispatch({
      type: 'turn/event',
      at: 11,
      event: {
        type: 'edit:proposal',
        title: 'first write',
        applied: true,
        files: [{ path: 'src/api.ts', content: 'V1\n' }],
      } as never,
    });
    store.dispatch({
      type: 'turn/event',
      at: 12,
      event: {
        type: 'edit:proposal',
        title: 'add helper',
        applied: true,
        files: [{ path: 'src/helper.ts', content: 'H\n' }],
      } as never,
    });
    store.dispatch({
      type: 'turn/event',
      at: 13,
      event: {
        type: 'edit:proposal',
        title: 'fix the guard',
        applied: true,
        files: [{ path: 'src/api.ts', content: 'V2\n' }],
      } as never,
    });
    store.dispatch({ type: 'turn/event', at: 14, event: { type: 'result', text: 'done' } as never });

    const { container } = render(
      <StoreProvider store={store}>
        <ConnectedReview client={createReviewClient(fetchImpl())} scope="last-turn" />
      </StoreProvider>,
    );

    /* Both PATHS present, api.ts ONCE — the turn's whole footprint, deduped. */
    const files = await screen.findAllByTestId(REVIEW.file);
    const text = files.map((f) => f.textContent ?? '').join(' ');
    expect(files.length).toBe(2);
    expect(text).toContain('api.ts');
    expect(text).toContain('helper.ts');
    /* And the title says there were three, so nobody reads one card as one edit. */
    expect(container.textContent).toContain('3 edits this turn');
  });
});
