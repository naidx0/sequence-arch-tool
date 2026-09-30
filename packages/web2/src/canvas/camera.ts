/* ══════════════════════════════════════════════════════════════════════════
   THE CAMERA — range, gesture, stops and the ONE fit policy — item 3.6
   packages/web2/src/canvas/camera.ts

   Written against docs/brand/graphite/pages/05-the-canvas.html §§05.3-05.6.

   Pure. No React, no renderer, no DOM. Everything the board does to its camera
   goes through a function here, which is what makes sheet 05.9's assertions
   checkable at all: "zoom is clamped on EVERY path — gesture, button, key and
   fit alike" is only testable if there is one path.

   THE VIEWPORT CONVENTION is React Flow's, because that is the renderer this
   board mounts on: a point at flow coordinate `p` paints at screen coordinate
   `p * zoom + {x, y}`. Every function below is written against that one
   sentence, and `camera.test.ts` asserts the round trip rather than the
   algebra.
   ══════════════════════════════════════════════════════════════════════════ */

import { TITLE_HOLDS_TO } from './typeRamp.js';
import type { Viewport } from '../state/types';

/* ── 05.4 THE RANGE ────────────────────────────────────────────────────────
   Both ends are derived from tokens rather than picked, and they are
   reciprocals, so the readout is symmetric about 1:1 — two doublings out, two
   doublings in.

     floor    --board-field-pitch x 0.25 = --sp-6, and --arch-card-w x 0.25 =
              --sp-40. The dot pitch has fallen to the gap between two buttons
              and the card is as wide as the space between two major sections.
     ceiling  --board-field-pitch x 4 = --arch-card-min-h. One field cell is now
              as tall as a whole card; the grid has stopped being a field.

   v1 shipped 0.1 … 2.5 on both surfaces. At a 0.1 floor a --t-12 title paints
   at 1.2 device pixels, which is not a small label — it is a smear, and reading
   it is not a skill. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** 25% · 50% · 100% · 200% · 400%. The buttons and the +/- keys land on these
 *  and nowhere between: continuous zoom is the modifier gesture's job, and the
 *  buttons are for landing on a known place. */
export const ZOOM_STOPS: readonly number[] = [0.25, 0.5, 1, 2, 4] as const;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * One stop along the doubling ladder.
 *
 * `EPSILON` is not defensive noise: after a continuous ctrl+wheel zoom the
 * value is 0.9999999 rather than 1, and a naive `>` would step to 2 while the
 * readout still said 100%. The reader would press + once and watch it skip a
 * stop, which is the class of defect that makes a control feel broken without
 * ever being wrong enough to report.
 */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const EPSILON = 1e-6;
  if (direction === 1) {
    return ZOOM_STOPS.find((stop) => stop > zoom + EPSILON) ?? ZOOM_MAX;
  }
  const below = ZOOM_STOPS.filter((stop) => stop < zoom - EPSILON);
  return below.length ? below[below.length - 1] : ZOOM_MIN;
}

/* ── 05.3 THE GESTURE ──────────────────────────────────────────────────────
   THIS IS THE REVERSAL, and it is the whole of item 3.6(c). v1 maps a plain
   wheel straight into zoom with no modifier branch and never pans on scroll —
   so the most common gesture on a trackpad is bound to the most destructive
   camera operation. Miro and Figma both do the opposite, and so does every
   board a Sequence user has touched before this one.

   React Flow's own defaults are `zoomOnScroll: true` / `panOnScroll: false`,
   and both are overridden. A library default is not a design decision. */

export type WheelIntent = 'zoom' | 'pan' | 'pan-x';

/** The three modifier states of a wheel event, and nothing else. */
export function wheelIntent(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): WheelIntent {
  // A trackpad pinch arrives as a wheel event with ctrlKey set, on every
  // platform — so pinch and ctrl+scroll are the same code path by construction
  // rather than by two implementations that agree today.
  if (event.ctrlKey || event.metaKey) return 'zoom';
  if (event.shiftKey) return 'pan-x';
  return 'pan';
}

