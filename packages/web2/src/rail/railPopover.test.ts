import { describe, expect, it } from 'vitest';

import { POP_GAP, POP_INSET, placePopover, type PopRect } from './railPopover';

const VP = { w: 1440, h: 900 };
const rect = (left: number, top: number, w = 232, h = 30): PopRect => ({ left, top, right: left + w, bottom: top + h });

describe('placePopover, beside the anchor (a component flyout, a rail hover card)', () => {
  it('sits to the right of the anchor, top aligned, when there is room', () => {
    const p = placePopover({ anchor: rect(0, 100), size: { w: 340, h: 200 }, viewport: VP, prefer: 'right' });
    expect(p).toEqual({ left: 232 + POP_GAP, top: 100, side: 'right', maxHeight: null });
  });

  it('flips to the anchor\'s left when the right edge of the window has no room', () => {
    const p = placePopover({ anchor: rect(1200, 100), size: { w: 340, h: 200 }, viewport: VP, prefer: 'right' });
    expect(p.side).toBe('left');
    expect(p.left).toBe(1200 - POP_GAP - 340);
  });

  it('with room on neither side it is clamped inside the window, on the roomier side', () => {
    const p = placePopover({ anchor: rect(100, 100, 100), size: { w: 340, h: 200 }, viewport: { w: 300, h: 900 }, prefer: 'right' });
    expect(p.left).toBeGreaterThanOrEqual(POP_INSET);
    const wide = placePopover({ anchor: rect(0, 0, 1400), size: { w: 340, h: 200 }, viewport: VP, prefer: 'right' });
    expect(wide.left + 340).toBeLessThanOrEqual(VP.w - POP_INSET);
    expect(wide.left).toBeGreaterThanOrEqual(POP_INSET);
  });

  it('is pulled up when the anchor is near the bottom, and down when it is above the top', () => {
    expect(placePopover({ anchor: rect(0, 860), size: { w: 340, h: 300 }, viewport: VP, prefer: 'right' }).top).toBe(VP.h - POP_INSET - 300);
    expect(placePopover({ anchor: rect(0, -20), size: { w: 340, h: 300 }, viewport: VP, prefer: 'right' }).top).toBe(POP_INSET);
  });

  it('a card taller than the window is capped to it, and its body scrolls', () => {
    const p = placePopover({ anchor: rect(0, 400), size: { w: 340, h: 1200 }, viewport: VP, prefer: 'right' });
    expect(p.top).toBe(POP_INSET);
    expect(p.maxHeight).toBe(VP.h - 2 * POP_INSET);
  });
});

describe('placePopover, under the anchor (the shelf\'s hover card)', () => {
  it('sits under the anchor, left aligned, and is pulled in from the window\'s right edge', () => {
    const p = placePopover({ anchor: rect(1400, 100, 40), size: { w: 288, h: 200 }, viewport: VP, prefer: 'below' });
    expect(p).toEqual({ left: VP.w - POP_INSET - 288, top: 130 + POP_GAP, side: 'below', maxHeight: null });
  });

  it('flips above the anchor when there is no room below', () => {
    const p = placePopover({ anchor: rect(40, 800), size: { w: 288, h: 200 }, viewport: VP, prefer: 'below' });
    expect(p.side).toBe('above');
    expect(p.top).toBe(800 - POP_GAP - 200);
  });

  it('with room on neither side it takes the roomier one and is capped to it', () => {
    const p = placePopover({ anchor: rect(40, 140), size: { w: 288, h: 400 }, viewport: { w: 1440, h: 300 }, prefer: 'below' });
    expect(p.side).toBe('above');
    expect(p.top).toBe(POP_INSET);
    expect(p.maxHeight).toBe(140 - POP_GAP - POP_INSET);
  });
});

describe('placePopover never leaves the window', () => {
  it('over a grid of anchors and sizes, a popover that can fit is inside the inset on every edge', () => {
    for (const prefer of ['right', 'below'] as const) {
      for (const vp of [VP, { w: 1280, h: 800 }, { w: 800, h: 600 }]) {
        for (let x = -50; x <= vp.w + 50; x += 130) {
          for (let y = -50; y <= vp.h + 50; y += 110) {
            for (const size of [{ w: 288, h: 180 }, { w: 340, h: 420 }]) {
              const p = placePopover({ anchor: rect(x, y), size, viewport: vp, prefer });
              const h = p.maxHeight === null ? size.h : Math.min(size.h, p.maxHeight);
              const ctx = JSON.stringify({ prefer, vp, x, y, size, p });
              expect(p.left, ctx).toBeGreaterThanOrEqual(POP_INSET);
              expect(p.left + size.w, ctx).toBeLessThanOrEqual(vp.w - POP_INSET);
              expect(p.top, ctx).toBeGreaterThanOrEqual(POP_INSET);
              expect(p.top + h, ctx).toBeLessThanOrEqual(vp.h - POP_INSET);
            }
          }
        }
      }
    }
  });
});
