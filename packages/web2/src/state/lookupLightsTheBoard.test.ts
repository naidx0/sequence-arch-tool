import { describe, expect, it } from 'vitest';

import { lookupDim, teachDim } from '../canvas/flowFocus';
import { createStore } from './store';
import type { NodeId } from './types';

/**
 * A SYMBOL LOOKUP LIGHTS THE PART THAT HOLDS IT — and never calls it a lesson.
 *
 * Max's second sentence is that an engineer hands Sequence a repository and
 * SEES it. Measured on `teach/symbol-index`, asking where `buildDigest` is
 * declared answered 4 of 4 in the chat rail — and the map did not move. The
 * only server-fed way to light the board was `teach:step`, and the teach lane
 * refused to use it for a lookup, correctly: that event's caption ASSERTS A
 * LESSON, so emitting it for a lookup would stamp the turn as a lesson step it
 * is not. That is the same fault as a verb claiming an outcome the engine never
 * supplied, which this lane fixed one commit earlier in `'Ran in Teach mode'`.
 *
 * So the join is a fourth dim reason and an event carrying IDS AND NOTHING
 * ELSE: no caption, no lesson state, no chart. A lookup has nothing to say on
 * the canvas, only somewhere to point.
 *
 * ── THE IDS ARE THE TEACH LANE'S MEASURED ONES ────────────────────────────
 *
 * Stubbed to the four its `resolveGraphTargets` actually resolved on this
 * repository, rather than to convenient invented ones — the point of a stub is
 * to stand in for a proven answer, not to invent an easier one.
 */
const RESOLVED: Record<string, NodeId> = {
  buildDigest: 'file:packages/analyzer/src/server/explain.ts',
  MAX_ASK_TOOL_ROUNDS: 'file:packages/analyzer/src/server/askTools.ts',
  subjectlessRefusal: 'file:packages/analyzer/src/server/lessonState.ts',
  validateChart: 'file:packages/schema/src/chart.ts',
};

const DRAWN: ReadonlySet<NodeId> = new Set(Object.values(RESOLVED));


/*
 * ── THE EVENT, WHICH COULD NOT LAND FROM ONE SIDE ─────────────────────────
 *
 * This file used to end here, saying the wire event was deliberately NOT in
 * its commit: `reachability.test.mjs` enforces "STREAM ATTACK — every declared
 * event is produced and consumed", so a contract member with a web2 consumer
 * and no analyzer producer fails, and so would a producer with no consumer.
 * Whichever lane committed first would be red by construction — the right rule,
 * because a declared event only one end speaks is built-but-not-reached wearing
 * a contract.
 *
 * It has now landed, in one commit across both packages: the event declared in
 * `@sequence/api-types` and the pipeline's own union, emitted from
 * `locate_symbol` after `resolveGraphTargets` turns its hits into real node
 * ids, held on `session.lookupLocated`, and consumed by the board through
 * `lookupDim`. The vocabulary was added to `reachability-baseline.json` by
 * name, which is that gate asking for a deliberate contract change to be
 * declared rather than inferred.
 *
 * The cases below still test `lookupDim` alone. The reducer's half is tested
 * underneath them, because where the ids are STORED turned out to carry a
 * decision worth locking on its own.
 */

