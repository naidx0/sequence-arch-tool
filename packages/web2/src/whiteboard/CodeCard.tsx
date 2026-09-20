import type { CSSProperties, ReactNode } from 'react';

import './codeCard.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE CODE CARD — the one mark on this surface that stands for REAL CODE
   packages/web2/src/whiteboard/CodeCard.tsx

   Item 1.2 of `docs/research/code-canvas-program.md`. `WbNodeRef` — "a
   reference to a real node of the scanned graph" — has existed in
   `whiteboardModel.ts` since the model was written and NOTHING HAS EVER
   RENDERED ONE past a bare SVG <text> caption. This is the renderer it was cut
   for.

   ── WHY A CARD AND NOT A BRIGHTER CAPTION ─────────────────────────────────

   The whiteboard's whole reason to exist is that nothing on it is a measured
   claim (`whiteboardModel.ts`'s header, and CANON's first non-negotiable).
   This card is the ONE exception, and the exception only holds if the reader
   can see it at a glance. A note says whatever somebody typed; a card says
   "this is a real file, at this real path, at these real lines" — and the two
   must never look alike. So the card is the only thing on the surface with a
   chassis: a bordered box, a mono path, a line range, a kind glyph. A sketched
   box has none of those and can never accidentally grow them.

   That is also why `path` and `nodeId` are REQUIRED in `CodeCardItem` while
   everything else is optional. A card with no path is not a code card, it is a
   note with a border, and the type refuses to build one. The program's law
   reads "a code card cites a real path and real lines or it is refused" — the
   *real* half is the board writer's job to validate (item 1.1); the *cites*
   half is this type's, and it is the half a renderer can actually enforce.

   ── PURE PRESENTATION, ON PURPOSE ─────────────────────────────────────────

   No store, no fetch, no `useAppState`, no clock. Everything it draws arrives
   in one plain object. Two reasons, and the second is the one that bites: a
   card is drawn once per reference on a canvas that can hold dozens, so a
   component that subscribed would re-render every one of them on any unrelated
   store write; and a card that fetched its own excerpt would show a DIFFERENT
   excerpt from the one the agent was looking at when it placed the card, which
   is a grounded-looking surface quietly ungrounding itself.

   ── IT DOES NOT KNOW WHERE IT IS MOUNTED ──────────────────────────────────

   The board paints its items inside one <svg>, so the wiring will hang this in
   a <foreignObject>. Two consequences this file owns rather than pushes up:

     · Every rule in `codeCard.css` is keyed off `.codecard` itself, never off
       an ancestor `.wb-scope`. A card that only styles correctly inside one
       parent is a card that renders as unstyled black-on-white the first time
       it is shown anywhere else — a rail preview, a test, a chat chip.
     · `CODE_CARD_W` / `CODE_CARD_MAX_H` are exported AND are what the CSS
       reads, handed down as inline custom properties (the documented way a
       number reaches CSS here — see `Shell.tsx`'s `--pane-w`). A
       <foreignObject> must be given a width and height in board units, and if
       those numbers were written twice — once here, once in the sheet — the
       frame would clip the card the first time either moved.

   HUE BUDGET: 0. A card is a shape, not a verdict. Nothing here reaches for
   `--fits` / `--wont` / `--spills`, and the kind glyph is `currentColor` like
   every other glyph in the product: the row decides the colour, never the mark.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The footprint, in board units, and the single source of truth for it.
 *
 * 264 is wide enough for ~34 mono characters at `--t-11`, which is what
 * `CODE_CARD_PATH_CHARS` below is tuned against. The max height is a CAP, not
 * a size: a card with no excerpt is much shorter, and the frame the wiring
 * draws should be sized to the cap so a long card is never clipped by it.
 */
export const CODE_CARD_W = 264;
export const CODE_CARD_MAX_H = 200;

/**
 * The kinds a card can stand for.
 *
 * Schema `NodeKind` plus `function`. The extra one is not a liberty: the
 * program's own line is "a shape that shows a real file/symbol", and a symbol
 * is the more useful of the two — `packages/schema/src/functions.ts` already
 * models functions as nodes. A card that could only ever say "file" would make
 * the interesting half of the reference unsayable.
 *
 * TOTAL OVER THE SCHEMA, deliberately. Every grounded node can take a card
 * without the wiring inventing a mapping, and the glyph map below is exhaustive
 * over this union, so a kind cannot be added without being drawn — Decision 2's
 * rule that an icon meaning two things means neither.
 */
export type CodeCardKind =
  | 'file'
  | 'function'
  | 'module'
  | 'service'
  | 'datastore'
  | 'topic'
  | 'repo';

/** A one-based, inclusive line span, as the scanner reports it. */
export interface CodeCardLines {
  from: number;
  to: number;
}

/**
 * Everything a card draws, in one plain object.
 *
 * NOT `WbNodeRef`, and not an extension of it. The model's ref carries a
 * position and the discriminant `kind: 'noderef'`; this carries a grounding and
 * the node's OWN kind. Two different `kind` fields on one type would be a trap
 * for exactly the reader this card exists to serve, so the renderer takes its
 * own shape and the wiring does the (trivial) mapping. It also means the model
 * can gain `path` / `lines` / `excerpt` fields later, or not, without this
 * file having an opinion.
 */
export interface CodeCardItem {
  /** The board item's id. Not drawn — it is what a click is reported about. */
  id: string;
  /** The symbol or file name, as the reader should read it. */
  label: string;
  /** REPO-RELATIVE. An absolute path names a machine, not a codebase. */
  path: string;
  /** The graph node this points at. The pointer that makes it grounded. */
  nodeId: string;
  lines?: CodeCardLines;
  /** A short slice of the real source. Absent is the normal case. */
  excerpt?: string;
  kind?: CodeCardKind;
}

export interface CodeCardProps {
  item: CodeCardItem;
  selected?: boolean;
  /**
   * Absent means this card cannot be picked, and it is then drawn as a plain
   * region: no role, no tab stop, no pressed state. `Whiteboard.tsx` takes the
   * same stance on its `onAsk` — a control that is drawn but dead is worse than
   * one that was never drawn, because the reader spends a click finding out.
   */
  onSelect?: () => void;
}

/**
 * How many mono characters of path fit on one line of a `CODE_CARD_W` card.
 *
 * Measured off the ramp rather than guessed: `--t-11` JetBrains Mono advances
 * 0.6em, so 11px × 0.6 ≈ 6.6px a character, and 264 minus two `--sp-8` pads
 * leaves 248px ≈ 37 characters. 34 keeps a character of slack for the ellipsis
 * and for the fact that the estimate is an estimate. The CSS clip behind it is
 * what makes being wrong a cosmetic problem rather than an overflow.
 */
export const CODE_CARD_PATH_CHARS = 34;

export interface ElidedPath {
  /** The directory part, possibly elided, ending in a separator. May be ''. */
  head: string;
  /** The last segment. NEVER elided — see `elidePath`. */
  tail: string;
}

/**
 * Split a repo-relative path into a head that may be cut and a tail that may
 * not.
 *
 * ── WHY THIS IS JAVASCRIPT AND NOT `text-overflow: ellipsis` ──────────────
 *
 * CSS can only ellipsise from the END, and the end of a path is the half that
 * carries the information. `…/whiteboard/CodeCard.tsx` still answers "which
 * file?"; `packages/web2/src/whiteb…` answers nothing at all, and it answers
 * nothing while LOOKING like it answered — the worst failure available to a
 * surface whose whole claim is that it is grounded.
 *
 * The usual CSS trick for this is `direction: rtl`, and it is a trap: it is the
 * bidi algorithm, not a truncation rule, so `src/a.ts` reorders to `src/a.ts/`
 * and a path containing a digit run or a bracket scrambles. Two spans and a
 * character budget cannot do that.
 *
 * ── AND WHY THE TAIL IS NEVER CUT ─────────────────────────────────────────
 *
 * Even when the filename ALONE overruns the budget, it is returned whole and
 * the CSS clips it. A cut filename is a wrong answer; a clipped one is visibly
 * an incomplete answer, and the `title` attribute has the whole path anyway.
 *
 * Whole segments are dropped rather than characters, because half a directory
 * name (`…b2/src/`) reads as a typo, while a missing one reads as elision —
 * which is what the leading ellipsis is there to say.
 *
 * Backslashes are normalised the way `whiteboardKey` normalises them: this
 * repo is developed on Windows, and a path that arrives with `\` is the same
 * path.
 */
export function elidePath(raw: string, max: number = CODE_CARD_PATH_CHARS): ElidedPath {
  const path = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const segments = path.split('/');
  const tail = segments.pop() ?? '';
  if (segments.length === 0) return { head: '', tail };
  if (path.length <= max) return { head: `${segments.join('/')}/`, tail };

  /* The ellipsis costs two characters and they come out of the budget, not out
     of the card. Charged only on this branch: a path that FITS is never made to
     pay for a mark it will not carry. A tail longer than the whole budget
     drives this negative, the loop keeps nothing, and the filename is returned
     whole behind a bare `…/` — which is the rule, not a degenerate case. */
  const budget = max - tail.length - 2;
  const kept: string[] = [];
  let used = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const cost = segments[i]!.length + 1; // the segment and its separator
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(segments[i]!);
  }

  const dropped = kept.length < segments.length;
  const body = kept.length > 0 ? `${kept.join('/')}/` : '';
  return { head: dropped ? `…/${body}` : body, tail };
}

