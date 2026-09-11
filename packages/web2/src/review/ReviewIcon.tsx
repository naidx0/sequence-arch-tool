/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SURFACE'S GLYPHS
   packages/web2/src/review/ReviewIcon.tsx

   Transcribed from docs/brand/graphite/_core.html — the frozen book's own
   <symbol> sprite — and NOT redrawn. Every path below is the book's geometry
   on the book's 24x24 grid, at the book's single stroke weight.

   WHY THE PATHS ARE INLINE. A `<use href="#ic-…">` sprite needs its <symbol>
   definitions mounted once in the document, and the only places that could
   live are index.html or the app shell — neither of which this lane owns. An
   icon that renders as an empty box because somebody else's file has not
   shipped yet is the worst possible failure for a vocabulary whose whole job
   is to carry meaning.

   WHY IT IS NOT `chat/Icon.tsx`. That file's own header says it is the CHAT
   COLUMN's set and that it is deleted the day `components/Icon.tsx` lands.
   Importing it would make this lane's surface depend on another lane's
   scheduled deletion, and `chat/index.ts` deliberately does not export it —
   "a surface that reaches past this file is a surface this lane cannot
   change." Nine glyph definitions are cheaper than that coupling, and when the
   shared Icon lands both files are deleted in the same move.

   HUE BUDGET: 0. Every glyph is `stroke: currentColor`. A glyph never picks
   its own colour — the row it sits in decides. Sheet 12.7 lists the six places
   on these surfaces where that colour may be a hue at all.
   ══════════════════════════════════════════════════════════════════════════ */

export type ReviewIconName =
  | 'check'
  | 'x'
  | 'plus'
  | 'file'
  | 'branch'
  | 'commit'
  | 'chevright'
  | 'chevdown'
  | 'alert'
  | 'fn'
  | 'flow';

type Shape = { p: string } | { circle: [number, number, number] };

/** The book's paths, verbatim from `_core.html`'s sprite. */
const GLYPHS: Record<ReviewIconName, Shape[]> = {
  check: [{ p: 'M5 12.6 9.6 17.2 19 7.2' }],
  x: [{ p: 'M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4' }],
  plus: [{ p: 'M12 5.2v13.6M5.2 12h13.6' }],
  file: [
    { p: 'M13.6 3.6H7.6A2.4 2.4 0 0 0 5.2 6v12a2.4 2.4 0 0 0 2.4 2.4h8.8a2.4 2.4 0 0 0 2.4-2.4V8.4z' },
    { p: 'M13.6 3.6v4.8h5.2' },
  ],
  branch: [
    { circle: [6.4, 5.6, 2.2] },
    { circle: [6.4, 18.4, 2.2] },
    { circle: [17.2, 7.8, 2.2] },
    { p: 'M6.4 7.8v8.4' },
    { p: 'M17.2 10v1a4 4 0 0 1-4 4H6.4' },
  ],
  commit: [{ circle: [12, 12, 3.4] }, { p: 'M2.8 12h5.8M15.4 12h5.8' }],
  chevright: [{ p: 'M9.6 6.8 14.8 12l-5.2 5.2' }],
  chevdown: [{ p: 'M6.8 9.6 12 14.8l5.2-5.2' }],
  alert: [
    { p: 'M10.7 4.6a1.5 1.5 0 0 1 2.6 0l7.2 12.6a1.5 1.5 0 0 1-1.3 2.3H4.8a1.5 1.5 0 0 1-1.3-2.3z' },
    { p: 'M12 9.6v4' },
    { p: 'M12 16.4h.01' },
  ],
  fn: [
    { p: 'M9.8 4.4c-1.9 0-2.5 1-2.5 2.6v2.2c0 1.6-.8 2.8-2.4 2.8 1.6 0 2.4 1.2 2.4 2.8V17c0 1.6.6 2.6 2.5 2.6' },
    { p: 'M14.2 4.4c1.9 0 2.5 1 2.5 2.6v2.2c0 1.6.8 2.8 2.4 2.8-1.6 0-2.4 1.2-2.4 2.8V17c0 1.6-.6 2.6-2.5 2.6' },
  ],
  flow: [{ p: 'm8.8 8.4-4.4 3.6 4.4 3.6' }, { p: 'm15.2 8.4 4.4 3.6-4.4 3.6' }, { p: 'M13.6 4.6 10.4 19.4' }],
};

export interface ReviewIconProps {
  name: ReviewIconName;
  /** 12, 14 or 16. The book's `.i-*` ladder; 14 is the tool-row glyph. */
  size?: 12 | 14 | 16;
}

export function ReviewIcon({ name, size = 14 }: ReviewIconProps) {
  return (
    <svg className={`rv-i rv-i-${size}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name].map((shape, index) =>
        'p' in shape ? (
          <path key={index} d={shape.p} />
        ) : (
          <circle key={index} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} />
        ),
      )}
    </svg>
  );
}
