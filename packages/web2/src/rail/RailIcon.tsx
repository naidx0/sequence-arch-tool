/* ══════════════════════════════════════════════════════════════════════════
   THE RAIL'S GLYPHS
   packages/web2/src/rail/RailIcon.tsx

   Transcribed from the frozen substrate's <symbol> sprite,
   docs/brand/graphite/_core.html:1477-1570 — the book's own geometry on the
   book's 24x24 grid at the book's single 1.5 stroke. Not redrawn, not
   approximated, not sourced from an icon set.

   WHY A THIRD COPY OF THIS PATTERN, after chat/Icon.tsx and canvas/BoardIcon.tsx.
   Both carry the same paragraph and the same handback: a <use href="#ic-…">
   sprite needs its <symbol> block mounted once in the document, and the only
   files that could host it are index.html or the app shell — neither of which
   this lane owns. `chat/index.ts` states outright that its Icon is not
   re-exported, "a surface that reaches past this file is a surface this lane
   cannot change", and `canvas/BoardIcon.tsx` records the same conclusion:
   "duplicating eleven path strings is the cheaper of the two mistakes
   available."

   HANDBACK, WORD FOR WORD THE ONE THE OTHER TWO CARRY. The plan's §5 skeleton
   puts ONE Icon.tsx in components/ for the whole app. When it exists all three
   files are deleted and the imports move; the names below are the book's `ic-*`
   names minus the prefix, so the move is a rename of an import and nothing else.
   Three copies is the point at which that handback stops being tidiness.

   WHY THE GLYPH MATTERS MORE HERE THAN ANYWHERE. Sheet 11.3 makes the icon one
   of the four non-chromatic channels that tell a file row from a function row —
   "height, indent, icon and type family — four channels, all of which survive a
   greyscale render and a colour-blind reader" — and 11.3 forbids the alternative
   outright: the trailing count "used to be a typed ƒ beside the number, which
   sheet 09 forbids outright: a typed character carries no stroke weight, no grid
   and no colour inheritance, so it cannot be part of a vocabulary."

   HUE BUDGET: 0. Every glyph is `stroke: currentColor`. A glyph never picks its
   own colour — the row it sits in decides.
   ══════════════════════════════════════════════════════════════════════════ */

export type RailIconName =
  | 'agent'
  | 'alert'
  | 'arrowright'
  | 'chevdown'
  | 'chevright'
  | 'database'
  | 'entry'
  | 'file'
  | 'fn'
  | 'open'
  | 'pause'
  | 'play'
  | 'search'
  | 'service'
  | 'topic'
  | 'x';

type Shape =
  | { p: string }
  | { circle: [number, number, number] }
  | { rect: [number, number, number, number, number] }
  | { ellipse: [number, number, number, number] };

