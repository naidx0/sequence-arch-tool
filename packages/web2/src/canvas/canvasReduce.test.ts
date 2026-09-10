import { describe, expect, it } from 'vitest';

import { EMPTY_CANVAS } from '../state/initial';
import type { CanvasSlice, FlowHop, FlowPlayback } from '../state/types';
import { ZOOM_MAX, ZOOM_MIN } from './camera';
import { type CanvasAction, canvasReduce, detailBudget } from './canvasReduce';
import { rungFor } from './lod';

const framed: CanvasSlice = canvasReduce(EMPTY_CANVAS, {
  type: 'canvas/frame',
  width: 800,
  height: 600,
});

const HOPS: FlowHop[] = [
  { from: 'svc:a', to: 'svc:b', via: null, label: null, evidence: null },
  { from: 'svc:b', to: 'svc:a', via: null, label: null, evidence: null },
];
const PLAYBACK: FlowPlayback = { functionId: 'fn:x', hops: HOPS, cursor: 0, playing: true };

/**
 * The flow family — item playback. Held apart from the list below because ONE
 * existing test iterates that list to assert the board never dims, and dimming
 * is exactly what this family is allowed to do (sheet 06.6: playback and
 * explicit path-focus, and nothing else). Folding these in would have made that
 * test pass for the wrong reason — the last member here clears the flow, so the
 * final `dim` is null again and the assertion would have held while saying
 * nothing.
 */
const FLOW_ACTIONS: CanvasAction[] = [
  { type: 'canvas/flow', playback: PLAYBACK },
  { type: 'canvas/flow-cursor', cursor: 1, playing: false },
  {
    type: 'canvas/flow-focus',
    dim: { reason: 'playback', litNodeIds: ['svc:a', 'svc:b'], litEdgeIds: [] },
    focus: 'svc:b',
  },
  { type: 'canvas/flow-clear' },
];

/** The camera and the selection — everything a reader's hand does directly. */
const HANDLED_DIRECTLY: CanvasAction[] = [
  { type: 'canvas/frame', width: 614, height: 700 },
  { type: 'canvas/pan', dx: 40, dy: -20 },
  { type: 'canvas/viewport', viewport: { x: 5, y: 6, zoom: 0.9 } },
  { type: 'canvas/zoom-at', zoom: 3.2, at: { x: 100, y: 100 } },
  { type: 'canvas/zoom-step', direction: 1 },
  { type: 'canvas/zoom-step', direction: -1 },
  { type: 'canvas/zoom-reset' },
  { type: 'canvas/fit', bounds: { x: 0, y: 0, width: 4000, height: 3000 } },
  { type: 'canvas/fit', bounds: null },
  { type: 'canvas/select', nodeId: 'svc:a', additive: false },
  { type: 'canvas/select', nodeId: 'svc:b', additive: true },
  { type: 'canvas/clear' },
  { type: 'canvas/position', nodeId: 'svc:a', x: 12, y: 34 },
  { type: 'canvas/layout', layout: 'laying-out' },
];

/** Every action the board can produce, so the invariants below are asserted
 *  after EVERY transition rather than after the three a test remembered. */
const EVERY_ACTION: CanvasAction[] = [...HANDLED_DIRECTLY, ...FLOW_ACTIONS];

/**
 * ITEM 3.4 — THE ONE FUNNEL.
 *
 * The store's own file states the pattern this mirrors: a field recomputed
 * unconditionally at the single exit is a PROJECTION, not a second source of
 * truth. `composer.send` is derived that way and this reducer derives `rung`
 * the same way — asserted against `rungFor` rather than against a literal,
 * after every action, so the store and the renderer cannot disagree about which
 * rung is live.
 */
