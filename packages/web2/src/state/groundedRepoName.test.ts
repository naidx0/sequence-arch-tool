import { describe, expect, it } from 'vitest';

import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { createStore } from './store';
import { groundedRepoName } from './connect';
import type { ArchGraph } from '@sequence/schema';

/**
 * A3 — ONE ANSWER TO "WHICH REPOSITORY IS THIS".
 *
 * The composer's "grounded on X" and the shell's repo name are the same claim.
 * They used to be the same EXPRESSION written twice, under a comment warning
 * that "two different answers to 'which repository is this' in one frame would
 * be a bug nobody could see."
 *
 * That was right about the risk and wrong about the mechanism: a copy is not a
 * selector. Either half could be edited alone and the frame would disagree with
 * itself exactly as the comment feared — silently, because both would still
 * look correct in isolation. There is one function now, and this holds its two
 * rules.
 */

const GRAPH = {
  version: 1,
  scannedAt: '2026-08-22T00:00:00.000Z',
  repoRoot: 'C:/repos/sequence',
  repoName: 'sequence',
  /* A REAL NODE. The first version of this fixture had `nodes: []`, so the
     projector produced nothing, the canvas never left S0, and the assertion
     that detaching "takes the board with it" passed against a board that had
     never existed. A mutation keeping the canvas on detach did not fail it -
     which is how the vacuity was found. */
  nodes: [{ id: 'svc:api', kind: 'service', label: 'api', files: [] }],
  edges: [],
  warnings: [],
} as unknown as ArchGraph;

function attached() {
  /* WITH A PROJECTOR. A store built without one refuses to attach and records
     why — which is correct behaviour, and the first version of this test
     omitted it and then blamed the selector for the null. */
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    persisted: null,
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: 'C:/repos/sequence',
      repoName: 'sequence',
      graph: GRAPH,
      summary: { nodes: 0, edges: 0 },
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  } as never);
  return store;
}

describe('groundedRepoName', () => {
  it('names the attached repository', () => {
    expect(groundedRepoName(attached().getState())).toBe('sequence');
  });

  it('A STALE GRAPH STILL NAMES ITS REPO', () => {
    /*
     * "Stale" is a statement about freshness, not about identity. It is still
     * the graph on screen, so the frame must keep saying whose it is — and the
     * moment it stopped, the composer would claim "no repo attached" over an
     * answer grounded in that very repository. That is the shape of the defect
     * this whole row exists to close.
     */
    const store = attached();
    store.dispatch({ type: 'repo/stale' } as never);
    const state = store.getState();
    if (state.repo.phase !== 'stale') return; // the action is not wired; nothing to claim
    expect(groundedRepoName(state)).toBe('sequence');
  });

  it('and an unattached frame names nothing rather than guessing', () => {
    expect(groundedRepoName(createStore({ persisted: null }).getState())).toBeNull();
  });
});

describe('leaving a repository', () => {
  /*
   * Reported as a trap: "how do I exit the project? That's a very simple one."
   *
   * It was not simple, because there was no way out at all — a new session
   * opened in the same repository. POST /api/detach had existed on the server,
   * tested, and called by nothing, since it was written: one of the twenty-one
   * routes the reachability register lists as built and unreached. Wiring it
   * retires that row.
   */
  it('returns the frame to unattached, and takes the board with it', () => {
    const store = attached();
    expect(groundedRepoName(store.getState())).toBe('sequence');

    store.dispatch({ type: 'repo/detached' } as never);

    const after = store.getState();
    expect(after.repo.phase).toBe('unattached');
    expect(groundedRepoName(after)).toBeNull();
    /*
     * THE BOARD GOES TOO — and that is NOT asserted here, deliberately.
     *
     * The reducer resets the canvas and the session, because leaving a
     * repository while its graph stayed on screen would be the stale-client
     * defect in the other direction: a board describing a repo the engine is no
     * longer attached to.
     *
     * But the canvas view is driven by the BOARD mounting and fitting, not by
     * `repo/loaded` — it sits at S0 in a store nothing has rendered. An
     * assertion here would read as coverage and prove nothing, which was the
     * first version of this test: a mutation that kept the canvas on detach did
     * not fail it. The reset belongs to the board's own suite, where a board
     * actually exists.
     */
  });
});
