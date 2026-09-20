/* ══════════════════════════════════════════════════════════════════════════
   THE CANVAS TRANSITIONS — item 3.4
   packages/web2/src/canvas/canvasReduce.ts

   ONE FUNNEL, AND IT IS PURE. Every change to what the board is looking at is
   an action applied here; the host dispatches and never poked a setter. That is
   the whole of item 3.4's "no imperative getState/setState pokes" — v1's board
   held the camera in React Flow, the selection in the store and the scope in a
   third place, and the canvas changed out from under the reader whenever two of
   them disagreed.

   IT REDUCES THE FROZEN `CanvasSlice` and invents no state of its own. That is
   deliberate and it is the handback: this function is written to be dropped
   into `state/store.ts` as one case block —

       case 'canvas/pan': …            →   default:
                                             return { ...state,
                                               canvas: canvasReduce(state.canvas, action) };

   — the day the store lane folds the canvas family in. It lives here rather
   than there because `state/store.ts` belongs to another lane and a shared file
   edited by two lanes is the exact contradiction Wave 2 was arranged to avoid.
   Nothing about the shape changes when it moves.

   RUNG IS DERIVED AT THE SINGLE EXIT, never assigned by a branch. `store.ts`
   does the same thing with `composer.send` and states why: a field recomputed
   unconditionally on the way out is a projection, not a second source of truth.
   `CanvasSlice.rung` is state rather than a render-local because the card, the
   legend and the census all have to agree about which rung is live; making it
   derived is what stops them disagreeing.
   ══════════════════════════════════════════════════════════════════════════ */

import type {
  CanvasSlice,
  DimSpec,
  FlowPlayback,
  NodeId,
  TopologyProposal,
  Viewport,
} from '../state/types';
import { EMPTY_CANVAS } from '../state/initial';
import { sameDim } from './flowFocus.js';
import {
  type Bounds,
  type Point,
  ZOOM_MIN,
  clampZoom,
  fitViewport,
  pan,
  stepAboutCentre,
  zoomAbout,
} from './camera.js';
import { rungFor } from './lod.js';

export type CanvasAction =
  /* ── the frame ───────────────────────────────────────────────────────── */
  | { type: 'canvas/frame'; width: number; height: number }
  /* ── the camera ──────────────────────────────────────────────────────── */
  | { type: 'canvas/pan'; dx: number; dy: number }
  | { type: 'canvas/viewport'; viewport: Viewport }
  | { type: 'canvas/zoom-at'; zoom: number; at: Point }
  | { type: 'canvas/zoom-step'; direction: 1 | -1 }
  | { type: 'canvas/zoom-reset' }
  /* `reserve` is a screen-space box the fit must not put content under — the
     edgeless note. The reducer cannot know whether that note is rendered or how
     tall it is, so the component measures it and passes it. See finding F2. */
  | {
      type: 'canvas/fit';
      bounds: Bounds | null;
      reserve?: Bounds | null;
      /** Chrome bands (furniture row) the fit keeps content clear of. */
      bands?: { top?: number; bottom?: number } | null;
    }
  /* ── what the reader chose ───────────────────────────────────────────── */
  | { type: 'canvas/select'; nodeId: NodeId; additive: boolean }
  | { type: 'canvas/clear' }
  /* ── S3, THE FLOW — item playback ─────────────────────────────────────
     Three actions and not one, because the three do different things to the
     slice and collapsing them is what makes a dim flicker on every step:

       flow        enters or REPLACES S3. A different function is a different
                   flow, so the lit set and the selection are dropped and the
                   board resolves the new one.
       flow-cursor moves the playhead inside the flow that is already playing.
                   It deliberately does NOT touch `dim`: the lit set is the
                   whole path and does not change as you walk it.
       flow-focus  the BOARD's answer — which of the lit nodes exist on it, and
                   which one the current hop lands on. It is the only writer of
                   `dim` and the only thing that can know, because the reducer
                   has no document.
       flow-clear  leaves S3.
     ─────────────────────────────────────────────────────────────────────── */
  | { type: 'canvas/flow'; playback: FlowPlayback }
  | { type: 'canvas/flow-cursor'; cursor: number; playing: boolean }
  | { type: 'canvas/flow-focus'; dim: DimSpec | null; focus: NodeId | null }
  | { type: 'canvas/flow-clear' }
  /* ── DECISION 6 — SELECTION DIMS OFF-PATH ─────────────────────────────
     The host that owns the document resolves a click into a DimSpec
     (`selectionDim`) and dispatches the RESULT here; the reducer never
     derives a dim from `selection` itself because it has no edges to walk.
     It is a separate action from `canvas/select` so sheet 06.6's rule stays
     legible at the type: selection writes `selection`, this writes `dim`. */
  | { type: 'canvas/dim'; dim: DimSpec | null }
  /* ── DECISION 6 — /api/annotate LANDS IN THE SLICE ────────────────────
     The per-node English the analyzer returned for THIS scan. Replaced
     wholesale on each answer; `{}` when there is none. */
  | { type: 'canvas/annotate'; annotations: Record<NodeId, string[]> }
  /* ── S4, THE PROPOSAL GHOST ────────────────────────────────────────────
     The agent proposes topology; it is drawn DASHED over the grounded document
     with one Accept/Deny bar, and the rail never shows any of it — unaccepted
     topology is not part of the index.

     It arrives from a TURN, not from a drawing: `TopologyProposal.turnId` is
     the ask that produced it. That is why this state does not wait on a draw
     mode — an agent can propose a service without anybody picking up a pen.

     Entering S4 CLEARS the selection and the dim. A ghost the reader is meant
     to judge should not arrive with three cards still lit from the last
     question, and a dim spent on a flow says something about a flow that is no
     longer on screen. */
  | { type: 'canvas/proposal'; proposal: TopologyProposal }
  /* Deny, or the turn moving on. Accept is NOT here: applying a proposal edits
     the DOCUMENT, which is `docEdit`'s job, and this reducer owns no document. */
  | { type: 'canvas/proposal-clear' }
  /* ── the layout ──────────────────────────────────────────────────────── */
  | { type: 'canvas/position'; nodeId: NodeId; x: number; y: number }
  | { type: 'canvas/layout'; layout: CanvasSlice['layout'] }
  /* ── A NEW SCAN — findings F1/F3 ───────────────────────────────────────
     The slice a previous scan left behind — its selection, its dim, its flow
     view, its annotations — describes nodes the new scan may not carry. The
     channel re-seeds through this action when `repo/loaded` lands. */
  | { type: 'canvas/reset' };

