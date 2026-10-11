/* ══════════════════════════════════════════════════════════════════════════
   THE WHITEBOARD PILL'S ICONS, DRAWN ON THE PIXEL GRID
   packages/web2/src/whiteboard/wbIcons.tsx

   The pill used the book's 24-grid glyphs at 14px. A 24-unit drawing scaled to
   14px puts every coordinate at a fraction of a device pixel, so a straight
   edge lands across two pixel rows and reads soft. The owner, 2026-10-09: "make
   sure all the icons are HD, centered, and relevant."

   These are drawn AT 16px, on a 16-unit grid, 1 unit = 1 device pixel:

     · a 1px stroke centred on n + 0.5 covers exactly one pixel row or column,
       so every horizontal and vertical edge is crisp, and so is every box;
     · a filled mark (a dot, a pen's stem) sits on whole-pixel corners;
     · every glyph's ink box is centred on 8, 8 to within half a pixel, so a
       glyph sits on its button's centre (wbIcons.test.tsx measures this from
       the data, and e2e measures it from the rendered pixels);
     · one weight, 1px, for all of them.

   ONE GLYPH PER JOB. Pan is not here: Space-hold and an empty-board drag already
   pan, so a pan button repeated them. Reset view shares the pill's More menu with
   Clear, which is where a rare action belongs.

   Primitives are lines, rects, ellipses and filled rects only, so the ink box can
   be computed exactly from the data (no arcs, whose extent would need a curve
   solver).
   ══════════════════════════════════════════════════════════════════════════ */

export type WbGlyph =
  | 'select'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'sticky'
  | 'link'
  | 'erase'
  | 'undo'
  | 'fit'
  | 'reset'
  | 'trash'
  | 'more'
  | 'caret';

/** A stroked polyline (`l`), a stroked closed polygon (`g`), a stroked rect or ellipse, or a FILLED rect (`f`). */
export type WbPrim =
  | { l: readonly number[] }
  | { g: readonly number[] }
  | { r: readonly [x: number, y: number, w: number, h: number, rx: number] }
  | { e: readonly [cx: number, cy: number, rx: number, ry: number] }
  | { f: readonly [x: number, y: number, w: number, h: number, rx: number] };

/** Side of a glyph's grid, in device pixels. `caret` is its own 10px grid. */
export const WB_GRID = 16;
export const WB_CARET_GRID = 10;
export const WB_STROKE = 1;

export const WB_GLYPHS: Record<WbGlyph, readonly WbPrim[]> = {
  /* A pointer. */
  select: [{ g: [3.5, 2.5, 3.5, 12.5, 6.5, 9.5, 8.5, 13.5, 10.5, 12.5, 8.5, 8.5, 12.5, 8.5] }],
  /* A pen, nib bottom-left. */
  draw: [{ g: [11.5, 2.5, 13.5, 4.5, 5.5, 12.5, 2.5, 13.5, 3.5, 10.5] }, { l: [9.5, 4.5, 11.5, 6.5] }],
  rect: [{ r: [2.5, 3.5, 11, 9, 1] }],
  ellipse: [{ e: [8, 8, 5.5, 4.5] }],
  line: [{ l: [3.5, 12.5, 12.5, 3.5] }],
  arrow: [{ l: [3.5, 12.5, 12.5, 3.5] }, { l: [6.5, 3.5, 12.5, 3.5, 12.5, 9.5] }],
  /* A T: bar, stem, foot. */
  text: [{ l: [3.5, 4.5, 3.5, 2.5, 12.5, 2.5, 12.5, 4.5] }, { f: [7, 3, 2, 10, 0] }, { l: [5.5, 13.5, 10.5, 13.5] }],
  /* A note with a turned corner. */
  sticky: [{ g: [3.5, 2.5, 12.5, 2.5, 12.5, 9.5, 8.5, 13.5, 3.5, 13.5] }, { l: [12.5, 9.5, 8.5, 9.5, 8.5, 13.5] }],
  /* A box with an arrow leaving it: a reference to something elsewhere. */
  link: [
    { l: [9.5, 2.5, 13.5, 2.5, 13.5, 6.5] },
    { l: [13.5, 2.5, 7.5, 8.5] },
    { l: [11.5, 9.5, 11.5, 13.5, 2.5, 13.5, 2.5, 4.5, 6.5, 4.5] },
  ],
  /* An eraser block on its base. */
  erase: [{ g: [2.5, 10.5, 9.5, 3.5, 13.5, 7.5, 8.5, 12.5, 4.5, 12.5] }, { l: [6.5, 6.5, 10.5, 10.5] }, { l: [8.5, 12.5, 13.5, 12.5] }],
  /* A turn-back arrow. */
  undo: [{ l: [5.5, 3.5, 2.5, 6.5, 5.5, 9.5] }, { l: [2.5, 6.5, 10.5, 6.5, 13.5, 9.5, 10.5, 12.5, 5.5, 12.5] }],
  /* Four corners: frame the drawing. */
  fit: [
    { l: [2.5, 6.5, 2.5, 2.5, 6.5, 2.5] },
    { l: [9.5, 2.5, 13.5, 2.5, 13.5, 6.5] },
    { l: [13.5, 9.5, 13.5, 13.5, 9.5, 13.5] },
    { l: [6.5, 13.5, 2.5, 13.5, 2.5, 9.5] },
  ],
  /* A ring round a dot: back to the centre. */
  reset: [{ e: [8, 8, 5.5, 5.5] }, { f: [7, 7, 2, 2, 1] }],
  trash: [
    { l: [2.5, 4.5, 13.5, 4.5] },
    { l: [6.5, 4.5, 6.5, 2.5, 9.5, 2.5, 9.5, 4.5] },
    { l: [4.5, 4.5, 4.5, 13.5, 11.5, 13.5, 11.5, 4.5] },
    { l: [6.5, 7.5, 6.5, 10.5] },
    { l: [9.5, 7.5, 9.5, 10.5] },
  ],
  more: [{ f: [3, 7, 2, 2, 1] }, { f: [7, 7, 2, 2, 1] }, { f: [11, 7, 2, 2, 1] }],
  /* The chevron on a menu trigger, on its own 10px grid. */
  caret: [{ l: [2.5, 3.5, 5, 5.5, 7.5, 3.5] }],
};

