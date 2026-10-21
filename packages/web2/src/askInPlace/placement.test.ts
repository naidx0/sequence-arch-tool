import { describe, expect, it } from 'vitest';

import { placePopover, relativeTo } from './placement';

const SIZE = { width: 340, height: 120 };

describe('the popover sits beside what it is about, inside the board', () => {
  it('prefers the right of the target', () => {
    const p = placePopover({ left: 100, top: 200, width: 80, height: 40 }, SIZE, { width: 1200, height: 800 });
    expect(p.side).toBe('right');
    expect(p.left).toBe(100 + 80 + 12);
    expect(p.top).toBe(200 + 20 - 60);
  });

  it('falls to the left when the right does not fit', () => {
    const p = placePopover({ left: 800, top: 200, width: 80, height: 40 }, SIZE, { width: 1000, height: 800 });
    expect(p.side).toBe('left');
    expect(p.left).toBe(800 - 12 - 340);
  });

  it('goes below, then above, in a board as narrow as three surfaces make it', () => {
    const bounds = { width: 306, height: 700 };
    const below = placePopover({ left: 100, top: 100, width: 80, height: 40 }, { width: 290, height: 120 }, bounds);
    expect(below.side).toBe('below');
    expect(below.top).toBe(100 + 40 + 12);
    const above = placePopover({ left: 100, top: 560, width: 80, height: 40 }, { width: 290, height: 120 }, bounds);
    expect(above.side).toBe('above');
    expect(above.top).toBe(560 - 12 - 120);
  });

  it('never leaves the board on any side, whatever the target does', () => {
    const bounds = { width: 306, height: 300 };
    for (const left of [-50, 0, 120, 280, 400]) {
      for (const top of [-50, 0, 140, 290, 400]) {
        const p = placePopover({ left, top, width: 90, height: 60 }, { width: 290, height: 120 }, bounds);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.top).toBeGreaterThanOrEqual(8);
        expect(p.left + 290).toBeLessThanOrEqual(306 - 8 + 0.0001);
        expect(p.top + 120).toBeLessThanOrEqual(300 - 8 + 0.0001);
      }
    }
  });

  it('is clamped when nothing fits (it may cover the target, never be cut off)', () => {
    const p = placePopover({ left: 20, top: 20, width: 260, height: 160 }, { width: 290, height: 200 }, { width: 306, height: 240 });
    expect(p.side).toBe('clamped');
  });

  it('converts viewport rects to container coordinates', () => {
    expect(relativeTo({ left: 150, top: 90, width: 10, height: 20 }, { left: 100, top: 40 })).toEqual({
      left: 50,
      top: 50,
      width: 10,
      height: 20,
    });
  });
});
