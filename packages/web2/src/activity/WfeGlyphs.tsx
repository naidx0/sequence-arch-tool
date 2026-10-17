/* The workflow editor's small glyphs, drawn for whole pixels (0.1.6 B9): 1 SVG unit is 1 CSS pixel (the viewBox is the size), no
   transform, a 1px stroke whose straight runs sit on half pixels, so on a whole-pixel display a horizontal or vertical line fills
   exactly one pixel row, at 1x, 2x and 3x. Diagonals and arcs anti-alias, as on any display. */

export const GLYPH = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export type ActionGlyphName = 'close' | 'up' | 'down' | 'check';

const PATHS: Record<ActionGlyphName, Record<12 | 16, string>> = {
  close: { 16: 'm4 4 8 8M12 4l-8 8', 12: 'm2.5 2.5 7 7M9.5 2.5l-7 7' },
  up: { 16: 'm4 10 4-4 4 4', 12: 'm2.5 7.5 3.5-3.5 3.5 3.5' },
  down: { 16: 'm4 6 4 4 4-4', 12: 'm2.5 4.5 3.5 3.5 3.5-3.5' },
  check: { 16: 'm3 8.5 3.5 3.5L13 4.5', 12: 'm2 6.5 2.5 2.5L10 3' },
};

/** A small action glyph at 12 or 16 pixels, drawn at its own size. */
export function ActionGlyph({ name, size }: { name: ActionGlyphName; size: 12 | 16 }) {
  return (
    <svg {...GLYPH} width={size} height={size} viewBox={`0 0 ${size} ${size}`} data-glyph={name}>
      <path d={PATHS[name][size]} />
    </svg>
  );
}