describe('item 3.4 — the canvas reducer', () => {
  it('holds the invariants after every single transition', () => {
    const broken: string[] = [];
    let state = framed;

    for (const action of EVERY_ACTION) {
      state = canvasReduce(state, action);

      if (state.viewport.zoom < ZOOM_MIN || state.viewport.zoom > ZOOM_MAX) {
        broken.push(`${action.type}: zoom escaped the range at ${state.viewport.zoom}`);
      }
      if (state.rung !== rungFor(state.viewport.zoom)) {
        broken.push(
          `${action.type}: rung is ${state.rung}, derivation says ${rungFor(state.viewport.zoom)}`,
        );
      }
      if (!Number.isFinite(state.viewport.x) || !Number.isFinite(state.viewport.y)) {
        broken.push(`${action.type}: the translate is not finite`);
      }
      if (state.frame.budget !== detailBudget(state.frame.width, state.frame.height)) {
        broken.push(`${action.type}: the budget is not the frame's`);
      }
    }

    expect(broken).toEqual([]);
  });

  it('derives the rung rather than storing one anybody can set', () => {
    // A hydrated slice that lies about its own rung is corrected on the way
    // out, not trusted — the same guarantee store.ts gives `composer.send`.
    const lying: CanvasSlice = { ...framed, viewport: { x: 0, y: 0, zoom: 0.4 }, rung: 1 };
    const corrected = canvasReduce(lying, { type: 'canvas/layout', layout: 'idle' }).rung;

    // Against `rungFor`, which is what this file's header says it does — the
    // one line here that used to hold a literal held `6`, the rung the old
    // invented ladder put 0.4 on, and it therefore pinned that invention from
    // a second file. Which rung 0.4 IS belongs to sheet 05.8 and is asserted
    // by literal in `lod.test.ts`, where the sheet is cited.
    expect(corrected).toBe(rungFor(0.4));
    expect(corrected).not.toBe(lying.rung);
  });

  it('clamps a viewport an action tried to smuggle out of range', () => {
    const out = canvasReduce(framed, { type: 'canvas/viewport', viewport: { x: 0, y: 0, zoom: 12 } });
    expect(out.viewport.zoom).toBe(ZOOM_MAX);
  });

  it('leaves the camera where it was when a fit cannot be computed', () => {
    // Not "somewhere arithmetically defensible and visually wrong".
    const before = canvasReduce(framed, { type: 'canvas/pan', dx: 30, dy: 30 });
    expect(canvasReduce(before, { type: 'canvas/fit', bounds: null }).viewport).toEqual(
      before.viewport,
    );
  });

  it('adds to a selection and never swaps it', () => {
    // Sheet 06.2. And a repeat additive click REMOVES, because that is the only
    // way a reader can correct a shift-click without starting again.
    let state = canvasReduce(framed, { type: 'canvas/select', nodeId: 'a', additive: false });
    expect(state.selection.nodeIds).toEqual(['a']);

    state = canvasReduce(state, { type: 'canvas/select', nodeId: 'b', additive: true });
    expect(state.selection.nodeIds).toEqual(['a', 'b']);
    expect(state.selection.anchor).toBe('b');

    state = canvasReduce(state, { type: 'canvas/select', nodeId: 'a', additive: true });
    expect(state.selection.nodeIds).toEqual(['b']);

    state = canvasReduce(state, { type: 'canvas/select', nodeId: 'c', additive: false });
    expect(state.selection.nodeIds).toEqual(['c']);
  });

  it('never dims on a click', () => {
    // SHEET 06.6, AND IT IS THE RULE RATHER THAN AN OMISSION: "Clicking a node
    // selects it; it does not dim the board." Dimming is expensive — it touches
    // every object the reader did not ask about — and the moment it is spent on
    // an ordinary click it stops meaning anything.
    // ITEM playback: the flow family is DELIBERATELY not in this loop. It is
    // the one thing sheet 06.6 permits to dim, and running it here would either
    // fail this test for the right behaviour or — because its last member
    // clears the flow — pass it for no reason at all.
    let state = framed;
    for (const action of HANDLED_DIRECTLY) state = canvasReduce(state, action);
    expect(state.dim).toBeNull();
  });

  /* ══ Decision 6 — explicit selection dims off-path ═══════════════════════
     docs/OWNER-PLAN-2026-08-24c.md §1: "selecting a node recedes everything
     not on its path … Escape/click-empty clears." The reducer never derives a
     dim from the selection itself — that needs the document — but it owns the
     WRITE (canvas/dim) and the CLEAR (Escape), so those two are locked here. */
  it('writes a resolved selection dim through canvas/dim', () => {
    const dim = { reason: 'selection' as const, litNodeIds: ['svc:a'], litEdgeIds: [] };
    const dimmed = canvasReduce(framed, { type: 'canvas/dim', dim });
    expect(dimmed.dim).toEqual(dim);
  });

  it('is idempotent when the same dim is dispatched again', () => {
    // The host recomputes on every render of a selection; without the identity
    // check that effect feeds itself — the same load-bearing return the
    // flow-focus case documents.
    const dim = { reason: 'selection' as const, litNodeIds: ['svc:a'], litEdgeIds: [] };
    const once = canvasReduce(framed, { type: 'canvas/dim', dim });
    expect(canvasReduce(once, { type: 'canvas/dim', dim })).toBe(once);
  });

  it('Escape clears a SELECTION dim along with the selection', () => {
    // Decision 6's own sentence: Escape clears. A dim whose reason was a
    // selection cannot outlive the selection it answered.
    const dimmed = canvasReduce(framed, {
      type: 'canvas/dim',
      dim: { reason: 'selection', litNodeIds: ['svc:a'], litEdgeIds: [] },
    });
    const cleared = canvasReduce(dimmed, { type: 'canvas/select', nodeId: 'svc:a', additive: false });
    const escaped = canvasReduce(cleared, { type: 'canvas/clear' });
    expect(escaped.selection.nodeIds).toEqual([]);
    expect(escaped.dim).toBeNull();
  });

  it('Escape leaves a PLAYBACK dim alone — clearing the flow is flow-clear’s job', () => {
    const flowed = canvasReduce(framed, { type: 'canvas/flow', playback: PLAYBACK });
    const focused = canvasReduce(flowed, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: [] },
      focus: 'svc:b',
    });
    // In S3 the reader's Escape is canvas/clear; the playback dim belongs to
    // the flow and only flow-clear drops it.
    const cleared = canvasReduce(focused, { type: 'canvas/clear' });
    expect(cleared.dim).not.toBeNull();
  });

  it('clears the selection on Escape and leaves the camera alone', () => {
    // Losing your place is not the same as losing your selection.
    const moved = canvasReduce(framed, { type: 'canvas/pan', dx: 100, dy: 100 });
    const selected = canvasReduce(moved, { type: 'canvas/select', nodeId: 'a', additive: false });
    const cleared = canvasReduce(selected, { type: 'canvas/clear' });

    expect(cleared.selection.nodeIds).toEqual([]);
    expect(cleared.viewport).toEqual(moved.viewport);
  });

  it('changes no graph fact on any camera action', () => {
    // Sheet 05.7: "no keystroke on this sheet changes the graph, so a reader
    // who is lost can always press 1 and get the whole board back without
    // having edited anything."
    const seeded = canvasReduce(framed, { type: 'canvas/position', nodeId: 'a', x: 1, y: 2 });
    const cameraOnly: CanvasAction[] = [
      { type: 'canvas/pan', dx: 9, dy: 9 },
      { type: 'canvas/zoom-step', direction: -1 },
      { type: 'canvas/zoom-reset' },
      { type: 'canvas/fit', bounds: { x: 0, y: 0, width: 100, height: 100 } },
    ];

    let state = seeded;
    for (const action of cameraOnly) state = canvasReduce(state, action);

    expect(state.positions).toEqual(seeded.positions);
    expect(state.view).toEqual(seeded.view);
    expect(state.scope).toEqual(seeded.scope);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM playback — S3 IS WRITTEN, AND BY THESE FOUR ACTIONS ONLY.

   `CanvasView`'s S3 member has existed since item 2.1 and NOTHING WROTE IT:
   the rail held the cursor in a `useState` and the board held its own copy of
   this slice in a private `useReducer`, so a click on a traced function drew a
   hop list and moved nothing on the board while the panel's heading claimed it
   played there. These are the transitions that make the heading true; the
   browser lock that proves it end to end is `e2e/flow-plays.mjs`.
   ══════════════════════════════════════════════════════════════════════════ */
describe('item playback — the flow, as state', () => {
  const playing = canvasReduce(framed, { type: 'canvas/flow', playback: PLAYBACK });

  it('enters S3 carrying the flow the rail resolved, verbatim', () => {
    expect(playing.view.state).toBe('S3');
    expect(playing.view.state === 'S3' && playing.view.playback.hops).toEqual(HOPS);
    expect(playing.view.state === 'S3' && playing.view.playback.functionId).toBe('fn:x');
  });

  it('moves the playhead without touching the lit set', () => {
    // THE LIT SET IS THE WHOLE PATH AND DOES NOT CHANGE AS YOU WALK IT. A
    // cursor action that rewrote `dim` would make the board flash undimmed and
    // re-dimmed on every step — the reader would see the answer blink rather
    // than move.
    const lit = canvasReduce(playing, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a', 'svc:b'], litEdgeIds: [] },
      focus: 'svc:a',
    });
    const stepped = canvasReduce(lit, { type: 'canvas/flow-cursor', cursor: 1, playing: true });

    expect(stepped.view.state === 'S3' && stepped.view.playback.cursor).toBe(1);
    expect(stepped.dim).toBe(lit.dim);
  });

  it('clamps the playhead into the hops it has', () => {
    const past = canvasReduce(playing, { type: 'canvas/flow-cursor', cursor: 99, playing: false });
    expect(past.view.state === 'S3' && past.view.playback.cursor).toBe(HOPS.length - 1);
    const before = canvasReduce(playing, { type: 'canvas/flow-cursor', cursor: -4, playing: false });
    expect(before.view.state === 'S3' && before.view.playback.cursor).toBe(0);
  });

  it('refuses to resurrect a flow that was cleared', () => {
    // A scrub that arrives after the panel closed must not put the board back
    // into S3. Both of these are no-ops outside S3, and the identity check is
    // the assertion: nothing was allocated, so nothing changed.
    const cleared = canvasReduce(playing, { type: 'canvas/flow-clear' });
    expect(canvasReduce(cleared, { type: 'canvas/flow-cursor', cursor: 1, playing: true })).toBe(
      cleared,
    );
    expect(
      canvasReduce(cleared, { type: 'canvas/flow-focus', dim: null, focus: 'svc:a' }),
    ).toBe(cleared);
  });

  it('selects the hop the board resolved, so the reader can see WHICH hop', () => {
    // Sheet 06.1's order is monotonic — rest, hover, selected, multi, dimmed —
    // so the current hop's card, selected, is the loudest thing on a board whose
    // every other card has receded. ONE card, never a list: two would read as a
    // multi-selection the reader made.
    const lit = canvasReduce(playing, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a', 'svc:b'], litEdgeIds: ['e1'] },
      focus: 'svc:b',
    });
    expect(lit.selection.nodeIds).toEqual(['svc:b']);
    expect(lit.selection.anchor).toBe('svc:b');
    expect(lit.dim).toEqual({
      reason: 'playback',
      litNodeIds: ['svc:a', 'svc:b'],
      litEdgeIds: ['e1'],
    });
  });

  it('returns the SAME object when the board’s answer has not moved', () => {
    /* THIS IS LOAD-BEARING, NOT TIDINESS. `ConnectedBoard` computes the
       resolution in an effect off its own projection and dispatches the result;
       a reducer that allocated every time would re-render the board, which would
       re-run the effect, which would dispatch again. This identity is what makes
       that data flow terminate. */
    const dim = { reason: 'playback' as const, litNodeIds: ['svc:a'], litEdgeIds: [] };
    const once = canvasReduce(playing, { type: 'canvas/flow-focus', dim, focus: 'svc:a' });
    const twice = canvasReduce(once, {
      type: 'canvas/flow-focus',
      // A DIFFERENT OBJECT SAYING THE SAME THING — which is what the effect
      // actually produces, since `resolveFlow` builds a fresh one each pass.
      dim: { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: [] },
      focus: 'svc:a',
    });
    expect(twice).toBe(once);
  });

  it('drops the previous flow’s lit set when a different function is played', () => {
    const lit = canvasReduce(playing, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: [] },
      focus: 'svc:a',
    });
    const other = canvasReduce(lit, {
      type: 'canvas/flow',
      playback: { ...PLAYBACK, functionId: 'fn:y' },
    });
    // Two flows never light the same path, and carrying the old one across
    // would leave the reader looking at the previous question's answer while
    // the strip reads the new one's hops.
    expect(other.dim).toBeNull();
    expect(other.selection.nodeIds).toEqual([]);
  });

  it('leaves S3 for S1 on clear, and leaves the camera where the flow put it', () => {
    const lit = canvasReduce(playing, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a'], litEdgeIds: [] },
      focus: 'svc:a',
    });
    const moved = canvasReduce(lit, { type: 'canvas/pan', dx: 40, dy: 40 });
    const cleared = canvasReduce(moved, { type: 'canvas/flow-clear' });

    expect(cleared.view.state).toBe('S1');
    expect(cleared.dim).toBeNull();
    expect(cleared.selection.nodeIds).toEqual([]);
    // Losing your place is not the same as closing a panel.
    expect(cleared.viewport).toEqual(moved.viewport);
  });
});

