/* ══════════════════════════════════════════════════════════════════════════
   THE EMPTY BOARD'S ASCII RAMP, ON THE FIELD'S OWN GRID
   packages/web2/src/canvas/AsciiRamp.tsx

   Round 7, C.2. Jaden: "The ASCII on the background also needs to be fixed
   up." Measured on the shipped build (1440x900, both themes): the ramp was a
   fixed 18-row string in a box pinned to the pane's bottom edge, in 11px mono
   at 0.3em tracking (9.9px a glyph, 18px a row), laid over the board's 20px
   dot field. Two pitches that close beat: glyphs and dots interleaved in a
   moire, rows sat at a pane-height offset from the dots, the field moved with
   the camera and the ramp did not, and in light it was 6% of the dark ink.

   NOW EACH GLYPH IS ONE FIELD CELL. The ramp is drawn in flow space (inside
   the viewport), one glyph per `FIELD_PITCH` cell, centred on that cell's
   dot, in the field's own ink (`--board-field-ink`), on the field's own
   ground with an empty cell drawn as the dot — so it is the dot field
   growing denser toward the bottom edge, in both themes, and it pans and zooms
   with the field. Each cell's glyph is a hash of its cell, so the texture is
   the same every time (no seed, no animation), and the text is rebuilt only
   when the visible cell window changes.
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';

/** --board-field-pitch (board.css: --sp-20). */
export const FIELD_PITCH = 20;
/** Bastion's ramp, light to dense. */
export const RAMP = ' .,:-=+*#%@';
/** An empty cell is the field's own dot, drawn by the ramp: the ramp's band
 *  covers the field (so a glyph never sits on a dot and doubles it) and
 *  carries the dots on itself, so the field reads as one surface. */
/* Written as an escape: it is a glyph of the texture, not a "·" separator
   (Decision 49 bans those, and src/noMiddleDot.test.ts scans for the
   character). */
export const EMPTY_CELL = String.fromCharCode(0xb7);
/** The ramp starts this far down the pane and is densest at the bottom. */
export const RAMP_FROM = 0.5;
/** Past this many cells (a far zoom-out) the ramp is not drawn at all. */
export const MAX_CELLS = 12000;

function cellHash(c: number, r: number): number {
  let h = (Math.imul(c, 374761393) + Math.imul(r, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The glyph for cell (c, r), with `t` 0 at the top of the ramp and 1 at the
 *  bottom edge. Sparse and light at the top, denser and heavier at the bottom,
 *  and never past `*` above the last quarter. */
export function rampGlyph(c: number, r: number, t: number): string {
  const v = cellHash(c, r);
  const k = Math.max(0, Math.min(1, t));
  if (v > k * 1.1) return EMPTY_CELL;
  const level = Math.min(RAMP.length - 1, Math.floor(k * k * (0.45 + 0.55 * cellHash(r, c)) * RAMP.length));
  return RAMP[Math.max(1, level)]!;
}

export interface RampWindow {
  c0: number;
  r0: number;
  cols: number;
  rows: number;
  /** Row index (from r0) where the ramp's bottom edge is: t = 1. */
  bottom: number;
}

/** The cells the ramp covers for a camera and a pane, or null when the pane is
 *  unmeasured or the window is too big to be worth drawing. */
export function rampWindow(
  viewport: { x: number; y: number; zoom: number },
  frame: { width: number; height: number },
): RampWindow | null {
  if (!(frame.width > 0) || !(frame.height > 0) || !(viewport.zoom > 0)) return null;
  const z = viewport.zoom;
  const x0 = -viewport.x / z;
  const y0 = -viewport.y / z;
  const w = frame.width / z;
  const h = frame.height / z;
  const c0 = Math.floor(x0 / FIELD_PITCH) + 0; /* never -0 */
  const c1 = Math.ceil((x0 + w) / FIELD_PITCH);
  const r0 = Math.floor((y0 + h * RAMP_FROM) / FIELD_PITCH);
  const r1 = Math.ceil((y0 + h) / FIELD_PITCH);
  const cols = c1 - c0;
  const rows = r1 - r0;
  if (cols <= 0 || rows <= 0 || cols * rows > MAX_CELLS) return null;
  return { c0, r0, cols, rows, bottom: Math.max(1, rows - 1) };
}

export function rampText(win: RampWindow): string {
  const lines: string[] = [];
  for (let i = 0; i < win.rows; i++) {
    const t = i / win.bottom;
    let line = '';
    for (let j = 0; j < win.cols; j++) line += rampGlyph(win.c0 + j, win.r0 + i, t);
    lines.push(line);
  }
  return lines.join('\n');
}

export function AsciiRamp({
  viewport,
  frame,
}: {
  viewport: { x: number; y: number; zoom: number };
  frame: { width: number; height: number };
}) {
  const win = rampWindow(viewport, frame);
  const key = win ? `${win.c0},${win.r0},${win.cols},${win.rows}` : '';
  const text = useMemo(() => (win ? rampText(win) : ''), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!win) return <div className="board-ascii" aria-hidden="true" data-testid="board-ascii" />;
  return (
    <div
      className="board-ascii"
      aria-hidden="true"
      data-testid="board-ascii"
      data-cells={win.cols * win.rows}
      style={{
        transform: `translate(${win.c0 * FIELD_PITCH}px, ${win.r0 * FIELD_PITCH}px)`,
      }}
    >
      {text}
    </div>
  );
}
