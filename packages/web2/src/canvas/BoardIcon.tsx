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
  | 'x'
  /* THE RESKIN'S SET (Decision 49): the glyphs of the picked mix,
     scratchpad Mix.dc.html / BArc.dc.html `<symbol>` sprite, on the same
     24 grid. The board draws these; the older names above stay for the
     panels outside the board that still import them. */
  | 'b-globe'
  | 'b-box'
  | 'b-db'
  | 'b-queue'
  | 'b-spark'
  | 'b-module'
  | 'b-file'
  | 'b-folder'
  | 'b-filter'
  | 'b-model'
  | 'b-map'
  | 'b-grid'
  | 'b-diff'
  | 'b-flame'
  | 'b-flow'
  | 'b-search'
  | 'b-more'
  | 'b-chev'
  | 'b-pen'
  | 'b-import'
  | 'b-layers'
  | 'b-minus'
  | 'b-plus'
  | 'b-fit'
  | 'b-eye'
  | 'b-key'
  | 'b-x';

type Shape =
  | { p: string }
  | { circle: [number, number, number] }
  | { rect: [number, number, number, number, number] }
  | { ellipse: [number, number, number, number] };

/** `_core.html:1483-1570`, in the order the book draws each glyph. */
export const GLYPHS: Record<BoardIconName, Shape[]> = {
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
  filter: [{ p: 'M4.4 5.1h15.2l-5.9 6.9v5.2l-3.4 1.7v-6.9z' }],
  flow: [
    { p: 'M3.6 5.4h5.6a2.4 2.4 0 0 1 2.4 2.4v5.6a2.4 2.4 0 0 0 2.4 2.4h4.4' },
    { p: 'm16.8 13 3.6 2.8-3.6 2.8' },
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
  /* Decision 9 — architecture Draw is icon-first. Chat's pen outline, re-centred on the 24 grid (glyphCentre.test.ts). */
  pen: [
    { p: 'M16.15 4.45a2.4 2.4 0 0 1 3.4 3.4L8.35 19.05l-4.6 1.2 1.2-4.6z' },
    { p: 'm14.35 6.25 3.4 3.4' },
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

  'b-globe': [{ circle: [12, 12, 9] }, { p: 'M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18' }],
  'b-box': [{ p: 'm12 3 8 4.5v9L12 21l-8-4.5v-9z' }, { p: 'M12 12l8-4.5M12 12v9M12 12 4 7.5' }],
  'b-db': [
    { ellipse: [12, 6, 7, 3] },
    { p: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' },
  ],
  /* A queue of messages: the lane, three held items, the way out. */
  'b-queue': [{ rect: [3, 6, 15, 12, 3] }, { p: 'M7.5 9.5v5M10.5 9.5v5M13.5 9.5v5M21 12h-3' }],
  'b-spark': [{ p: 'M12 5l1.8 5.2L19 12l-5.2 1.8L12 19l-1.8-5.2L5 12l5.2-1.8z' }],
  'b-module': [{ rect: [4, 4, 16, 16, 3.5] }, { rect: [8.5, 8.5, 7, 7, 1.5] }],
  'b-file': [{ p: 'M6 3h8l4 4v14H6z' }, { p: 'M14 3v4h4' }],
  'b-folder': [{ p: 'M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }],
  'b-filter': [{ p: 'M4 5h16l-6 7v5l-4 2v-7z' }],
  'b-model': [{ rect: [6, 6, 12, 12, 3] }, { p: 'M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4' }],
  'b-map': [{ p: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z' }, { p: 'M9 4v14M15 6v14' }],
  'b-grid': [
    { rect: [4, 4, 7, 7, 1.5] },
    { rect: [13, 4, 7, 7, 1.5] },
    { rect: [4, 13, 7, 7, 1.5] },
    { rect: [13, 13, 7, 7, 1.5] },
  ],
  'b-diff': [{ p: 'M12 4.5v8M8 8.5h8M8 19.5h8' }],
  'b-flame': [{ p: 'M12 4.5c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5' }],
  'b-flow': [{ p: 'M4 5.5h5a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h5' }, { p: 'm17 12.5 3 3-3 3' }],
  'b-search': [{ circle: [11, 11, 7] }, { p: 'm20 20-3.5-3.5' }],
  'b-chev': [{ p: 'm7 9.5 5 5 5-5' }],
  'b-more': [{ circle: [5.5, 12, 0.9] }, { circle: [12, 12, 0.9] }, { circle: [18.5, 12, 0.9] }],
  'b-pen': [{ p: 'M4.5 19.5l4-1 11-11-3-3L5.5 15.5z' }],
  'b-import': [{ p: 'M12 4v11M7 10l5 5 5-5M5 20h14' }],
  'b-layers': [{ p: 'm12 4.5 9 5-9 5-9-5z' }, { p: 'm3 14.5 9 5 9-5' }],
  'b-minus': [{ p: 'M5 12h14' }],
  'b-plus': [{ p: 'M12 5v14M5 12h14' }],
  'b-fit': [{ p: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }],
  'b-eye': [{ p: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }, { circle: [12, 12, 2.8] }],
  'b-key': [{ rect: [4, 6, 16, 12, 3] }, { p: 'M8 10h.01M12 10h.01M16 10h.01M8 14h8' }],
  'b-x': [{ p: 'M6 6l12 12M18 6 6 18' }],
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