/**
 * The line range as the product says it everywhere else: `L12`, `L12–48`.
 *
 * Null rather than an empty string when there is no range, so the caller draws
 * NOTHING instead of an empty element — an empty span still takes a gap in a
 * flex row, which is how a card ends up with a hole nobody can explain.
 *
 * A reversed range is normalised rather than printed. The two numbers are the
 * same two numbers either way, so nothing is invented; but `L48–12` on a card
 * whose only job is to be trustworthy teaches the reader to stop trusting it.
 */
export function lineRangeLabel(lines: CodeCardLines | undefined): string | null {
  if (!lines) return null;
  const from = Math.min(lines.from, lines.to);
  const to = Math.max(lines.from, lines.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return from === to ? `L${from}` : `L${from}–${to}`;
}

/**
 * Strip the indentation every line shares, and nothing else.
 *
 * An excerpt lifted from four levels deep inside a class spends a third of a
 * 264px card on whitespace that says nothing — the relative shape of the code
 * is the part that carries meaning, and removing a COMMON prefix cannot change
 * it. Blank lines are ignored when measuring (a blank line has no indentation
 * to share) and left alone when cutting.
 */
function dedent(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n');
  let common = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    common = Math.min(common, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(common) || common === 0) return lines.join('\n');
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(common))).join('\n');
}

