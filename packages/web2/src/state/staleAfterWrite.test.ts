import { describe, expect, it } from 'vitest';

import { createStore } from './store';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { summarizeGraph } from '../boot';
import { readShellPersisted, readShellTokens } from '../shell';
import type { GetArchGraphResponse } from '@sequence/api-types';

/**
 * A STATE NO RUN COULD ENTER.
 *
 * `RepoStale` has existed with a `reason`, a `since` and a `changedPaths`, and
 * four surfaces read it — the board, the rail, the shell and the app all branch
 * on `phase === 'stale'`. Nothing could ever produce it. The register's row:
 * "edit a file behind the app's back and the board still claims to be current;
 * renderers exist, nothing can put the app in the state".
 *
 * The producer was already half-built and unwired. `ReviewPane` writes files
 * and fires `onWrote(landed)`, and that prop's own doc says why it exists —
 * "so the host can mark the graph stale — PUT /api/file clears the cache
 * without re-scanning". Nothing consumed it.
 *
 * THE POINT IS NOT A LABEL. A graph the app knows is out of date and paints as
 * current is the failure this product exists to prevent: every claim made from
 * it is grounded in a file that no longer says what the citation says.
 */

const REPO = '/tmp/stale';

const GRAPH = {
  repoName: 'stale',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function attached() {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: 'stale',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  return store;
}

describe('the graph goes stale when a write lands', () => {
  it('starts attached, not stale', () => {
    expect(attached().getState().repo.phase).toBe('attached');
  });

  it('a landed write moves the repo to stale, naming the cause and the paths', () => {
    const store = attached();
    store.dispatch({
      type: 'repo/stale',
      reason: 'file-written',
      changedPaths: ['src/api.ts'],
      at: 1_700_000_000_000,
    });

    const repo = store.getState().repo;
    expect(repo.phase).toBe('stale');
    if (repo.phase !== 'stale') throw new Error('unreachable');
    /* "graph is stale" with no cause is a shrug — the type's own words. */
    expect(repo.reason).toBe('file-written');
    expect(repo.changedPaths).toEqual(['src/api.ts']);
    expect(repo.since).toBe(1_700_000_000_000);
  });

  it('the scanned repo SURVIVES going stale — a stale graph is still a graph', () => {
    const store = attached();
    const before = store.getState();
    if (before.repo.phase !== 'attached') throw new Error('unreachable');
    const repoBefore = before.repo.repo;

    store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: ['x'], at: 1 });
    const after = store.getState().repo;
    if (after.phase !== 'stale') throw new Error('unreachable');
    /*
     * Identity, deliberately. Four surfaces branch on `attached || stale` and
     * keep painting; dropping the graph here would blank the board on every
     * accepted edit, which is a worse answer than a stale one.
     */
    expect(after.repo).toBe(repoBefore);
  });

  it('going stale twice keeps the newest cause', () => {
    const store = attached();
    store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: ['a'], at: 1 });
    store.dispatch({ type: 'repo/stale', reason: 'proposal-applied', changedPaths: ['b'], at: 2 });
    const repo = store.getState().repo;
    if (repo.phase !== 'stale') throw new Error('unreachable');
    expect(repo.reason).toBe('proposal-applied');
    expect(repo.changedPaths).toEqual(['b']);
  });

  it('a rescan clears it — that is what makes it a phase and not a badge', () => {
    const store = attached();
    store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: ['a'], at: 1 });
    expect(store.getState().repo.phase).toBe('stale');

    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: REPO,
        repoName: 'stale',
        graph: GRAPH,
        summary: summarizeGraph(GRAPH),
        scannedAt: '2026-08-22T01:00:00.000Z',
      },
      at: 2,
    });
    expect(store.getState().repo.phase).toBe('attached');
  });

  it('nothing goes stale when nothing is attached', () => {
    const store = createStore({
      project: (g) => seqdFromGraph(g, g.nodeDetail),
      tokens: readShellTokens(document.documentElement),
      persisted: readShellPersisted(),
    });
    const before = store.getState().repo;
    store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: ['a'], at: 1 });
    /*
     * `RepoStale` carries a `ScannedRepo`, so there is no honest stale state
     * without one. Inventing an empty repo to hang the phase on would be the
     * store describing a scan that never happened.
     */
    expect(store.getState().repo).toBe(before);
  });
});
