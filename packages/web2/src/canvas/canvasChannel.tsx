/* ══════════════════════════════════════════════════════════════════════════
   THE CANVAS CHANNEL — item playback
   packages/web2/src/canvas/canvasChannel.tsx

   ONE CANVAS SLICE, READ AND WRITTEN BY BOTH SURFACES THAT TOUCH IT.

   ── THE DEFECT THIS CLOSES, IN THE WORDS THE TWO FILES USED ──────────────

   `ConnectedIndexRail.tsx`: "the rail and the board are two React trees with no
   state between them. So the cursor is held here… What it does NOT do is move
   the board, and this file does not pretend otherwise."

   `ConnectedBoard.tsx`: "`ConnectedBoard` therefore holds the canvas slice in a
   `useReducer` of its OWN, seeded from the store's empty value."

   Both were true and both were documented, and the user-visible string kept
   asserting the behaviour anyway: the flow panel was headed "Plays on board"
   while the Waves 4/5 gate clicked a traced function in the shipped bundle and
   watched no board node change class, selection or camera. The heading was
   retreated to "Traced path" rather than the wiring being built. This file is
   the wiring.

   ── WHY THIS PROVIDER AND NOT `state/store.ts`, STATED PLAINLY ───────────

   The canvas family belongs in the store, and both files above write out the
   fold in full: add `CanvasAction` to `Action`, add one case returning
   `{...state, canvas: canvasReduce(state.canvas, action)}`. That is still the
   right end state and this file does not change its shape by one character.

   IT IS NOT DONE HERE BECAUSE `state/` IS ANOTHER LANE'S TREE. CANON §6:
   "One agent per file. Twelve agents editing twelve files with no coordination
   produced three specifications of one control and cost a full repair cycle."
   The precedent for the shape is inside this package and it is exact —
   `app/ConnectedIndexRail.tsx` exists in `app/` rather than in
   `state/connect.tsx` for this identical reason, and says so in its own header.

   WHAT IS DIFFERENT FROM THE SITUATION BEFORE, AND IT IS THE WHOLE POINT:
   there is now exactly ONE canvas slice in the running application, not two.
   The board's private reducer is gone. `state.canvas` in the store is the seed
   this provider starts from and nothing else reads or writes it, so there is no
   second opinion — the same relation `shell` had to its own model before the
   store took it over.

   ── IT OWNS THE CLOCK, BECAUSE THE CLOCK IS PART OF THE CLAIM ────────────

   `FlowPlayback.playing` existed and NOTHING IN THE PACKAGE ADVANCED THE
   CURSOR — `grep -rn "setInterval|setTimeout|requestAnimationFrame"` across
   `rail/`, `app/` and `canvas/` returned nothing. So the play button toggled a
   boolean, the pause button's aria-label read "Pause the flow" about a flow
   that was not moving, and a reader who pressed play watched one hop forever.
   A heading that says the flow PLAYS is false without this effect, so it is
   here rather than filed as a follow-up.
   ══════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import { canvasReduce, type CanvasAction } from './canvasReduce.js';
import { useStore } from '../state';
import type { CanvasSlice } from '../state/types';

/** How long one hop holds the board before the next. */
export const HOP_MS_FALLBACK = 400;

/**
 * `--seq-dur-hop`, read off the live cascade.
 *
 * THE TOKEN ALREADY EXISTED AND NOTHING READ IT: `tokens/graphite.css:539`
 * declares `--seq-dur-hop: 400ms` beside `--seq-dur-panel` and `--seq-dur-cam`,
 * which sheet 06.7 spends on the dim and on the camera. Hard-coding 400 here
 * would be the fifth number in this package that the token layer already owns,
 * and the first one to drift the day the token moves.
 *
 * The fallback is the same value and is used where there is no cascade at all —
 * jsdom does not load the stylesheet, so a unit test reads an empty string. A
 * fallback that differed from the token would make the test and the product
 * two different products.
 */
export function readHopMs(element: Element | null): number {
  if (!element || typeof getComputedStyle !== 'function') return HOP_MS_FALLBACK;
  const raw = getComputedStyle(element).getPropertyValue('--seq-dur-hop').trim();
  const ms = raw.endsWith('ms') ? Number.parseFloat(raw) : raw.endsWith('s') ? Number.parseFloat(raw) * 1000 : Number.NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : HOP_MS_FALLBACK;
}

export interface CanvasChannel {
  canvas: CanvasSlice;
  dispatch: (action: CanvasAction) => void;
}

const CanvasContext = createContext<CanvasChannel | null>(null);

/**
 * IT THROWS RATHER THAN FALLING BACK TO A PRIVATE SLICE.
 *
 * A default value here would be a component quietly running on a canvas nobody
 * else can see — which is precisely the bug this file exists to remove, wearing
 * the costume of a convenience. The message names the fix.
 */
export function useCanvas(): CanvasChannel {
  const channel = useContext(CanvasContext);
  if (channel === null) {
    throw new Error(
      'useCanvas: no <CanvasProvider> above this component. The board and the index rail ' +
        'share one CanvasSlice; mount CanvasProvider inside StoreProvider in app/App.tsx.',
    );
  }
  return channel;
}