/**
 * THE DETAIL BUDGET, DERIVED FROM THE FRAME — sheet 08.1, "the budget is the
 * frame, not a node count".
 *
 * It is a DETAIL budget and never a node cap. The board draws every node the
 * analyzer found; when the frame runs out, cards drop a rung. A node the
 * analyzer found and the board silently declined to draw is a lie of omission,
 * and `CanvasFrame.budget` exists so a surface can ask "how much fits" without
 * anyone being tempted to answer it by trimming.
 *
 * v1's `DEFAULT_MAX_CARDS = 24` is the number this replaces: derived once, at
 * authoring time, for a 1400x900 canvas — while a three-pane shell at 1280 wide
 * gives the canvas about 614. The constant was right for a frame that no longer
 * exists, which is why it is computed rather than written down.
 *
 * A card's footprint is its own box plus one field cell of air, so the gutter
 * is on the same ramp as the ground it sits on.
 */
export function detailBudget(width: number, height: number): number {
  const CARD_W = 160; // --arch-card-w
  const CARD_MIN_H = 96; // --arch-card-min-h
  const PITCH = 24; // --board-field-pitch
  if (width <= 0 || height <= 0) return 0;
  const columns = Math.floor(width / (CARD_W + PITCH));
  const rows = Math.floor(height / (CARD_MIN_H + PITCH));
  return Math.max(0, columns * rows);
}

/** The single exit. Anything a fold can produce is recomputed here, so no
 *  branch above can leave the slice self-contradictory. */
function derive(canvas: CanvasSlice): CanvasSlice {
  const rung = rungFor(canvas.viewport.zoom);
  if (rung === canvas.rung) return canvas;
  return { ...canvas, rung };
}

function withViewport(canvas: CanvasSlice, viewport: Viewport): CanvasSlice {
  return { ...canvas, viewport: { ...viewport, zoom: clampZoom(viewport.zoom) } };
}

/** Shallow identity of two annotation maps — the same role `sameDim` plays for
 *  the dim, and cheap because both sides are flat id → string[] records. */