describe('the board lights what a lookup found', () => {
  it('THE STUB IS THE MEASURED SET: four symbols, four real node ids', () => {
    /* Vacuity guard. Every case below is about resolved ids, so a stub that
       quietly emptied would leave them all passing against nothing. */
    expect(Object.keys(RESOLVED)).toHaveLength(4);
    expect(Object.values(RESOLVED).every((id) => id.startsWith('file:'))).toBe(true);
  });



  it('the containing part lights, for each of the four', () => {
    for (const [symbol, id] of Object.entries(RESOLVED)) {
      const dim = lookupDim([id], DRAWN);
      expect(dim, `${symbol} lit nothing`).not.toBeNull();
      expect(dim!.litNodeIds, `${symbol} lit the wrong part`).toEqual([id]);
    }
  });

  it('THE REASON READS `lookup` AND NEVER `teach`', () => {
    /*
     * The whole point of the fourth reason. `teach` means a lesson step is on
     * screen; if a lookup produced that reason the board would be telling the
     * reader a lesson happened, which is exactly what the teach lane declined
     * to do on the server side.
     */
    const dim = lookupDim([RESOLVED.buildDigest!], DRAWN);
    expect(dim!.reason).toBe('lookup');
    /* And the two are genuinely distinct, not the same object with a label:
       the teach path over the same id still says teach. */
    expect(teachDim([RESOLVED.buildDigest!], DRAWN)!.reason).toBe('teach');
  });

  it('NOTHING IS DRAWN — no edge is lit', () => {
    /* A lookup answers WHERE a symbol is declared, a fact about one node.
       Lighting a route between two would claim a call it never traced. */
    expect(lookupDim(Object.values(RESOLVED), DRAWN)!.litEdgeIds).toEqual([]);
  });

  it('an id the board does not draw lights NOTHING, rather than claiming an invisible node', () => {
    /*
     * The restraint the teach step already keeps: "a spotlight on nothing is a
     * lie about where to look." The board draws services at the systems level;
     * a file-level id resolved by the lookup is often not on it, and that must
     * be silence rather than a dim of everything.
     */
    expect(lookupDim([RESOLVED.buildDigest!], new Set(['svc:analyzer']))).toBeNull();
    expect(lookupDim([], DRAWN)).toBeNull();
    expect(lookupDim(undefined, DRAWN)).toBeNull();
  });

  it('a partial hit lights only what is on screen', () => {
    /* Two ids, one drawn: the drawn one lights and the other is not invented
       onto the board. */
    const onlyOne = new Set([RESOLVED.validateChart!]);
    const dim = lookupDim([RESOLVED.buildDigest!, RESOLVED.validateChart!], onlyOne);
    expect(dim!.litNodeIds).toEqual([RESOLVED.validateChart]);
  });
});

describe('lookup:located stream', () => {
  /*
   * The consumer half. Without a case here the STREAM ATTACK in
   * tools/ci/reachability.test.mjs reports the event as declared and
   * unconsumed — the check that exists to catch a whole feature being
   * unreachable, which is what happened to `canvas/proposal`.
   */
  function looking() {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'where is buildDigest declared?' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' },
      at: 2,
    });
    return store;
  }

  it('holds the ids on the SESSION, not on the persisted canvas doc', () => {
    /*
     * THE ONE DECISION IN THE REDUCER THAT IS NOT MECHANICAL, so it is the one
     * that gets locked. `canvasDoc` is what the session AUTHORED and keeps —
     * blocks, charts, a story route, a lesson step. A lookup result is not a
     * document: it is a pointer that was true for one question. Persisted, it
     * would relight a stale answer the next time the session opened, with
     * nothing on screen to say why that part of the board is lit.
     */
    const store = looking();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'lookup:located', nodeIds: [RESOLVED.buildDigest!] },
      at: 3,
    });
    const session = store.getState().session;
    expect(session.lookupLocated).toEqual([RESOLVED.buildDigest]);
    /* And it did NOT leak into the document alongside the lesson step. */
    expect(session.canvasDoc).not.toHaveProperty('lookupLocated');
    expect(session.canvasDoc.teachStep).toBeUndefined();
  });

  it('a second lookup REPLACES the first, it does not accumulate', () => {
    /* The previous lookup is not history the board keeps — the same rule
       `teachStep` follows, for the same reason. */
    const store = looking();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'lookup:located', nodeIds: [RESOLVED.buildDigest!] },
      at: 3,
    });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'lookup:located', nodeIds: [RESOLVED.validateChart!] },
      at: 4,
    });
    expect(store.getState().session.lookupLocated).toEqual([RESOLVED.validateChart]);
  });

  it('adds NO work row — the tool call already drew its own', () => {
    /* "A row that repeats its own name" is the owner's standing dislike, and
       the reason `teach:step` adds none either. */
    const store = looking();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'lookup:located', nodeIds: [RESOLVED.buildDigest!] },
      at: 3,
    });
    const rows = store.getState().session.inFlight!.work;
    expect(rows.filter((r) => r.from === 'lookup:located')).toEqual([]);
  });
});