export function CanvasProvider({ children }: { children: ReactNode }) {
  const store = useStore();

  /* SEEDED FROM THE STORE'S OWN EMPTY VALUE, never from a second literal
     declared here. `initial.ts` argues every field of `EMPTY_CANVAS` — the
     zeros that do not mean zero, the S0 guard on an unmeasured frame — and a
     copy of that reasoning in this file would be a second answer to a question
     already answered. */
  const [canvas, dispatch] = useReducer(canvasReduce, store.getState().canvas);

  /* ── A NEW SCAN RE-SEEDS THE SLICE ──────────────────────────────────────

     FINDINGS F1/F3. The seed above is read ONCE, so a selection, a dim or a
     flow made while repo A was attached walked straight into repo B when it
     loaded — and the Wave-2 dim effect then receded everything at B's boot
     from ids the reader chose in A. `repo/detached` resets the STORE's slice,
     but only the channel's slice is live; so the channel watches for the
     scanned document changing identity (`scannedAt`) and dispatches
     `canvas/reset` — the empty slice `initial.ts` argues for, arrived at
     through the one funnel. A rescan of the same repo carries a new
     `scannedAt` too, which is exactly right: its node ids are new facts. */
  useEffect(() => {
    const scanKeyOf = () => {
      const repo = store.getState().repo;
      return repo.phase === 'attached' || repo.phase === 'stale' ? repo.repo.scannedAt : null;
    };
    let last = scanKeyOf();
    return store.subscribe(() => {
      const key = scanKeyOf();
      if (key === last) return;
      last = key;
      dispatch({ type: 'canvas/reset' });
      store.dispatch({ type: 'topology/clear' });
    });
  }, [store]);

  /* ── AN AGENT'S PROPOSAL REACHES THE BOARD ──────────────────────────────

     THE SEAM THAT DID NOT EXIST. `canvasReduce` has handled `canvas/proposal`
     since it was written; the dashed ghost, the Accept that runs back through
     `docEdit` and the Deny that drops the layer are all built and covered by
     fourteen tests. A grep for `canvas/proposal` across the whole client
     returned the union declaration, the reducer case, and the tests. NOTHING
     DISPATCHED IT — so an agent could propose a change to your architecture and
     the product had no way to show you.

     It is subscribed rather than read once, because a proposal arrives MID-TURN
     off the ask stream: the store commits the event and this is what carries it
     across into the canvas slice, which lives in a different reducer for the
     reason this file's header gives.

     THE IDENTITY IS THE PROPOSAL, NOT ITS CONTENT. Dispatching on every store
     change would replace the ghost on every streamed token, and the reducer
     clears the selection each time — the reader would be unable to click
     anything while the answer was still being written. */
  useEffect(() => {
    /* THE OBJECT, NOT ITS ID. Keying on the id dropped a SECOND proposal in
       the same turn - measured: the board kept showing the first one. The store
       returns the same reference when nothing changed, so reference identity is
       both exact and free. */
    let last = store.getState().session.topology;
    /* Fired for whatever is already there, so a provider mounted after the
       event still shows the ghost. */
    const apply = () => {
      const proposal = store.getState().session.topology;
      if (proposal === last) return;
      last = proposal;
      if (proposal) dispatch({ type: 'canvas/proposal', proposal });
      else dispatch({ type: 'canvas/proposal-clear' });
    };
    const first = store.getState().session.topology;
    if (first) dispatch({ type: 'canvas/proposal', proposal: first });
    return store.subscribe(apply);
  }, [store]);

  /* ── THE HOP CLOCK ─────────────────────────────────────────────────────
     ONE TIMEOUT PER HOP, NOT AN INTERVAL. An interval keeps firing while the
     effect that owns it is being torn down and set up around a state change,
     and a flow that scrubs while playing would then step twice for one tick.
     A timeout keyed on the cursor cannot: each one schedules exactly the hop
     after the one on screen, and a scrub cancels it.

     IT STOPS AT THE LAST HOP RATHER THAN LOOPING. A flow that restarted would
     make "which hop am I on" a question with no stable answer, and the strip
     would run away from a reader who left it playing. Stopping writes
     `playing: false`, so the button returns to Play and says what it will do.  */
  useEffect(() => {
    if (canvas.view.state !== 'S3') return undefined;
    const playback = canvas.view.playback;
    if (!playback.playing || playback.hops.length === 0) return undefined;

    const last = playback.hops.length - 1;
    if (playback.cursor >= last) {
      dispatch({ type: 'canvas/flow-cursor', cursor: last, playing: false });
      return undefined;
    }

    const handle = setTimeout(() => {
      dispatch({ type: 'canvas/flow-cursor', cursor: playback.cursor + 1, playing: true });
    }, readHopMs(typeof document === 'undefined' ? null : document.documentElement));

    return () => clearTimeout(handle);
  }, [canvas.view]);

  const channel = useMemo<CanvasChannel>(() => ({ canvas, dispatch }), [canvas]);

  return <CanvasContext.Provider value={channel}>{children}</CanvasContext.Provider>;
}