/**
 * Zoom ABOUT A POINT: the thing under the cursor does not move.
 *
 * Sheet 05.3 requires this for every CONTINUOUS zoom. The stepped zooms use the
 * viewport centre instead, because a button press has no pointer position on
 * the board — `stepAboutCentre` below is that case, and it is the same function
 * with the centre substituted rather than a second implementation.
 */
export function zoomAbout(viewport: Viewport, nextZoom: number, screen: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  // The flow-space point currently under `screen`, then the translation that
  // keeps it there at the new scale.
  const flowX = (screen.x - viewport.x) / viewport.zoom;
  const flowY = (screen.y - viewport.y) / viewport.zoom;
  return { x: screen.x - flowX * zoom, y: screen.y - flowY * zoom, zoom };
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export function stepAboutCentre(viewport: Viewport, frame: Size, direction: 1 | -1): Viewport {
  return zoomAbout(viewport, stepZoom(viewport.zoom, direction), {
    x: frame.width / 2,
    y: frame.height / 2,
  });
}

/** Scroll pans. The camera translates and the zoom is untouched — assertion 3
 *  of sheet 05.9 is exactly this, and it is one line so it cannot be half-done. */
export function pan(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x - dx, y: viewport.y - dy, zoom: viewport.zoom };
}

/* ── 05.5 THE ONE FIT POLICY ───────────────────────────────────────────────
   Fit and zoom-to-selection are the same operation with different bounds, so
   they are ONE function with ONE policy. v1 has two: the Fit BUTTON uses
   padding 0.10 / maxZoom 2.50 while the programmatic fit uses 0.20 / 1.00, so a
   three-node graph auto-fits at 100% and then jumps to 250% when the reader
   presses the control that is supposed to do the same thing.

   THE INSET IS DEVICE PIXELS, NOT A FRACTION OF THE VIEWPORT. v1's padding is a
   fraction, so the gutter grows with the window and a wide display spends most
   of itself on margin. --sp-24 on all four sides, always.

   THE CEILING IS 1.00 AND FIT NEVER MAGNIFIES. Fitting a three-node graph to a
   wide display would paint a --t-12 title at 40px and the board would be lying
   about its own density. Compact is the only density and the camera does not
   get to negotiate it. Only the reader zooms in. */

export const FIT_INSET = 24; // --sp-24, in device pixels
export const FIT_MAX_ZOOM = 1;