/**
 * The kind glyphs, at the book's geometry on the book's 24×24 grid.
 *
 * COPIED, NOT IMPORTED, and the repo has already ruled on which of those two
 * mistakes is cheaper. `canvas/index.ts` states outright that `BoardIcon` is
 * NOT re-exported — "a glyph vocabulary, not a surface … nothing outside this
 * lane should be holding a reference to it" when the shared `components/Icon`
 * lands — and `BoardIcon.tsx`'s own `x` entry records the precedent for the
 * copy: "Copying the path rather than inventing a second X is what keeps the
 * three sets one vocabulary instead of three." So the path data below is
 * byte-identical to `canvas/BoardIcon.tsx`'s, and the day a shared Icon exists
 * this map is deleted rather than migrated.
 *
 * `function` borrows `fn` and `repo` borrows `folder` — both are glyphs the
 * vocabulary already owns for exactly those meanings, which is the line sheet
 * 09 ruling 3 draws: borrowing a glyph the vocabulary does NOT have is
 * forbidden, drawing one it does is not.
 */
const GLYPHS: Record<CodeCardKind, ReactNode> = {
  file: (
    <>
      <path d="M13.6 3.6H7.6A2.4 2.4 0 0 0 5.2 6v12a2.4 2.4 0 0 0 2.4 2.4h8.8a2.4 2.4 0 0 0 2.4-2.4V8.4z" />
      <path d="M13.6 3.6v4.8h5.2" />
    </>
  ),
  function: (
    <>
      <path d="M9.8 4.4c-1.9 0-2.5 1-2.5 2.6v2.2c0 1.6-.8 2.8-2.4 2.8 1.6 0 2.4 1.2 2.4 2.8V17c0 1.6.6 2.6 2.5 2.6" />
      <path d="M14.2 4.4c1.9 0 2.5 1 2.5 2.6v2.2c0 1.6.8 2.8 2.4 2.8-1.6 0-2.4 1.2-2.4 2.8V17c0 1.6-.6 2.6-2.5 2.6" />
    </>
  ),
  module: (
    <>
      <rect x={3.6} y={3.6} width={16.8} height={16.8} rx={3.2} />
      <rect x={8.4} y={8.4} width={7.2} height={7.2} rx={1.6} />
    </>
  ),
  service: (
    <>
      <rect x={3.6} y={5} width={16.8} height={5.8} rx={2} />
      <rect x={3.6} y={13.2} width={16.8} height={5.8} rx={2} />
      <path d="M7 7.9h.01M7 16.1h.01" />
    </>
  ),
  datastore: (
    <>
      <ellipse cx={12} cy={6.2} rx={7.2} ry={2.6} />
      <path d="M4.8 6.2v11.6c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6V6.2" />
      <path d="M4.8 12c0 1.44 3.22 2.6 7.2 2.6s7.2-1.16 7.2-2.6" />
    </>
  ),
  topic: (
    <>
      <path d="M3.6 8.4h6.2M3.6 12h9.6M3.6 15.6h6.2" />
      <path d="m16.4 8.4 3.6 3.6-3.6 3.6" />
    </>
  ),
  repo: (
    <path d="M4 7.4A2.4 2.4 0 0 1 6.4 5h2.9l2.1 2.4h6.2A2.4 2.4 0 0 1 20 9.8v6.8A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z" />
  ),
};