/** [min, max] of every other number in a list. */
const span = (nums: readonly number[], start: 0 | 1): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i < nums.length; i += 2) {
    lo = Math.min(lo, nums[i]!);
    hi = Math.max(hi, nums[i]!);
  }
  return [lo, hi];
};

/**
 * Where a glyph's ink is, in grid pixels: every primitive's extent, grown by
 * half the stroke for a stroked one (round caps and joins reach that far).
 */
export function glyphInk(name: WbGlyph): { x0: number; y0: number; x1: number; y1: number } {
  const half = WB_STROKE / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  for (const prim of WB_GLYPHS[name]) {
    if ('l' in prim || 'g' in prim) {
      const pts = 'l' in prim ? prim.l : prim.g;
      const [ax, bx] = span(pts, 0);
      const [ay, by] = span(pts, 1);
      take(ax - half, ay - half, bx + half, by + half);
    } else if ('r' in prim) {
      const [x, y, w, h] = prim.r;
      take(x - half, y - half, x + w + half, y + h + half);
    } else if ('e' in prim) {
      const [cx, cy, rx, ry] = prim.e;
      take(cx - rx - half, cy - ry - half, cx + rx + half, cy + ry + half);
    } else {
      const [x, y, w, h] = prim.f;
      take(x, y, x + w, y + h);
    }
  }
  return { x0, y0, x1, y1 };
}

export interface WbIconProps {
  name: WbGlyph;
  className?: string;
}

/**
 * One inline SVG at its own grid size: 16px, or 10px for the caret. Sized by
 * attribute, so no stylesheet scales it off the grid.
 */
export function WbIcon({ name, className }: WbIconProps) {
  const grid = name === 'caret' ? WB_CARET_GRID : WB_GRID;
  return (
    <svg
      className={['wb-ic', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${grid} ${grid}`}
      width={grid}
      height={grid}
      aria-hidden="true"
      focusable="false"
      data-wb-icon={name}
      fill="none"
      stroke="currentColor"
      strokeWidth={WB_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {WB_GLYPHS[name].map((prim, i) => {
        if ('l' in prim) return <polyline key={i} points={prim.l.join(' ')} />;
        if ('g' in prim) return <polygon key={i} points={prim.g.join(' ')} />;
        if ('r' in prim) {
          const [x, y, width, height, rx] = prim.r;
          return <rect key={i} x={x} y={y} width={width} height={height} rx={rx} />;
        }
        if ('e' in prim) {
          const [cx, cy, rx, ry] = prim.e;
          return <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />;
        }
        const [x, y, width, height, rx] = prim.f;
        return <rect key={i} x={x} y={y} width={width} height={height} rx={rx} fill="currentColor" stroke="none" />;
      })}
    </svg>
  );
}
