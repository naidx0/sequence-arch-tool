import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WB_CARET_GRID, WB_GLYPHS, WB_GRID, WB_STROKE, WbIcon, glyphInk, type WbGlyph } from './wbIcons';

/* The set is derived from the data: a glyph added later is checked without anyone listing it here. */
const NAMES = Object.keys(WB_GLYPHS) as WbGlyph[];
const gridOf = (name: WbGlyph) => (name === 'caret' ? WB_CARET_GRID : WB_GRID);
const isHalf = (n: number) => Math.abs(n - Math.floor(n) - 0.5) < 1e-9;
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

describe('the pill glyphs sit on their button centre', () => {
  it('has the glyphs the pill draws', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(16);
    for (const n of ['select', 'draw', 'rect', 'ellipse', 'line', 'arrow', 'text', 'sticky', 'link', 'erase', 'undo', 'fit', 'reset', 'trash', 'more', 'caret']) {
      expect(NAMES, n).toContain(n);
    }
  });

  it.each(NAMES)('%s: the ink box is centred on the grid to within half a pixel, and inside it', (name) => {
    const { x0, y0, x1, y1 } = glyphInk(name);
    const mid = gridOf(name) / 2;
    expect(Math.abs((x0 + x1) / 2 - mid), `${name} horizontal`).toBeLessThanOrEqual(0.5);
    expect(Math.abs((y0 + y1) / 2 - mid), `${name} vertical`).toBeLessThanOrEqual(0.5);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(gridOf(name));
    expect(y1).toBeLessThanOrEqual(gridOf(name));
  });

  it('the centring check can fail: a glyph pushed off-centre is caught', () => {
    const real = WB_GLYPHS.rect;
    (WB_GLYPHS as Record<string, unknown>).rect = [{ r: [6.5, 3.5, 9, 9, 1] }];
    try {
      const { x0, x1 } = glyphInk('rect');
      expect(Math.abs((x0 + x1) / 2 - 8)).toBeGreaterThan(0.5);
    } finally {
      (WB_GLYPHS as Record<string, unknown>).rect = real;
    }
  });
});

describe('the pill glyphs are pixel-aligned', () => {
  it.each(NAMES)('%s: the ink box has whole-pixel edges, so no outer edge is soft', (name) => {
    const { x0, y0, x1, y1 } = glyphInk(name);
    for (const edge of [x0, y0, x1, y1]) expect(isWhole(edge), `${name}: ${edge}`).toBe(true);
  });

  it.each(NAMES)('%s: every straight horizontal or vertical edge is on a pixel centre; every fill is on whole pixels', (name) => {
    for (const prim of WB_GLYPHS[name]) {
      if ('l' in prim || 'g' in prim) {
        const pts = 'l' in prim ? prim.l : prim.g;
        const closed = 'g' in prim;
        const n = pts.length / 2;
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const [ax, ay] = [pts[2 * i]!, pts[2 * i + 1]!];
          const j = (i + 1) % n;
          const [bx, by] = [pts[2 * j]!, pts[2 * j + 1]!];
          if (ax === bx) expect(isHalf(ax), `${name}: vertical edge at x=${ax}`).toBe(true);
          if (ay === by) expect(isHalf(ay), `${name}: horizontal edge at y=${ay}`).toBe(true);
        }
      } else if ('r' in prim) {
        for (const v of prim.r.slice(0, 2)) expect(isHalf(v), `${name} rect origin`).toBe(true);
        for (const v of prim.r.slice(2, 4)) expect(isWhole(v), `${name} rect size`).toBe(true);
      } else if ('e' in prim) {
        const [cx, cy, rx, ry] = prim.e;
        expect(isHalf(cx - rx) && isHalf(cx + rx) && isHalf(cy - ry) && isHalf(cy + ry), `${name} ellipse extents`).toBe(true);
      } else {
        for (const v of prim.f.slice(0, 4)) expect(isWhole(v), `${name} fill`).toBe(true);
      }
    }
  });

  it('draws every glyph at its own grid size, in one weight, with no scaling', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<WbIcon name={name} />);
      const svg = container.querySelector('svg')!;
      const g = gridOf(name);
      expect(svg.getAttribute('width'), name).toBe(String(g));
      expect(svg.getAttribute('height'), name).toBe(String(g));
      expect(svg.getAttribute('viewBox'), name).toBe(`0 0 ${g} ${g}`);
      expect(svg.getAttribute('stroke-width'), name).toBe(String(WB_STROKE));
      expect(svg.classList.contains('wb-ic')).toBe(true);
      unmount();
    }
    expect(WB_STROKE).toBe(1);
  });

  it('every glyph draws something', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<WbIcon name={name} />);
      expect(container.querySelectorAll('svg > *').length, name).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('one glyph per job', () => {
  it('no two glyphs are drawn the same', () => {
    const seen = new Map<string, WbGlyph>();
    for (const name of NAMES) {
      const key = JSON.stringify(WB_GLYPHS[name]);
      expect(seen.get(key), `${name} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    }
  });
});