function sameAnnotations(
  a: Record<NodeId, string[]>,
  b: Record<NodeId, string[]>,
): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((id) => a[id] === b[id]);
}

export function canvasReduce(canvas: CanvasSlice, action: CanvasAction): CanvasSlice {
  return derive(apply(canvas, action));
}

function apply(canvas: CanvasSlice, action: CanvasAction): CanvasSlice {
  switch (action.type) {
    case 'canvas/frame': {
      const width = Math.max(0, action.width);
      const height = Math.max(0, action.height);
      return { ...canvas, frame: { width, height, budget: detailBudget(width, height) } };
    }

    case 'canvas/pan':
      return withViewport(canvas, pan(canvas.viewport, action.dx, action.dy));

    case 'canvas/viewport':
      return withViewport(canvas, action.viewport);

    case 'canvas/zoom-at':
      return withViewport(canvas, zoomAbout(canvas.viewport, action.zoom, action.at));

    case 'canvas/zoom-step':
      return withViewport(canvas, stepAboutCentre(canvas.viewport, canvas.frame, action.direction));

    /* The `0` key. 1:1 about the viewport centre, through the same function
       every other stepped zoom uses, so "clamped on every path" holds without
       a fourth clamp being written. */
    case 'canvas/zoom-reset':
      return withViewport(
        canvas,
        zoomAbout(canvas.viewport, 1, {
          x: canvas.frame.width / 2,
          y: canvas.frame.height / 2,
        }),
      );

    /* Fit-all and fit-to-selection arrive here as the same action carrying
       different bounds. A fit that cannot be computed — no objects, no frame —
       leaves the camera exactly where it was rather than moving it somewhere
       arithmetically defensible and visually wrong. */
    case 'canvas/fit': {
      const next = fitViewport(
        action.bounds,
        canvas.frame,
        action.reserve ?? null,
        action.bands ?? null,
      );
      return next ? withViewport(canvas, next) : canvas;
    }

    /* SELECTION ADDS AND NEVER SWAPS (sheet 06.2) — including at this level.
       A repeat click on a selected node inside an additive gesture removes it,
       which is the only way a reader can correct a shift-click without starting
       the whole selection again.

       DIMMING IS NOT TOUCHED HERE, and that is the rule rather than an
       omission: sheet 06.6 says an ordinary click selects and does not dim, and
       "dimming is never how the board answers a question". A lane that wants to
       dim on click has to add an action, not flip a flag. */
    case 'canvas/select': {
      const already = canvas.selection.nodeIds.includes(action.nodeId);
      /**
       * A SELECTION OUTSIDE THE PLAYING FLOW ENDS THE FLOW.
       *
       * Finding F2, reproduced twice in the running product: play a traced flow in
       * one package, then click an untraced function in another, and the board's
       * note read "Hop 1 of 1 · inside Acp service … The node it happened in is the
       * one lit" while the lit node was Analyzer. The note came from the stale
       * playback; the ring came from the new selection. Two sources, one sentence,
       * and the sentence was false.
       *
       * `canvas/select` deliberately leaves `view` and `dim` alone — that is right
       * for a click on a node the flow passes THROUGH, which is how a reader
       * inspects a hop without losing their place. It is wrong for a click on a
       * node the flow never touches: there is no reading of that gesture where the
       * old flow is still what the reader is looking at.
       *
       * The lane's own e2e sidestepped this by pressing Escape first, which means
       * it knew rail clicks polluted the focus and worked around it rather than
       * closing it.
       */
      const inFlow =
        canvas.view.state === 'S3' &&
        canvas.view.playback.hops.some(
          (h) => h.from === action.nodeId || h.to === action.nodeId,
        );
      /* FINDINGS F4/F5 — BOTH ARMS LEAVE THE FLOW THE SAME WAY. A click on a
         node the flow never touches ends the playback: the board returns to
         S1, the grounded document (never S0, which types.ts defines as
         "nothing attached"), and the flow's dim goes with it. The additive
         arm applies this too — before the fix it fell through and kept a
         stale lit set under a selection that had already left the flow. */
      const leaveFlow = canvas.view.state === 'S3' && !inFlow;
      const view = leaveFlow ? ({ state: 'S1' } as const) : canvas.view;
      const dim = leaveFlow ? null : canvas.dim;
      if (!action.additive) {
        return {
          ...canvas,
          view,
          dim,
          selection: { nodeIds: [action.nodeId], edgeIds: [], anchor: action.nodeId },
        };
      }
      const nodeIds = already
        ? canvas.selection.nodeIds.filter((id) => id !== action.nodeId)
        : [...canvas.selection.nodeIds, action.nodeId];
      return {
        ...canvas,
        view,
        dim,
        selection: {
          nodeIds,
          edgeIds: canvas.selection.edgeIds,
          anchor: nodeIds.length ? action.nodeId : null,
        },
      };
    }

    /* Esc. Sheet 05.7: "no keystroke on this sheet changes the graph, so a
       reader who is lost can always get back without having edited anything."
       The camera is deliberately NOT reset — losing your place is not the same
       as losing your selection.

       DECISION 6: a SELECTION-sourced dim is the answer to the question Escape
       also closes, so it goes with the selection. A playback dim does not —
       clearing the flow is `canvas/flow-clear`'s job, and Escape mid-playback
       must not undim the board under a running flow. */
    case 'canvas/clear': {
      const dim = canvas.dim?.reason === 'selection' ? null : canvas.dim;
      if (!canvas.selection.nodeIds.length && dim === canvas.dim) return canvas;
      return { ...canvas, dim, selection: { nodeIds: [], edgeIds: [], anchor: null } };
    }

    /* DECISION 6's write arm. A no-op outside S1/S2/S4: while S3 is live the
       dim belongs to the playback (`canvas/flow-focus`), and a click-driven
       resolution arriving mid-flow must not fight it. Same-object returns when
       nothing moved are load-bearing here exactly as they are in
       `canvas/flow-focus`: the host recomputes this on every render of a
       selection, and an always-allocating reducer would be a render loop. */
    case 'canvas/dim': {
      if (canvas.view.state === 'S3') return canvas;
      if (sameDim(canvas.dim, action.dim)) return canvas;
      return { ...canvas, dim: action.dim };
    }

    /* The annotate answer lands whole or not at all. There is no merge: the
       endpoint's map IS the state of per-node English for this scan, and
       merging into a previous scan's map is how a stale sentence survives a
       rescan. */
    case 'canvas/annotate':
      if (sameAnnotations(canvas.annotations, action.annotations)) return canvas;
      return { ...canvas, annotations: action.annotations };

    /* ══ S3 — THE FLOW PLAYS ON THE BOARD ═══════════════════════════════════

       WHAT WAS HERE BEFORE THIS BLOCK: nothing. `playback` was a `useState` in
       `ConnectedIndexRail` and this reducer lived in a `useReducer` private to
       `ConnectedBoard`, so the two surfaces were two React trees with no state
       between them. The rail's own comment recorded it, the flow panel's
       heading retreated from "Plays on board" to "Traced path" because of it,
       and the Waves 4/5 gate confirmed it in the shipped bundle: click a traced
       function, and no board node changes class, selection or camera.

       `canvas.view` is where S3 belongs — `state/types.ts` models it as
       `{state:'S3'; playback: FlowPlayback}` and has since item 2.1. This is
       that member finally being written. */

    /* A NEW FLOW DROPS THE OLD ONE'S LIT SET RATHER THAN INHERITING IT. Two
       flows never light the same path, and carrying the previous dim into the
       new flow would leave the reader looking at the last question's answer
       while the strip reads the new one's hops. The board resolves the new path
       and dispatches `flow-focus` on the next pass. */
    case 'canvas/flow': {
      const already =
        canvas.view.state === 'S3' && canvas.view.playback.functionId === action.playback.functionId;
      if (already) {
        return { ...canvas, view: { state: 'S3', playback: action.playback } };
      }
      return {
        ...canvas,
        view: { state: 'S3', playback: action.playback },
        dim: null,
        selection: { nodeIds: [], edgeIds: [], anchor: null },
      };
    }

    /* THE PLAYHEAD, AND NOTHING ELSE. It is a no-op outside S3 rather than a
       state that quietly enters it: a scrub that arrives after the flow was
       cleared must not resurrect it. The clamp is here and not at the four call
       sites — the strip, the ticker, a keystroke and a test — because a cursor
       past the end is the kind of thing exactly one of four call sites forgets. */
    case 'canvas/flow-cursor': {
      if (canvas.view.state !== 'S3') return canvas;
      const { playback } = canvas.view;
      const last = playback.hops.length - 1;
      const cursor = last < 0 ? -1 : Math.min(Math.max(action.cursor, 0), last);
      if (cursor === playback.cursor && action.playing === playback.playing) return canvas;
      return {
        ...canvas,
        view: { state: 'S3', playback: { ...playback, cursor, playing: action.playing } },
      };
    }

    /* THE BOARD'S OWN ANSWER, APPLIED. `dim` and the playback selection are
       written here and nowhere else while S3 is live.

       IT RETURNS THE SAME OBJECT WHEN NOTHING MOVED, and that is load-bearing
       rather than tidy: the board computes this in an effect off its own
       projection and dispatches the result, so a reducer that always allocated
       would re-render the board, which would re-run the effect, which would
       dispatch again. `sameDim` and the anchor comparison are what make that
       flow terminate. */
    case 'canvas/flow-focus': {
      if (canvas.view.state !== 'S3') return canvas;
      const anchor = canvas.selection.anchor;
      if (sameDim(canvas.dim, action.dim) && anchor === action.focus) return canvas;
      return {
        ...canvas,
        dim: action.dim,
        /* SELECTION IS HOW THE READER SEES WHICH HOP THEY ARE ON. Sheet 06.1's
           order is monotonic — rest, hover, selected, multi, dimmed — so the
           current hop's card, being selected, is the loudest thing on a board
           whose every other card has receded. One card, never a list: two
           selected cards would read as a multi-selection the reader made. */
        selection: action.focus
          ? { nodeIds: [action.focus], edgeIds: [], anchor: action.focus }
          : { nodeIds: [], edgeIds: [], anchor: null },
      };
    }

    /* Clearing the flow returns the board to S1 — a document, nothing focused.
       The camera is deliberately left where the flow put it, for the reason
       `canvas/clear` gives one case up: losing your place is not the same as
       losing your selection, and a board that snapped home when a panel closed
       would undo the reader's own reading of it. */
    case 'canvas/proposal': {
      /* Replacing one ghost with another is a new proposal, not an update: a
         second answer to the same question is still a second answer, and
         merging them would show a topology no agent proposed. */
      return {
        ...canvas,
        view: { state: 'S4', proposal: action.proposal },
        dim: null,
        selection: { nodeIds: [], edgeIds: [], anchor: null },
      };
    }

    case 'canvas/proposal-clear': {
      if (canvas.view.state !== 'S4') return canvas;
      /* Back to S1, the grounded document — never to S2 or S3. Whatever was
         focused or playing before the ghost is a state the reader left, and
         restoring it would be the board deciding they wanted to go back. */
      return {
        ...canvas,
        view: { state: 'S1' },
        dim: null,
        selection: { nodeIds: [], edgeIds: [], anchor: null },
      };
    }

    case 'canvas/flow-clear': {
      if (canvas.view.state !== 'S3') return canvas;
      return {
        ...canvas,
        view: { state: 'S1' },
        dim: null,
        selection: { nodeIds: [], edgeIds: [], anchor: null },
      };
    }

    case 'canvas/position':
      return {
        ...canvas,
        positions: { ...canvas.positions, [action.nodeId]: { x: action.x, y: action.y } },
      };

    case 'canvas/layout':
      return { ...canvas, layout: action.layout };

    /*
     * THE FRAME SURVIVES A RESET — measured live, P1 "Fit is a dead control".
     *
     * `canvas/reset` fires when the scanned document changes identity (a scan
     * landing, a rescan). Selection, dim, flow, positions — all of those are
     * ABOUT the old document and must go. The frame is not: it is a
     * MEASUREMENT of the pane, taken by a ResizeObserver that only speaks
     * when the size CHANGES. Zeroing it here left every fit — the post-attach
     * auto-fit, the Fit control, the 1 and 2 keys, the playback hop camera —
     * computing against a 0×0 frame (`fitViewport` returns null) until the
     * user happened to resize something. Measured in the shipped bundle:
     * 2,160px of content in a 500px pane, transform at identity, budget 0.
     */
    case 'canvas/reset':
      return { ...EMPTY_CANVAS, frame: canvas.frame };

    default: {
      // Exhaustiveness, checked by the compiler rather than by a comment. A new
      // member of the union that nobody handled fails `tsc`, not a user.
      const never: never = action;
      return never;
    }
  }
}

/** The floor, re-exported so a surface reading it does not import two modules
 *  to ask one question. */
export { ZOOM_MIN };
