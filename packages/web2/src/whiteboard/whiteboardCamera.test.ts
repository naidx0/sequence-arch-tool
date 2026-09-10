import { describe, expect, it } from 'vitest';

import { ZOOM_MAX, ZOOM_MIN } from '../canvas/camera';
import { EMPTY_VIEW, WB_FIT_INSET, boardPoint, fitTo, screenPoint, wbCamera } from './whiteboardCamera';
import { EMPTY_WHITEBOARD, whiteboardBounds, whiteboardEdit } from './whiteboardModel';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A CAMERA FOR THE WHITEBOARD
 *
 * The owner's bar for this surface is MIRO — "a Miro board where you can
 * literally just draw from scratch". Until now it was a fixed-viewport SVG:
 * no pan, no zoom, single selection. A board you cannot navigate is not
 * infinite, it is a sheet of paper the size of your window.
 *
 * ── IT REUSES `canvas/camera.ts` RATHER THAN INVENTING A SECOND ONE ──────
 *
 * `clampZoom`, `zoomAbout`, `pan` and the stops are already written, argued
 * and tested for the architecture board. A second camera would be a second set
 * of zoom limits and a second answer to "what does the wheel do", and the two
 * would drift the first time either was touched. What is NOT shared is the
 * ACTION vocabulary: the whiteboard holds its own document and its own view,
 * so it dispatches nothing into the architecture board's slice.
 * ══════════════════════════════════════════════════════════════════════════
 */

describe('the view', () => {
  it('starts at the origin, unzoomed', () => {
    expect(EMPTY_VIEW).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('pans by a screen delta', () => {
    expect(wbCamera(EMPTY_VIEW, { kind: 'pan', dx: 40, dy: -25 })).toEqual({
      x: 40,
      y: -25,
      zoom: 1,
    });
  });

  it('ZOOMS ABOUT THE POINTER, so the thing under the cursor stays there', () => {
    /*
     * The whole difference between a zoom that feels like a tool and one that
     * feels like a lurch. Asserted as the property rather than as coordinates:
     * whatever board point sat under the pointer must still sit under it.
     */
    const at = { x: 300, y: 200 };
    const before = boardPoint(EMPTY_VIEW, at);
    const after = boardPoint(wbCamera(EMPTY_VIEW, { kind: 'zoom', to: 2, at }), at);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps to the same stops the architecture board uses', () => {
    /* One product, one answer to how far you can zoom. */
    expect(wbCamera(EMPTY_VIEW, { kind: 'zoom', to: 99, at: { x: 0, y: 0 } }).zoom).toBe(ZOOM_MAX);
    expect(wbCamera(EMPTY_VIEW, { kind: 'zoom', to: 0.001, at: { x: 0, y: 0 } }).zoom).toBe(ZOOM_MIN);
  });

  it('a no-op returns the SAME view, so nothing re-renders on a stray event', () => {
    const view = { x: 10, y: 10, zoom: 1 };
    expect(wbCamera(view, { kind: 'pan', dx: 0, dy: 0 })).toBe(view);
  });

  it('reset goes home', () => {
    expect(wbCamera({ x: 90, y: 90, zoom: 3 }, { kind: 'reset' })).toEqual(EMPTY_VIEW);
  });
});

describe('screen and board are different coordinate systems', () => {
  it('at rest they agree', () => {
    expect(boardPoint(EMPTY_VIEW, { x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });

  it('A STROKE LANDS WHERE THE PEN IS, panned and zoomed', () => {
    /*
     * THE DEFECT A CAMERA INTRODUCES IF THIS IS WRONG, and it is silent: the
     * surface keeps taking `event.clientX` as a board coordinate, so every mark
     * made while zoomed is stored somewhere the reader did not draw it. It
     * looks right until you reset the view.
     */
    const view = { x: 100, y: 50, zoom: 2 };
    expect(boardPoint(view, { x: 300, y: 150 })).toEqual({ x: 100, y: 50 });
  });
});

describe('fit', () => {
  it('frames what is drawn', () => {
    let doc = EMPTY_WHITEBOARD;
    doc = whiteboardEdit(doc, {
      type: 'wb/add',
      item: { kind: 'shape', id: 'r', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 200, y: 100 } },
    });
    const view = fitTo(doc, { width: 800, height: 600 });
    expect(view).not.toBeNull();

    /*
     * ASSERTED AS THE PROPERTY, and the first cut of this got it backwards -
     * it required `zoom <= 1`, as if Fit could only ever zoom OUT. A small
     * drawing in a large frame must zoom IN: CANON K3 says the board must FILL
     * the usable viewport and calls a postage stamp in a void a failure.
     *
     * What actually has to hold is that everything drawn lands inside the
     * frame, whichever direction the zoom went.
     */
    const a = screenPoint(view!, { x: 0, y: 0 });
    const b = screenPoint(view!, { x: 200, y: 100 });
    for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });

  it('AN EMPTY BOARD HAS NOTHING TO FRAME, and says so rather than guessing', () => {
    /* `whiteboardBounds` answers null on an empty document — the same honesty
       the architecture board's Fit follows. Zooming to a rectangle nobody drew
       would put the reader somewhere arbitrary. */
    expect(fitTo(EMPTY_WHITEBOARD, { width: 800, height: 600 })).toBeNull();
  });

  it('a zero-size drawing does not divide by zero', () => {
    /* One dot on the board has width 0. A naive fit produces Infinity, which
       becomes NaN in a transform and paints nothing at all. */
    const doc = whiteboardEdit(EMPTY_WHITEBOARD, {
      type: 'wb/add',
      item: { kind: 'text', id: 't', at: { x: 50, y: 50 }, text: 'Note' },
    });
    const view = fitTo(doc, { width: 800, height: 600 });
    expect(view).not.toBeNull();
    expect(Number.isFinite(view!.zoom)).toBe(true);
    expect(Number.isFinite(view!.x)).toBe(true);
  });

  it('FRAMES THE WORDS in a long note, not only its anchor point', () => {
    const doc = whiteboardEdit(EMPTY_WHITEBOARD, {
      type: 'wb/add',
      item: {
        kind: 'text',
        id: 'long-note',
        at: { x: 50, y: 50 },
        text: 'This note is deliberately long enough that fitting only its anchor loses the words',
      },
    });
    const bounds = whiteboardBounds(doc)!;
    const view = fitTo(doc, { width: 400, height: 200 })!;

    expect(bounds.width).toBeGreaterThan(1);
    const topLeft = screenPoint(view, { x: bounds.x, y: bounds.y });
    const bottomRight = screenPoint(view, {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(400);
    expect(bottomRight.y).toBeLessThanOrEqual(200);
    expect(bottomRight.x - topLeft.x).toBeCloseTo(400 - WB_FIT_INSET * 2);
  });
});
