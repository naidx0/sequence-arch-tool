/* ══════════════════════════════════════════════════════════════════════════
   THE VISUAL STRIP — the rows Visual mode adds to a card
   packages/web2/src/canvas/visual/VisualMetaStrip.tsx

   docs/brand/graphite/pages/02-the-architecture-node.html §02.1 (the .prov
   chip and the footer row this reuses) and
   docs/brand/graphite/pages/03-node-kinds-without-hue.html (the kind word is
   `silhouetteLabel`'s, so the card and the legend cannot drift apart).

   ── THIS FILE IS THE LAZY CHUNK, AND THAT IS THE WHOLE POINT ───────────────

   The MADR's cost clause: "everything Visual-only is lazy-loaded, so a reader
   who never flips the switch pays nothing", measured the way
   `ReactCanvasMount.tsx` measured Babel. `Board.tsx` reaches this module
   through `React.lazy`, so it is a separate chunk and a board with Visual off
   never requests it.

   WHAT IS DELIBERATELY NOT IN HERE is the arithmetic — `visualMeta.ts` decides
   which rows exist and how tall they are, on the main path, because `cardBox`
   feeds ELK and the edge router before any dynamic import could resolve. See
   that file's header.

   ── EVERY FIELD IS READ, NONE IS COMPUTED ─────────────────────────────────

   MADR A2 permits "structure the spec already carries but the plain view
   collapses" and forbids inventing "a node, an edge, or a number". So: the kind
   word comes from `kinds.ts`'s own table, the provenance word is
   `project.ts`'s `provenanceOf` answer verbatim, the count is the string
   `project.ts` already built out of `detail.parts.length`, and the part names
   are that same array in the document's order. There is no `?? 0`, no
   `|| 'unknown'`, and no branch that fills a slot rather than dropping it.

   ── THE PART NAMES OPEN ON SELECTION, AND THAT IS A SETTLED RULING ────────

   `glanceLine.ts` carries the owner's call of 2026-08-25 verbatim: "Detail
   (paths, parts, provenance) waits for select / expand." Drawn at rest on this
   monorepo the line read
   `packages\analyzer\src · Packages\analyzer\src\explain\explain · …` — the
   exact path dump that ruling names. A2 is the newer and more specific ruling
   and it is what puts KIND, PROVENANCE and the COUNT on the resting card;
   it says nothing that overturns where the path list belongs, so the names
   stay behind the click.

   ONE LINE, ELLIPSISED, WITH THE WHOLE LIST ON HOVER. Not a wrap: a card whose
   height depends on how many children a service happens to have re-packs the
   board every time the scan changes, and `cardBox` would have to measure text
   to predict it. Not a "+N more" either — that is a settled owner dislike ("any
   '+N more' that cannot be reached"). The count chip above already says how
   many there are, so the line is never mistaken for the whole list. Same idiom
   as `edgeTag` / `labelFull` on the connectors.

   ITS ROW IS NOT RESERVED, deliberately, and `visualMeta.ts` says why: the
   plain footer already appears on selection without reserved room, because
   reserving it would re-flow every card on the board the moment one is clicked.
   ══════════════════════════════════════════════════════════════════════════ */

import type { BoardNode } from '../NodeCard.js';
import { visualMetaFor } from '../visualMeta.js';

/** The separator the rest of this package already uses between peer facts. */
const PART_SEP = ' · ';

export function VisualMetaStrip({
  node,
  selected = false,
}: {
  node: BoardNode;
  selected?: boolean;
}) {
  const meta = visualMetaFor(node);
  const parts = selected ? meta.parts : null;

  return (
    <>
      <div className="nd-meta" data-testid="board-node-meta">
        {/* THE WORD IS ON `title` BECAUSE THE WORD CAN BE CUT. Entry and Topic
            cards take --sp-20 side padding for their silhouettes, which leaves
            this row 118px instead of 138 — measured on this monorepo, an entry
            service wanted 149. `board.css` lets these two words ellipsise
            (they are the only items here that another channel already carries)
            and the gate's rule is "nothing is clipped SILENTLY", so the full
            word is one hover away — the `.nd-parts` / `labelFull` idiom. */}
        <span className="nd-meta-kind" title={meta.kind}>
          {meta.kind}
        </span>
        {/* Sheet 03.7 — the reader is told both facts and neither replaces the
            other, so Entry sits BESIDE the kind rather than instead of it. */}
        {meta.entry ? (
          <span className="nd-meta-pos" title="Entry">
            Entry
          </span>
        ) : null}
        {meta.provenance ? (
          <span
            className={`prov ${meta.provenance === 'traced' ? 'p-measured' : 'p-declared'}`}
            data-provenance={meta.provenance}
            data-testid="board-node-provenance"
          >
            {meta.provenance === 'traced' ? 'Traced' : 'Declared'}
          </span>
        ) : null}
        {meta.count ? (
          <span className="right mono" data-testid="board-node-count" title={meta.count.label}>
            {meta.count.value}
          </span>
        ) : null}
      </div>
      {parts ? (
        <div
          className="nd-parts"
          data-testid="board-node-parts"
          /* The whole list, so nothing the card had to cut is unreachable. */
          title={parts.join(PART_SEP)}
        >
          {parts.join(PART_SEP)}
        </div>
      ) : null}
    </>
  );
}

export default VisualMetaStrip;
