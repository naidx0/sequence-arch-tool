/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD'S GLYPHS
   packages/web2/src/canvas/BoardIcon.tsx

   Transcribed from the frozen substrate's <symbol> sprite,
   docs/brand/graphite/_core.html:1483-1570 — the book's own geometry on the
   book's 24x24 grid at the book's single 1.5 stroke. Not redrawn, not
   approximated, not sourced from an icon set.

   WHY INLINE PATHS AND NOT A <use href="#ic-…"> SPRITE, and why this file
   exists beside chat/Icon.tsx rather than importing it. A sprite needs its
   <symbol> block mounted once in the document, and the only files that could
   host it are index.html or the app shell — neither of which this lane owns.
   A glyph that renders as an empty box because somebody else's file has not
   shipped is the worst possible failure for a vocabulary whose entire job is to
   carry meaning: Decision 2 makes the ICON the strongest of the four channels
   that carry kind, so on this surface an absent glyph is an absent kind.
   `chat/index.ts` states outright that Icon is not re-exported — "a surface
   that reaches past this file is a surface this lane cannot change" — so the
   board may not import it, and duplicating eleven path strings is the cheaper
   of the two mistakes available.

   HANDBACK, identical to the one chat/Icon.tsx carries: the plan's §5 skeleton
   puts ONE Icon.tsx in components/ for the whole app. When it exists both files
   are deleted and the imports move. The names below are the book's `ic-*` names
   minus the prefix, so the move is a rename of an import and nothing else.

   HUE BUDGET: 0. Every glyph is `stroke: currentColor`. A glyph never picks its
   own colour — the row it sits in decides.
   ══════════════════════════════════════════════════════════════════════════ */

export type BoardIconName =
  | 'agent'
  | 'board'
  | 'database'
  | 'entry'
  | 'file'
  | 'filter'
  | 'flow'
  | 'fn'
  | 'folder'
  | 'minus'
  | 'model'
  | 'module'
  | 'pen'
  | 'plus'
  | 'service'
  | 'topic'
  | 'x';

type Shape =
  | { p: string }
  | { circle: [number, number, number] }
  | { rect: [number, number, number, number, number] }
  | { ellipse: [number, number, number, number] };

