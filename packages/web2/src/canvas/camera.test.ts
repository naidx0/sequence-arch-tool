import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';

import { substituteVars } from '../../test/support/css';
import { LOD_LADDER, visibilityAt } from './lod';
import {
  FIT_INSET,
  FIT_MAX_ZOOM,
  FIT_MIN_ZOOM,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STOPS,
  clampZoom,
  fitViewport,
  pan,
  stepAboutCentre,
  stepZoom,
  unionBounds,
  wheelIntent,
  zoomAbout,
  zoomPercent,
} from './camera';

/**
 * ITEM 3.6 — THE CAMERA.
 *
 * Sheet 05.9 lists nine assertions and says why they are worth writing down:
 * "a board that is not a board fails these silently and looks fine in a
 * screenshot." Five of the nine are pure arithmetic and are locked here; the
 * other four are gestures and computed styles and are locked in the browser.
 */
describe('item 3.6 — the range', () => {
  it('is a quarter to four, and the two ends are reciprocal', () => {
    expect(ZOOM_MIN).toBe(0.25);
    expect(ZOOM_MAX).toBe(4);
    // Sheet 05.4: the readout is symmetric about 1:1 — two doublings out, two
    // doublings in. v1 ships 0.1 … 2.5, where a --t-12 title paints at 1.2
    // device pixels at the floor.
    expect(ZOOM_MIN * ZOOM_MAX).toBe(1);
    expect([...ZOOM_STOPS]).toEqual([0.25, 0.5, 1, 2, 4]);
  });

  it('clamps on every path', () => {
    // Assertion 5. There is one clamp because there is one function; a second
    // path is a second place the range can be wrong.
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(zoomAbout({ x: 0, y: 0, zoom: 1 }, 99, { x: 0, y: 0 }).zoom).toBe(ZOOM_MAX);
    expect(stepAboutCentre({ x: 0, y: 0, zoom: 4 }, { width: 800, height: 600 }, 1).zoom).toBe(
      ZOOM_MAX,
    );
  });

  it('steps the doubling ladder and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it('does not skip a stop after a continuous zoom lands just off one', () => {
    // The defect the EPSILON exists for: after a ctrl+wheel zoom the value is
    // 0.9999999 and the readout says 100%, so a naive `>` steps to 200% and the
    // reader watches the control skip a stop.
    expect(stepZoom(0.9999999, 1)).toBe(2);
    expect(stepZoom(1.0000001, -1)).toBe(0.5);
  });
});