describe('item 3.4 — the budget is the frame, not a node count', () => {
  it('is derived at runtime and moves when the frame does', () => {
    // R9: v1's DEFAULT_MAX_CARDS = 24 was derived for a 1400 x 900 canvas, and
    // a three-pane shell at 1280 gives this pane about 614. The constant was
    // right for a frame that no longer exists.
    const wide = detailBudget(1400, 900);
    const shelled = detailBudget(614, 700);

    expect(wide).toBeGreaterThan(shelled);

    // THE NUMBER IS NOT PINNED, AND THAT IS THE POINT. v1's constant is 24 and
    // this derivation gives 49 for the same 1400 x 900, because the two are
    // different arithmetic — v1 divides the frame by a card at its 0.6 fit
    // FLOOR, this divides it by a card at 1:1. Pinning either literal here
    // would reintroduce exactly the defect the item removes: a card budget that
    // is a number somebody wrote down. What is asserted is the DERIVATION.
    expect(wide).toBe(Math.floor(1400 / 184) * Math.floor(900 / 120));
    expect(shelled).toBe(Math.floor(614 / 184) * Math.floor(700 / 120));
  });

  it('is zero on a frame that has not been measured, and never negative', () => {
    expect(detailBudget(0, 0)).toBe(0);
    expect(detailBudget(-100, 50)).toBe(0);
    expect(detailBudget(50, 50)).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FINDING F4 — an ADDITIVE select mid-playback must end the flow exactly like
   the non-additive branch does. Before the fix the additive arm fell through
   without touching `view` or `dim`, so a shift-click off the flow kept the
   stale playback lit set under a selection that had already left it.
   ══════════════════════════════════════════════════════════════════════════ */
describe('finding F4 — additive select ends a playing flow like an ordinary one', () => {
  const playing = canvasReduce(framed, { type: 'canvas/flow', playback: PLAYBACK });

  it('an additive click OFF the flow leaves S3 and drops the playback dim', () => {
    const lit = canvasReduce(playing, {
      type: 'canvas/flow-focus',
      dim: { reason: 'playback', litNodeIds: ['svc:a', 'svc:b'], litEdgeIds: [] },
      focus: 'svc:b',
    });
    expect(lit.view.state).toBe('S3');
    expect(lit.dim).not.toBeNull();

    const offFlow = canvasReduce(lit, {
      type: 'canvas/select',
      nodeId: 'svc:c',
      additive: true,
    });
    expect(offFlow.view.state).toBe('S1');
    expect(offFlow.dim).toBeNull();
    // The selection itself still adds — sheet 06.2 is untouched.
    expect(offFlow.selection.nodeIds).toContain('svc:c');
  });

  it('an additive click ON the flow keeps it, as before', () => {
    const onFlow = canvasReduce(playing, {
      type: 'canvas/select',
      nodeId: 'svc:a',
      additive: true,
    });
    expect(onFlow.view.state).toBe('S3');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FINDING F5 — leaving a flow lands on S1, THE GROUNDED DOCUMENT. types.ts:
   S0 is "nothing attached"; a board that just showed a document is not that.
   ══════════════════════════════════════════════════════════════════════════ */
describe('finding F5 — an out-of-flow click emits S1, never S0', () => {
  it('leaves the flow onto the grounded-document state', () => {
    const playing = canvasReduce(framed, { type: 'canvas/flow', playback: PLAYBACK });
    const left = canvasReduce(playing, {
      type: 'canvas/select',
      nodeId: 'svc:c',
      additive: false,
    });
    expect(left.view).toEqual({ state: 'S1' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P1 — "Fit is a dead control". `canvas/reset` fires when a scan lands, and it
   used to return EMPTY_CANVAS wholesale — zeroing the FRAME, a measurement of
   the pane the ResizeObserver only re-takes when the size CHANGES. Every fit
   thereafter computed against 0×0 and returned null: boot auto-fit, the Fit
   button, the 1/2 keys, the hop camera. Measured in the shipped bundle:
   2,160px of content in a 500px pane, transform at identity, budget 0.
   ══════════════════════════════════════════════════════════════════════════ */
describe('canvas/reset — the frame is glass, not document', () => {
  it('resets everything ABOUT the document but keeps the measured frame', () => {
    const measured = canvasReduce(EMPTY_CANVAS, {
      type: 'canvas/frame',
      width: 500,
      height: 639,
    });
    const withState = canvasReduce(
      canvasReduce(measured, { type: 'canvas/select', nodeId: 'svc:a', additive: false }),
      { type: 'canvas/zoom-step', direction: -1 },
    );
    const reset = canvasReduce(withState, { type: 'canvas/reset' });

    // Document-derived state: gone.
    expect(reset.selection.nodeIds).toEqual([]);
    expect(reset.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(reset.view.state).toBe('S0');
    // The measurement of the pane: kept, budget included.
    expect(reset.frame.width).toBe(500);
    expect(reset.frame.height).toBe(639);
    expect(reset.frame.budget).toBe(detailBudget(500, 639));
  });

  it('a fit right after a reset still moves the camera', () => {
    const measured = canvasReduce(EMPTY_CANVAS, {
      type: 'canvas/frame',
      width: 500,
      height: 639,
    });
    const reset = canvasReduce(measured, { type: 'canvas/reset' });
    const fitted = canvasReduce(reset, {
      type: 'canvas/fit',
      bounds: { x: 0, y: 0, width: 2160, height: 115 },
    });
    // The exact shape the audit measured: wide content, narrow pane. A dead
    // fit leaves zoom at 1; a live one lands at the clamp floor.
    expect(fitted.viewport.zoom).toBeLessThan(1);
    expect(fitted.viewport.zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
  });
});