/** `_core.html:1477-1570`, in the order the book draws each glyph. */
const GLYPHS: Record<RailIconName, Shape[]> = {
  agent: [{ p: 'm12 3.4 7.4 4.3v8.6L12 20.6 4.6 16.3V7.7z' }, { circle: [12, 12, 2.4] }],
  alert: [
    { p: 'M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.2 12.6a1.5 1.5 0 0 1-1.3 2.3H4.8a1.5 1.5 0 0 1-1.3-2.3z' },
    { p: 'M12 9.6v4' },
    { p: 'M12 16.4h.01' },
  ],
  arrowright: [{ p: 'M5 12h13.4' }, { p: 'm12.2 5.8 6.2 6.2-6.2 6.2' }],
  chevdown: [{ p: 'M6.8 9.6 12 14.8l5.2-5.2' }],
  chevright: [{ p: 'M9.6 6.8 14.8 12l-5.2 5.2' }],
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
  fn: [
    {
      p: 'M9.8 4.4c-1.9 0-2.5 1-2.5 2.6v2.2c0 1.6-.8 2.8-2.4 2.8 1.6 0 2.4 1.2 2.4 2.8V17c0 1.6.6 2.6 2.5 2.6',
    },
    {
      p: 'M14.2 4.4c1.9 0 2.5 1 2.5 2.6v2.2c0 1.6.8 2.8 2.4 2.8-1.6 0-2.4 1.2-2.4 2.8V17c0 1.6-.6 2.6-2.5 2.6',
    },
  ],
  open: [
    { p: 'M14.2 4H20v5.8' },
    { p: 'M20 4 11.4 12.6' },
    { p: 'M17.6 14v4.4A1.6 1.6 0 0 1 16 20H5.6A1.6 1.6 0 0 1 4 18.4V8A1.6 1.6 0 0 1 5.6 6.4H10' },
  ],
  pause: [
    { rect: [7.6, 5.6, 3.4, 12.8, 1.4] },
    { rect: [13, 5.6, 3.4, 12.8, 1.4] },
  ],
  play: [{ p: 'M8.2 5.6a.6.6 0 0 1 .9-.5l9 6.4a.6.6 0 0 1 0 1l-9 6.4a.6.6 0 0 1-.9-.5z' }],
  search: [{ circle: [11, 11, 6.1] }, { p: 'M15.4 15.4 20 20' }],
  service: [
    { rect: [3.6, 5, 16.8, 5.8, 2] },
    { rect: [3.6, 13.2, 16.8, 5.8, 2] },
    { p: 'M7 7.9h.01M7 16.1h.01' },
  ],
  topic: [{ p: 'M3.6 8.4h6.2M3.6 12h9.6M3.6 15.6h6.2' }, { p: 'm16.4 8.4 3.6 3.6-3.6 3.6' }],
  x: [{ p: 'M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4' }],
};

export interface RailIconProps {
  name: RailIconName;
  /** Sheet 11.1: the rail's one icon slot is `.i-14`. 12 is the trailing count. */
  size?: 12 | 14;
  className?: string;
}

/**
 * `aria-hidden` on every glyph, without exception.
 *
 * Nothing in this rail is a glyph ALONE: a row has its name, the coverage badge
 * has its sentence, the playback control has its label, and sheet 11.7 makes it
 * a rule — "Every coloured state on this sheet also carries a word… A reader who
 * cannot see the hue still gets the fact." So every glyph is decoration to a
 * screen reader by construction, and an `aria-label` here would make the reader
 * hear the same thing twice.
 */
export function RailIcon({ name, size = 14, className }: RailIconProps) {
  const shapes = GLYPHS[name];
  return (
    <svg
      className={className ? `i i-${size} ${className}` : `i i-${size}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape, i) => {
        if ('p' in shape) return <path key={i} d={shape.p} />;
        if ('circle' in shape) {
          const [cx, cy, r] = shape.circle;
          return <circle key={i} cx={cx} cy={cy} r={r} />;
        }
        if ('rect' in shape) {
          const [x, y, w, h, rx] = shape.rect;
          return <rect key={i} x={x} y={y} width={w} height={h} rx={rx} />;
        }
        const [cx, cy, rx, ry] = shape.ellipse;
        return <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} />;
      })}
    </svg>
  );
}

/**
 * The card head's glyph is THE SAME ONE THE NODE CARRIES ON THE BOARD.
 *
 * Sheet 11.3: "The card head's icon is not decoration. It is the same glyph the
 * node carries on the board, from the same one-icon-per-kind vocabulary — so the
 * rail and the canvas name a service the same way, and a reader who learns the
 * mark once has learned it in both places."
 *
 * `entry` is a POSITION and not a kind (sheet 03.7, and `canvas/kinds.ts` refuses
 * to model it as a sixth peer), so it is not reachable from a `NodeKind` alone
 * and is not mapped here. The board decides entry from its own heuristic; when
 * the rail is given that fact it will be passed in, not re-derived — "a second
 * regular expression for the same question is how two surfaces come to disagree
 * about which nodes are entries."
 */
export function iconForKind(kind: string): RailIconName {
  switch (kind) {
    case 'datastore':
      return 'database';
    case 'topic':
      return 'topic';
    case 'agent':
      return 'agent';
    default:
      return 'service';
  }
}