/**
 * THE FIT FLOOR, DERIVED — item canvas-fixes 1.
 *
 * §05.5: v1 declares TWO auto-fit floors, 0.45 for the design canvas and 0.6
 * for the board, "each justified in place by the smallest type on its own
 * surface — which is exactly why they should not differ: under 05.8 the type
 * floor is one number for the whole product, so the fit floor is one number
 * derived from it, not two derived from two card designs."
 *
 * SO IT IS DIVIDED, NOT PICKED. --t-10 / --t-12 = 0.8333…, which is §05.8's
 * third ladder row: the zoom at which `.nd-t` is still on the card. There is no
 * new number here and nothing to tune — moving it means moving the type ramp.
 *
 * WHY THE TITLE'S ROW AND NOT A LOWER ONE. Fit is the one control whose entire
 * job is "show me everything", and a board of cards carrying no name has not
 * shown the reader anything: it has shown them how many boxes there are. On
 * this repository the old clamp put Fit at 0.6103 — rung 5, below the icon's
 * 0.67 handoff as well as the title's — so pressing Fit produced ten
 * featureless rectangles. Measured in Chromium against the shipped bundle, not
 * argued: `e2e/board-fit.mjs`, 3 FAILED / 3 passed before this constant existed.
 *
 * WHAT THIS COSTS, STATED RATHER THAN HIDDEN. A graph too big to fit at 0.83 is
 * fitted AT 0.83 and centred, so its far side is off screen — §05.5's "fit
 * clamps to the floor and pans the remainder". That is a real trade against
 * §08.1's "the board never clips the far side of the graph out of the fit", and
 * the resolution is not in the camera: it is that the LAYOUT is shaped by the
 * frame (item canvas-fixes 2), so a real graph arrives at Fit already the shape
 * of the pane it has to fit into. A camera cannot fix a column of eleven.
 *
 * ── AND THAT RESOLUTION DOES NOT HOLD AT EVERY FRAME. MEASURED. ────────────
 *
 * The paragraph above is right that a frame-shaped layout is the answer WHEN
 * ONE EXISTS. At a narrow pane there is none: `CARD_W` is 160 and
 * `FIT_INSET * 2` is 48, so from 208px of pane downwards a single card is
 * already wider than the box it is being fitted into, and no arrangement of
 * eleven of them can be the shape of that pane.
 *
 * In the shipped bundle, with workspace panes taking the board to 158px wide:
 * the layout packed to 158 x 930, Fit landed on this floor at 0.8333, and the
 * result was 133 x 784 inside a 719px-tall pane — 65px of graph clipped away by
 * the control whose entire job is to not do that. There is no scrollbar and no
 * minimap, so nothing on screen said the bottom of the board existed.
 *
 * SO THE FLOOR IS NOW CONDITIONAL, AND THE CONDITION IS THE ONE THAT MATTERS:
 * it holds whenever holding it costs nothing, and yields when the only thing it
 * can buy is a clip. `raw >= FIT_MIN_ZOOM` is exactly "the graph fits at the
 * title rung" — in that case nothing changes, because the clamp never bound
 * there anyway. Below it the floor's ONLY effect was to clip, and between the
 * two sheets §08.1's prohibition is the one the reader can act on: a name they
 * cannot read at this zoom is one gesture away, and a card they do not know
 * exists is not.
 *
 * WHAT DOES NOT CHANGE. The range's own floor still binds — `ZOOM_MIN`, through
 * `clampZoom`, on every path — so this cannot produce the 0.06 a 200-node tree
 * would ask for, and such a graph still overflows. It is not silent when it
 * does: the LOD ladder degrades the cards visibly at these zooms, which is the
 * reader's own evidence that they are looking at the whole shape rather than at
 * the names.
 *
 * The 0.6312 defect this floor was written for is NOT what returns here: that
 * was a stand-in layout stacking eleven cards into one 160px column on a 614px
 * canvas, and the layout is frame-shaped now. On any frame where an arrangement
 * that fits at 0.83 exists, `raw` is at or above 0.83 and this branch is not
 * taken.
 *
 * WHAT WAS HERE BEFORE. `fitViewport`'s doc comment claimed a `FIT_MIN_ZOOM`
 * that "is the range's own floor, deliberately" — and grepping the package for
 * that identifier found it in the comment and NOWHERE ELSE, while the code two
 * lines down clamped to ZOOM_MIN. A comment naming a symbol that does not exist
 * is worse than no comment: it reads as a decision somebody made.
 */
export const FIT_MIN_ZOOM = TITLE_HOLDS_TO;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The camera that shows `bounds` inside `frame`.
 *
 * Returns `null` when there is nothing to fit or no frame to fit it into —
 * never a viewport computed from a zero denominator. A `NaN` translate reaches
 * the DOM as `transform: translate(NaN…)`, which paints nothing and reads to
 * the user as a board that vanished.
 *
 * THE FLOOR IS `FIT_MIN_ZOOM`, AND IT IS A REAL SYMBOL — declared above, with
 * its derivation. A graph larger than what fits at that floor is fitted TO the
 * floor and panned, never shrunk further: past it the cards stop carrying their
 * names and the fit stops being an answer to anything.
 */