/** `_core.html:1483-1570`, in the order the book draws each glyph. */
const GLYPHS: Record<BoardIconName, Shape[]> = {
  agent: [{ p: 'm12 3.4 7.4 4.3v8.6L12 20.6 4.6 16.3V7.7z' }, { circle: [12, 12, 2.4] }],
  board: [
    { rect: [3.2, 4.2, 7, 5.4, 1.6] },
    { rect: [13.8, 4.2, 7, 5.4, 1.6] },
    { rect: [8.5, 14.4, 7, 5.4, 1.6] },
    { p: 'M6.7 9.6v2.6h10.6V9.6M12 12.2v2.2' },
  ],
  database: [
    { ellipse: [12, 6.2, 7.2, 2.6] },
    { p: 'M4.8 6.2v11.6c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6V6.2' },
    { p: 'M4.8 12c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6' },
  ],
  entry: [
    { p: 'M3.6 12h9.2' },
    { p: 'm9.4 8.4 3.6 3.6-3.6 3.6' },
    { p: 'M15.2 4.8h3.2a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2h-3.2' },
  ],
  file: [
    { p: 'M13.6 3.6H7.6A2.4 2.4 0 0 0 5.2 6v12a2.4 2.4 0 0 0 2.4 2.4h8.8a2.4 2.4 0 0 0 2.4-2.4V8.4z' },
    { p: 'M13.6 3.6v4.8h5.2' },
  ],
  filter: [{ p: 'M4.4 6.2h15.2l-5.9 6.9v5.2l-3.4 1.7v-6.9z' }],
  flow: [
    { p: 'M3.6 6.6h5.6a2.4 2.4 0 0 1 2.4 2.4v5.6a2.4 2.4 0 0 0 2.4 2.4h4.4' },
    { p: 'm16.8 14.2 3.6 2.8-3.6 2.8' },
  ],
  folder: [{ p: 'M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z' }],
  fn: [
    {
      p: 'M9.8 4.4c-1.9 0-2.5 1-2.5 2.6v2.2c0 1.6-.8 2.8-2.4 2.8 1.6 0 2.4 1.2 2.4 2.8V17c0 1.6.6 2.6 2.5 2.6',
    },
    {
      p: 'M14.2 4.4c1.9 0 2.5 1 2.5 2.6v2.2c0 1.6.8 2.8 2.4 2.8-1.6 0-2.4 1.2-2.4 2.8V17c0 1.6-.6 2.6-2.5 2.6',
    },
  ],
  minus: [{ p: 'M5.2 12h13.6' }],
  model: [
    { p: 'm12 3.4 8.4 4.2-8.4 4.2-8.4-4.2z' },
    { p: 'm3.6 12.4 8.4 4.2 8.4-4.2' },
    { p: 'm3.6 16.6 8.4 4.2 8.4-4.2' },
  ],
  module: [{ rect: [3.6, 3.6, 16.8, 16.8, 3.2] }, { rect: [8.4, 8.4, 7.2, 7.2, 1.6] }],
  /* Decision 9 — architecture Draw is icon-first. Same geometry as
     chat/Icon.tsx `pen` / ic-pen; not borrowed for any other meaning here. */
  pen: [
    { p: 'M17.2 3.8a2.4 2.4 0 0 1 3.4 3.4L9.4 18.4l-4.6 1.2 1.2-4.6z' },
    { p: 'm15.4 5.6 3.4 3.4' },
  ],
  plus: [{ p: 'M12 5.2v13.6M5.2 12h13.6' }],
  service: [
    { rect: [3.6, 5, 16.8, 5.8, 2] },
    { rect: [3.6, 13.2, 16.8, 5.8, 2] },
    { p: 'M7 7.9h.01M7 16.1h.01' },
  ],
  topic: [{ p: 'M3.6 8.4h6.2M3.6 12h9.6M3.6 15.6h6.2' }, { p: 'm16.4 8.4 3.6 3.6-3.6 3.6' }],
  /* Byte-identical to `rail/RailIcon.tsx` and `chat/Icon.tsx`. Sheet 09 ruling
     3 forbids BORROWING a glyph the vocabulary does not have — it does not
     forbid this surface drawing one the vocabulary already owns. Copying the
     path rather than inventing a second X is what keeps the three sets one
     vocabulary instead of three. */
  x: [{ p: 'M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4' }],
};

export interface BoardIconProps {
  name: BoardIconName;
  /** The book's rungs. 14 on a card, 12 inside a wall or a legend chip. */
  size?: 12 | 14 | 16;
  className?: string;
}

/**
 * One inline SVG, `aria-hidden` on every instance.
 *
 * A glyph on this surface always sits beside the words it illustrates — the
 * card's mono kind tag, the legend's kind name, a button's aria-label — so
 * announcing it again would read the same fact twice.
 */
export function BoardIcon({ name, size = 14, className }: BoardIconProps) {
  const classes = ['i', `i-${size}`, className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {GLYPHS[name].map((shape, index) => {
        if ('p' in shape) return <path key={index} d={shape.p} />;
        if ('circle' in shape) {
          const [cx, cy, r] = shape.circle;
          return <circle key={index} cx={cx} cy={cy} r={r} />;
        }
        if ('ellipse' in shape) {
          const [cx, cy, rx, ry] = shape.ellipse;
          return <ellipse key={index} cx={cx} cy={cy} rx={rx} ry={ry} />;
        }
        const [x, y, width, height, rx] = shape.rect;
        return <rect key={index} x={x} y={y} width={width} height={height} rx={rx} />;
      })}
    </svg>
  );
}