describe('item 3.6 — the gesture', () => {
  it('pans on a plain wheel and zooms only with the modifier', () => {
    // THE REVERSAL. v1 maps a plain wheel straight into zoom with no modifier
    // branch, so the most common trackpad gesture is bound to the most
    // destructive camera operation.
    expect(wheelIntent({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('pan');
    expect(wheelIntent({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('zoom');
    expect(wheelIntent({ ctrlKey: false, metaKey: true, shiftKey: false })).toBe('zoom');
    expect(wheelIntent({ ctrlKey: false, metaKey: false, shiftKey: true })).toBe('pan-x');
    // The modifier wins over shift: a pinch arrives as ctrl+wheel on every
    // platform, and a reader holding shift mid-pinch still means zoom.
    expect(wheelIntent({ ctrlKey: true, metaKey: false, shiftKey: true })).toBe('zoom');
  });

  it('pans without touching the zoom', () => {
    // Assertion 3, stated as arithmetic: a pan changes the offset and NOTHING
    // else.
    const before = { x: 10, y: 20, zoom: 1.5 };
    const after = pan(before, 30, -12);
    expect(after.zoom).toBe(before.zoom);
    expect(after).toEqual({ x: -20, y: 32, zoom: 1.5 });
  });

  it('holds the point under the pointer fixed while zooming', () => {
    // Assertion 4, and the one thing that makes a continuous zoom feel like a
    // camera rather than a slider.
    const before = { x: 137, y: -42, zoom: 0.8 };
    const pointer = { x: 320, y: 210 };

    const flowBefore = {
      x: (pointer.x - before.x) / before.zoom,
      y: (pointer.y - before.y) / before.zoom,
    };

    const after = zoomAbout(before, 2.4, pointer);
    const flowAfter = {
      x: (pointer.x - after.x) / after.zoom,
      y: (pointer.y - after.y) / after.zoom,
    };

    expect(flowAfter.x).toBeCloseTo(flowBefore.x, 9);
    expect(flowAfter.y).toBeCloseTo(flowBefore.y, 9);
  });
});

describe('item 3.6 — the one fit policy', () => {
  const frame = { width: 800, height: 600 };

  /** The rung a zoom is on, read off `LOD_LADDER` itself rather than through
   *  `rungFor`, so this file asks the ladder the same question the card does
   *  without importing a second answer to it. */
  const rungOf = (zoom: number) =>
    (LOD_LADDER.find((step) => zoom >= step.floor) ?? LOD_LADDER[LOD_LADDER.length - 1]!).rung;

  it('never magnifies', () => {
    // Sheet 05.5: fitting a three-node graph to a wide display would paint a
    // --t-12 title at 40px and the board would lie about its own density.
    // Compact is the only density and the camera does not negotiate it.
    const tiny = { x: 0, y: 0, width: 40, height: 30 };
    expect(fitViewport(tiny, frame)!.zoom).toBe(FIT_MAX_ZOOM);
  });

  /* ── ITEM canvas-fixes 1 — THE FIT FLOOR ───────────────────────────────
     WHAT THIS REPLACES. The line under this one used to read `toBe(ZOOM_MIN)`,
     and it was green while Fit on this repository landed at 0.6103 — rung 5,
     where a card carries no title, no kind tag and no icon. The assertion was
     not weakened to make the fix pass; it was RAISED, from 0.25 to 0.83, and
     the three tests below are what make the new number checkable rather than
     picked. */

  it('holds the FIT floor for every graph that fits at it', () => {
    // The floor's whole job, and the half of it that is unconditional: any
    // graph that CAN be shown whole at the title rung is shown there, never
    // smaller, so Fit does not shrink a board it had no need to shrink.
    let asserted = 0; // a guarded loop that never fires asserts nothing — prove it fired
    for (let side = 60; side <= 700; side += 13) {
      const zoom = fitViewport({ x: 0, y: 0, width: side, height: side }, frame)!.zoom;
      if (Math.min((800 - 48) / side, (600 - 48) / side) >= FIT_MIN_ZOOM) {
        asserted += 1;
        expect(zoom, `a graph of ${side}px was shrunk below the title rung`).toBeGreaterThanOrEqual(
          FIT_MIN_ZOOM,
        );
      }
    }
    expect(asserted, 'the guard never fired — this loop asserted nothing').toBeGreaterThan(0);
    // Strictly above the camera's own floor, which is what §05.5 says it must
    // be: the fit floor is derived from the TYPE floor, and the camera's range
    // is derived from the field pitch.
    expect(FIT_MIN_ZOOM).toBeGreaterThan(ZOOM_MIN);
  });

  /* ── §08.1's PROHIBITION, MEASURED WHERE IT WAS BROKEN ──────────────────

     "What the board never does": clip the far side of the graph out of the fit.

     THE SHAPE IS THE REPORTED ONE, not a convenient one. Driven in the shipped
     bundle on this monorepo: opening three workspace panes takes the board pane
     to 158 x 719, the layout packs to 158 x 930, and Fit clamped to the floor
     at 0.8333 — 133 x 784 inside a 719px pane, 65px of graph cut off with no
     scrollbar, no minimap and no note. There is no arrangement that fixes it
     either: `CARD_W` is 160 and the fit insets 48, so below a 208px pane one
     card alone is wider than the box it is fitted into.

     BEFORE THE CHANGE THIS TEST FAILS on the first expectation (0.8333, and
     784 > 719). */
  it('does not clip the graph rather than descend below the title rung', () => {
    const pane = { width: 158, height: 719 };
    const packed = { x: 0, y: 0, width: 158, height: 930 };

    const fitted = fitViewport(packed, pane)!;
    expect(fitted.zoom).toBeLessThan(FIT_MIN_ZOOM);

    const top = fitted.y + packed.y * fitted.zoom;
    const bottom = top + packed.height * fitted.zoom;
    const left = fitted.x + packed.x * fitted.zoom;
    const right = left + packed.width * fitted.zoom;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(pane.height);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(pane.width);
  });

  it('still stops at the camera range floor, and says nothing louder than that', () => {
    /* Descending below the title rung is not descending without limit. A graph
       this size does not fit at ZOOM_MIN either, and the fit does not pretend
       otherwise — it lands on the range's own floor, which is the same number
       every other path is clamped to. */
    const enormous = { x: 0, y: 0, width: 100000, height: 80000 };
    expect(fitViewport(enormous, frame)!.zoom).toBe(ZOOM_MIN);
  });

  it('derives the fit floor from the LIVE type ramp, not from a literal', () => {
    // The same rule lod.test.ts holds the ladder to, applied to the one row
    // Fit is bound by: --t-10 / --t-12. Read out of the real cascade so a
    // change to tokens/graphite.css moves this test, not just this module.
    const read = (name: string) => {
      const raw = substituteVars(`var(${name})`, document.documentElement);
      const value = Number.parseFloat(raw);
      expect(Number.isFinite(value), `${name} did not resolve: "${raw}"`).toBe(true);
      return value;
    };
    expect(FIT_MIN_ZOOM).toBeCloseTo(read('--t-10') / read('--t-12'), 10);
  });

  it('never lands below the TITLE rung for a graph that fits at it', () => {
    /*
     * THE INVARIANT, NOT THE EXPRESSION. Asserted against `lod.ts`'s own ladder
     * rather than against 0.8333, so the two modules cannot drift into two
     * ladders: FIT_MIN_ZOOM must be at or above the LOWEST rung floor whose
     * visibility still includes the title, and below that rung's own floor
     * `visibilityAt` must have dropped it.
     *
     * Swept, not sampled, because it is a claim about every graph — but only
     * over the graphs the claim is ABOUT. The sweep used to run to 40,000px a
     * side and pass, which meant it was also asserting that a graph twenty
     * times too big for the pane keeps its titles — i.e. that Fit clips. That
     * half of it was locking the defect, and it is the half that has gone; the
     * clip case is asserted directly, three tests up, as a clip.
     */
    const titleRungs = LOD_LADDER.filter((step) => visibilityAt(step.rung).title);
    const lowestWithTitle = Math.min(...titleRungs.map((step) => step.floor));
    expect(titleRungs.length).toBeGreaterThan(0);
    expect(FIT_MIN_ZOOM).toBeGreaterThanOrEqual(lowestWithTitle);

    let asserted = 0; // a continue-guarded sweep that never runs asserts nothing
    for (let side = 100; side <= 900; side += 37) {
      const bounds = { x: 0, y: 0, width: side, height: side };
      if (Math.min((800 - 48) / side, (600 - 48) / side) < FIT_MIN_ZOOM) continue;
      const zoom = fitViewport(bounds, frame)!.zoom;
      expect(visibilityAt(rungOf(zoom)).title, `fit at ${zoom} drops the title`).toBe(true);
      asserted += 1;
    }
    expect(asserted, 'the sweep skipped every graph — it asserted nothing').toBeGreaterThan(0);
  });

  it('insets by --sp-24 in DEVICE PIXELS, so the gutter does not grow with the window', () => {
    // v1's padding is a FRACTION of the viewport, so a wide display spends most
    // of itself on margin. The test is that the same bounds fit at the same
    // zoom in a frame twice as wide only because it is twice as wide — the
    // inset contributes the same 24px at both sizes.
    expect(FIT_INSET).toBe(24);

    const bounds = { x: 0, y: 0, width: 752, height: 552 };
    // 800 - 48 = 752 and 600 - 48 = 552: exactly one at both axes.
    expect(fitViewport(bounds, frame)!.zoom).toBeCloseTo(1, 9);
  });

  it('centres the bounds it was given', () => {
    const bounds = { x: 100, y: 50, width: 200, height: 100 };
    const viewport = fitViewport(bounds, frame)!;
    const centreX = bounds.x * viewport.zoom + viewport.x + (bounds.width * viewport.zoom) / 2;
    const centreY = bounds.y * viewport.zoom + viewport.y + (bounds.height * viewport.zoom) / 2;
    expect(centreX).toBeCloseTo(frame.width / 2, 9);
    expect(centreY).toBeCloseTo(frame.height / 2, 9);
  });

  it('refuses rather than returning a viewport computed from a zero denominator', () => {
    // A NaN translate reaches the DOM as `transform: translate(NaN…)`, paints
    // nothing, and reads to the user as a board that vanished.
    expect(fitViewport(null, frame)).toBeNull();
    expect(fitViewport({ x: 0, y: 0, width: 0, height: 0 }, frame)).toBeNull();
    expect(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 })).toBeNull();
    expect(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: 20, height: 20 })).toBeNull();
  });

  it('is ONE function, so fit-all and fit-to-selection cannot diverge', () => {
    // v1's Fit BUTTON uses padding 0.10 / maxZoom 2.50 while the programmatic
    // fit uses 0.20 / 1.00, so a three-node graph auto-fits at 100% and re-fits
    // at 250% when the reader presses Fit. Here the two differ only in the
    // BOUNDS handed to one function, and the same bounds give the same answer.
    const boxes = [
      { x: 0, y: 0, width: 160, height: 96 },
      { x: 400, y: 300, width: 160, height: 96 },
    ];
    const all = unionBounds(boxes)!;
    const selection = unionBounds([boxes[0]!])!;

    expect(fitViewport(all, frame)).toEqual(fitViewport(unionBounds(boxes)!, frame));
    expect(fitViewport(selection, frame)!.zoom).toBeLessThanOrEqual(FIT_MAX_ZOOM);
    expect(all).toEqual({ x: 0, y: 0, width: 560, height: 396 });
  });

  it('reads out a whole percent, so the number never jitters in width', () => {
    expect(zoomPercent(1)).toBe('100%');
    expect(zoomPercent(0.25)).toBe('25%');
    expect(zoomPercent(4)).toBe('400%');
    expect(zoomPercent(0.8333333)).toBe('83%');
    expect(zoomPercent(99)).toBe('400%');
  });
});

/**
 * THE NOTE IS NOT A LID — finding F2 from the Waves 4/5 gate.
 *
 * `.boardnote` is `position: absolute; left: 12px; top: 12px` with a `--pane-w`
 * (392px) max-width, and `fitViewport` centred content in the WHOLE frame as
 * though it were not there. Measured in the shipped bundle against this repo:
 * `svc:acp` and `svc:analyzer` were each **94% covered** at 1920x1080 and
 * 1440x900, and 26% of `svc:acp` was STILL covered after pressing Fit.
 *
 * The e2e that was supposed to catch it — "the note is a NOTE and not a lid" —
 * passed, because it measured only AFTER Fit and only total painted-area share
 * across the board (<25%), never per-card overlap, and never on load. An
 * aggregate can be small while one card is entirely hidden.
 *
 * So `fitViewport` takes the region the note occupies and fits into what is
 * LEFT, rather than into the frame. Asserted as geometry here; the browser-level
 * per-card assertion belongs in the e2e.
 */
describe('fit reserves the note-s box', () => {
  const frame = { width: 1000, height: 800 };
  // GEOMETRY THAT ACTUALLY OCCLUDES. A first draft used a 200x200 bounds and
  // passed trivially — in a 1000x800 frame, centring a small box already clears a
  // top-left note, so the test asserted nothing. That is the bad-fixture mistake,
  // and it is worth the four lines to record it.
  //
  // Content that nearly fills the frame is the real case: fitted at zoom 0.94 this
  // lands at left 312, top 24 — inside the note's 404x76 corner, which is exactly
  // what the gate measured in the shipped bundle.
  const bounds = { x: 0, y: 0, width: 400, height: 800 };
  // The note as it really renders: top-left, 392 wide, ~64 tall with padding.
  const note = { x: 12, y: 12, width: 392, height: 64 };

  it('pushes content clear of the reserved region', () => {
    const withNote = fitViewport(bounds, frame, note);
    expect(withNote, 'a viewport is still returned').not.toBeNull();
    const v = withNote!;
    // The top edge of the fitted content, in screen space.
    const contentTop = v.y + bounds.y * v.zoom;
    const contentLeft = v.x + bounds.x * v.zoom;
    const clearsBelow = contentTop >= note.y + note.height;
    const clearsRight = contentLeft >= note.x + note.width;
    expect(
      clearsBelow || clearsRight,
      `content must not start underneath the note. top=${contentTop} left=${contentLeft} ` +
        `note bottom=${note.y + note.height} right=${note.x + note.width}`,
    ).toBe(true);
  });

  it('is unchanged when nothing is reserved', () => {
    expect(fitViewport(bounds, frame, null)).toEqual(fitViewport(bounds, frame));
  });
});

describe('fitViewport bands — content clears the chrome (P1 audit)', () => {
  it('a bottom band shrinks the usable box and lifts the centring', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 };
    const frame = { width: 500, height: 500 };
    const plain = fitViewport(bounds, frame)!;
    const banded = fitViewport(bounds, frame, null, { bottom: 100 })!;
    // Less vertical room → the fit can only shrink or hold, never grow.
    expect(banded.zoom).toBeLessThanOrEqual(plain.zoom);
    // The fitted content's bottom edge stays clear of the band.
    const contentBottom = banded.y + bounds.height * banded.zoom;
    expect(contentBottom).toBeLessThanOrEqual(frame.height - 100);
  });

  it('a top band pushes content below it', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 };
    const frame = { width: 500, height: 500 };
    const banded = fitViewport(bounds, frame, null, { top: 80 })!;
    expect(banded.y).toBeGreaterThanOrEqual(80);
  });

  it('absent bands ⇒ byte-identical to the pre-bands fit', () => {
    const bounds = { x: 10, y: 20, width: 300, height: 200 };
    const frame = { width: 640, height: 480 };
    expect(fitViewport(bounds, frame, null, null)).toEqual(fitViewport(bounds, frame));
  });

  it('bands that eat the whole frame return null, never NaN', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const frame = { width: 500, height: 200 };
    expect(fitViewport(bounds, frame, null, { top: 100, bottom: 100 })).toBeNull();
  });
});
