/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL'S GLYPHS
   packages/web2/src/files/FilesIcon.tsx

   Transcribed from the frozen substrate's <symbol> sprite,
   docs/brand/graphite/_core.html:1477-1570 — the book's own geometry on the
   book's 24x24 grid at the book's single 1.5 stroke. Not redrawn, not
   approximated, not sourced from an icon set.

   WHY A FOURTH COPY OF THIS PATTERN, after chat/Icon.tsx, canvas/BoardIcon.tsx
   and rail/RailIcon.tsx. All three carry the same paragraph and the same
   handback: a `<use href="#ic-…">` sprite needs its `<symbol>` block mounted
   once in the document, and the only files that could host it are index.html or
   the app shell — neither of which this lane owns. `rail/index.ts` states the
   rule outright: "a surface that reaches past this file is a surface this lane
   cannot change". Reaching into `rail/RailIcon.tsx` for two glyphs would make
   the rail unable to change its own icon list without breaking this panel.

   HANDBACK, WORD FOR WORD THE ONE THE OTHER THREE CARRY. The plan's §5 skeleton
   puts ONE Icon.tsx in components/ for the whole app; `src/components/` exists
   and holds only a .gitkeep. When it lands, all four files are deleted and the
   imports move. The names below are the book's `ic-*` names minus the prefix,
   so that move is a rename of an import and nothing else. FOUR copies is well
   past the point at which that handback stopped being tidiness.

   WHY THE GLYPH CARRIES REAL WEIGHT HERE. A folder and a file differ by one
   indent step and one glyph, and sheet 11.3 forbids the cheap alternative
   outright — a typed character "carries no stroke weight, no grid and no colour
   inheritance, so it cannot be part of a vocabulary". The disclosure chevron is
   the other half: it is the only thing on a directory row that says the row can
   be opened at all.

   HUE BUDGET: 0. Every glyph is `stroke: currentColor` and never picks its own
   colour — the row it sits in decides, which is what keeps a selected row's
   glyph legible against the selection fill without a second rule.
   ══════════════════════════════════════════════════════════════════════════ */

export type FilesIconName =
  | 'chevdown'
  | 'chevright'
  | 'code'
  | 'file'
  | 'folder'
  | 'pen'
  | 'search'
  | 'split'
  | 'x';

type Shape = { p: string } | { circle: [number, number, number] };

/** `_core.html:1477-1570`, in the order the book draws each glyph. */
const GLYPHS: Record<FilesIconName, Shape[]> = {
  chevdown: [{ p: 'M6.8 9.6 12 14.8l5.2-5.2' }],
  chevright: [{ p: 'M9.6 6.8 14.8 12l-5.2 5.2' }],
  code: [{ p: 'm8.8 8.4-4.4 3.6 4.4 3.6' }, { p: 'm15.2 8.4 4.4 3.6-4.4 3.6' }, { p: 'M13.6 4.6 10.4 19.4' }],
  file: [
    { p: 'M13.6 3.6H7.6A2.4 2.4 0 0 0 5.2 6v12a2.4 2.4 0 0 0 2.4 2.4h8.8a2.4 2.4 0 0 0 2.4-2.4V8.4z' },
    { p: 'M13.6 3.6v4.8h5.2' },
  ],
  folder: [
    { p: 'M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z' },
  ],
  pen: [{ p: 'M17.2 3.8a2.4 2.4 0 0 1 3.4 3.4L9.4 18.4l-4.6 1.2 1.2-4.6z' }, { p: 'm15.4 5.6 3.4 3.4' }],
  search: [{ circle: [11, 11, 6.1] }, { p: 'M15.4 15.4 20 20' }],
  /* The book's `ic-split`, drawn as two stacked panes. It is the DIFF glyph
     here because a diff is two versions of one file shown together, and the
     book has no diff glyph of its own — §5.6 lists the diff inspector among the
     eleven surfaces the book does not cover. Reusing a real glyph is honest
     where inventing a twelfth one would be a private vocabulary. */
  split: [{ p: 'M3.6 5.2h16.8v5.6H3.6z' }, { p: 'M3.6 13.2h10.4v5.6H3.6z' }],
  x: [{ p: 'M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4' }],
};

export interface FilesIconProps {
  name: FilesIconName;
  /**
   * The rung, in the book's three icon sizes. 14 is the row slot every rung of
   * this panel aligns on; 12 is the disclosure chevron, which sits INSIDE the
   * 14 slot and must not out-weigh the folder beside it.
   */
  size?: 12 | 14 | 16;
}

export function FilesIcon({ name, size = 14 }: FilesIconProps) {
  return (
    <svg
      className={`files-i files-i-${size}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name].map((shape, index) =>
        'circle' in shape ? (
          <circle key={index} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} />
        ) : (
          <path key={index} d={shape.p} />
        ),
      )}
    </svg>
  );
}