/**
 * The word beside the glyph.
 *
 * `canvas/kinds.ts` keeps one vocabulary for the board's five kinds and this
 * agrees with it exactly where they overlap — `datastore` prints "Datastore",
 * never "Storage", which sheet 01.5 already settled once. The glyph is never
 * drawn alone: `BoardIcon`'s rule is that a glyph on these surfaces always sits
 * beside the words it illustrates, which is what lets every one of them be
 * `aria-hidden` instead of inventing a second name for the same fact.
 */
const KIND_WORDS: Record<CodeCardKind, string> = {
  file: 'File',
  function: 'Function',
  module: 'Module',
  service: 'Service',
  datastore: 'Datastore',
  topic: 'Topic',
  repo: 'Repo',
};

export function CodeCard({ item, selected = false, onSelect }: CodeCardProps) {
  const kind = item.kind ?? 'file';
  const { head, tail } = elidePath(item.path);
  const range = lineRangeLabel(item.lines);

  /* Whitespace-only counts as absent. An excerpt that arrives as '' or '\n'
     is the same fact as no excerpt, and rendering an empty scroller for it
     puts a bordered void on the card that reads as a failed load. */
  const excerpt = item.excerpt && item.excerpt.trim() !== '' ? dedent(item.excerpt) : null;

  const interactive = Boolean(onSelect);

  return (
    <div
      className="codecard"
      data-testid="code-card"
      data-kind={kind}
      data-node={item.nodeId}
      /* PRESENT BOTH WAYS, which is `WbItemView`'s own discipline: an attribute
         that only appears when true cannot be read from outside without first
         asking whether it is missing or false. */
      data-selected={selected ? 'true' : 'false'}
      data-interactive={interactive ? 'true' : 'false'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      /* The computed name from contents would read the whole excerpt aloud.
         Name and path are the two facts that identify the card. */
      aria-label={interactive ? `${item.label} — ${item.path}` : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
        /*
         * THE EXCERPT OWNS ITS OWN KEYS. It is a focusable scroll region, so
         * Space and the arrows belong to it while it has focus; letting them
         * bubble into "select this card" would make scrolling code select
         * something. `Whiteboard.tsx` draws the same line with
         * `isEditableTarget` — a control that owns text owns its keystrokes.
         */
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          /* Space scrolls the page by default, and a card that selects AND
             scrolls the board out from under itself reads as a bug. */
          event.preventDefault();
          onSelect();
        }
      }}
      style={
        {
          '--cc-w': `${CODE_CARD_W}px`,
          '--cc-max-h': `${CODE_CARD_MAX_H}px`,
        } as CSSProperties
      }
    >
      <div className="cc-head">
        <svg className="cc-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {GLYPHS[kind]}
        </svg>
        {/* THE NAME ELLIPSISES FROM THE RIGHT, and that is not an inconsistency
            with the path below it. A symbol's informative half is its head
            (`handleCheckoutRequest` → `handleCheckout…`); a path's is its tail.
            Same treatment for both would lose one of them. */}
        <span className="cc-name" data-testid="code-card-name" title={item.label}>
          {item.label}
        </span>
      </div>

      <div className="cc-path" data-testid="code-card-path" title={item.path}>
        <span className="cc-path-head">{head}</span>
        {/* `flex: none` in the sheet, so the filename cannot be squeezed out
            when the card is narrower than the character budget assumed. Belt
            and braces: the budget above handles the common case, this handles
            being wrong about it. */}
        <span className="cc-path-tail" data-testid="code-card-file">
          {tail}
        </span>
      </div>

      <div className="cc-meta">
        <span className="cc-kind" data-testid="code-card-kind">
          {KIND_WORDS[kind]}
        </span>
        {range ? (
          <span className="cc-lines" data-testid="code-card-lines">
            {range}
          </span>
        ) : null}
      </div>

      {excerpt ? (
        /*
         * `tabIndex={0}` because a scroll region only a mouse can reach is a
         * region a keyboard user cannot read, and the usability standard is
         * explicit that a feature which exists but cannot be reached is not
         * done. It is the only other tab stop on the card, and the keydown
         * guard above is what keeps its keys its own.
         */
        <pre className="cc-excerpt" data-testid="code-card-excerpt" tabIndex={0}>
          <code>{excerpt}</code>
        </pre>
      ) : null}
    </div>
  );
}