export function fitViewport(
  bounds: Bounds | null,
  frame: Size,
  /**
   * A screen-space box the fit must not put content under — in practice the
   * edgeless note, which is `position: absolute; left: 12px; top: 12px` with a
   * `--pane-w` max-width and therefore sits exactly where the first cards land.
   *
   * FINDING F2, measured in the shipped bundle: `svc:acp` and `svc:analyzer` were
   * each 94% covered on load at 1920x1080 and 1440x900, and 26% of `svc:acp` was
   * still covered after pressing Fit. The e2e that should have caught it passed,
   * because it measured only AFTER Fit and only total painted-area share across
   * the whole board — an aggregate can be small while one card is entirely hidden.
   *
   * Reserving is done by SHIFTING, not by shrinking the zoom: the note occupies a
   * corner, not a band, so trimming the usable box by its full width would throw
   * away canvas the content could legitimately use. Content is fitted as before
   * and then pushed clear of the corner, preferring whichever axis costs less.
   */
  reserve: Bounds | null = null,
  /**
   * CHROME BANDS the fit must keep content clear of — the furniture row along
   * the bottom (legend + tools, one or two wrapped lines) and any band along
   * the top. Measured, not assumed: the P1 screenshot audit caught the KINDS
   * pill sitting on a card's title because FIT_INSET (24px) assumed chrome
   * thinner than the furniture actually is. Bands shrink the usable box AND
   * shift the centring, so a fitted graph sits between the bands rather than
   * centred under them. Absent ⇒ byte-identical behaviour.
   */
  bands: { top?: number; bottom?: number } | null = null,
): Viewport | null {
  if (!bounds) return null;
  if (frame.width <= 0 || frame.height <= 0) return null;
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const bandTop = Math.max(0, bands?.top ?? 0);
  const bandBottom = Math.max(0, bands?.bottom ?? 0);
  const usableW = frame.width - FIT_INSET * 2;
  const usableH = frame.height - FIT_INSET * 2 - bandTop - bandBottom;
  if (usableW <= 0 || usableH <= 0) return null;

  const raw = Math.min(usableW / bounds.width, usableH / bounds.height);
  // ONE CLAMP, AND THE FLOOR IS THE CONDITIONAL HALF OF IT — see FIT_MIN_ZOOM.
  // At or above the title rung the floor never bound anything, so it is applied
  // and costs nothing. Below it, applying the floor does exactly one thing:
  // clip. The range's own floor still binds through `clampZoom`, so no path —
  // gesture, button, key or fit — leaves 0.25 … 4.00.
  const zoom =
    raw >= FIT_MIN_ZOOM
      ? Math.min(FIT_MAX_ZOOM, raw)
      : clampZoom(raw);

  const viewport = {
    x: (frame.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y:
      bandTop +
      (frame.height - bandTop - bandBottom - bounds.height * zoom) / 2 -
      bounds.y * zoom,
    zoom,
  };
  if (!reserve || reserve.width <= 0 || reserve.height <= 0) return viewport;

  // Where the content's top-left actually lands, in screen space.
  const left = viewport.x + bounds.x * zoom;
  const top = viewport.y + bounds.y * zoom;
  const reserveRight = reserve.x + reserve.width;
  const reserveBottom = reserve.y + reserve.height;
  if (left >= reserveRight || top >= reserveBottom) return viewport;

  // Overlapping. Move along whichever axis is the shorter push, so the fit stays
  // as close to centred as the obstruction allows.
  const pushDown = reserveBottom - top;
  const pushRight = reserveRight - left;
  return pushDown <= pushRight
    ? { ...viewport, y: viewport.y + pushDown }
    : { ...viewport, x: viewport.x + pushRight };
}

/** The union of a set of boxes, or null. Fit-all and fit-to-selection differ
 *  only in what is handed to this. */
export function unionBounds(boxes: readonly Bounds[]): Bounds | null {
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The readout. Mono, --num, and rounded to a whole percent so it never
 *  jitters in width as it counts — sheet 05.6. */
export function zoomPercent(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}
