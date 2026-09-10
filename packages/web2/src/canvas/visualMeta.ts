/* ══════════════════════════════════════════════════════════════════════════
   WHAT VISUAL MODE SHOWS THAT THE PLAIN CARD COLLAPSES
   packages/web2/src/canvas/visualMeta.ts

   docs/decisions/visual-board-mode-madr.md §0, amendment A2. Max, 2026-09-02:

     "that creates the React diagram based off the JSON diagram in more detail
      … they can showcase more than just a simple JSON sequence diagram."

   AND THE LINE IMMEDIATELY UNDER IT, WHICH IS THE HARD LIMIT: Visual "may
   render structure the spec already carries but the plain view collapses …
   It may not invent." Every field below is read off a `BoardNode` that
   `project.ts` already built out of the document. Nothing is computed, nothing
   is defaulted, and there is no zero — an absent part list is `null`, never
   `[]`, because "we looked and there are none" and "nobody looked" are
   different sentences and the card must not say the first when it means the
   second.

   ── WHAT THE PLAIN CARD ACTUALLY COLLAPSES, MEASURED AGAINST `NodeCard` ────

     the KIND WORD      never printed on a card at all. `kinds.ts`'s
                        `silhouetteLabel` is consumed only by `KindLegend`, so
                        the card carries kind as an icon and an outline and the
                        reader has to go to the legend to get the word.
     PROVENANCE         drawn behind a click — `NodeCard`'s `detail = selected`
                        gate. Whether a node was traced or merely declared is
                        the strongest honesty signal this product has, and at
                        rest it is invisible.
     THE PART COUNT     same gate, and it is itself a collapse: `12 parts` is
                        what is left of twelve names the document is carrying.
     THE PART NAMES     rendered by nothing, anywhere.

   ── WHY THIS FILE IS NOT IN THE LAZY CHUNK ────────────────────────────────

   `cardBox.ts` has to know how tall a visual card is BEFORE the card renders —
   ELK is fed boxes and the router terminates edges on them, and a height that
   arrives one chunk later is the 160x96 hardcode defect that `cardBox.ts`'s own
   header exists to describe. So the arithmetic and the row decision live here,
   on the main thread's path, and only the RENDERING is deferred
   (`visual/VisualMetaStrip.tsx`). The measured cost of that split is in the
   wave's notes; it is a few hundred bytes, and the alternative is an edge that
   ends in mid-air until a dynamic import resolves.
   ══════════════════════════════════════════════════════════════════════════ */

import type { BoardNode } from './NodeCard.js';
import { silhouetteLabel } from './kinds.js';

/** Everything the visual strip draws, already resolved to what goes on screen. */
export interface VisualMeta {
  /** The kind's own word — `silhouetteLabel`, the vocabulary the legend uses. */
  kind: string;
  /** Sheet 03.7: entry is a POSITION grafted over a kind, never a sixth kind,
   *  so it is a second word rather than a replacement for the first. */
  entry: boolean;
  /** `traced` / `declared` / absent — `project.ts`'s `provenanceOf` verbatim. */
  provenance: BoardNode['provenance'];
  /** The one count, already rendered as text by whoever computed it. */
  count: BoardNode['count'];
  /** The names the document carries, or null. Never an empty array. */
  parts: readonly string[] | null;
}

export function visualMetaFor(node: BoardNode): VisualMeta {
  const parts = node.parts && node.parts.length > 0 ? node.parts : null;
  return {
    kind: silhouetteLabel(node.present.kind),
    entry: node.present.entry,
    provenance: node.provenance,
    count: node.count,
    parts,
  };
}

/**
 * The extra height a visual card takes, in the sheet's own arithmetic.
 *
 * THE STRIP IS SHEET 02.3's FOOTER, REUSED RATHER THAN RE-DERIVED. 02.3 derives
 * the tallest card as `75 + --sp-4 (the column gap) + --sp-4 (the footer's own
 * padding-top) + a 16px .prov = 99`, i.e. the footer costs 24. The visual strip
 * is that same row drawn at rest instead of on selection, plus the one hairline
 * rule that separates it — so it costs 25, and no new number enters the ramp.
 *
 * THE PARTS LINE IS NOT IN THIS NUMBER, AND THAT IS THE SETTLED RULE RATHER
 * THAN AN OVERSIGHT. `glanceLine.ts` records the owner's call of 2026-08-25
 * verbatim: "at first glance the card should read via icon, shape, and clear
 * English — not a path dump, inventory list, or second echo of the name. Detail
 * (paths, parts, provenance) waits for select / expand."
 *
 * MEASURED ON THIS MONOREPO, WHICH IS WHY IT IS OBEYED HERE. With the parts
 * drawn at rest, `svc:analyzer` read
 * `packages\analyzer\src · Packages\analyzer\src\explain\explain · …` on the
 * face of the card — the exact path dump that ruling names, in the exact slot
 * it names. So Visual spends its resting row on kind, provenance and the count
 * (short words, and what A2 names first), and the NAMES open on selection,
 * which is where that ruling puts them.
 *
 * Selection-time rows are deliberately not reserved, for the reason `cardHeight`
 * already gives about the footer: reserving them would re-flow every card on a
 * board the moment one is clicked.
 */
const SP_4 = 4; // --sp-4
const W_HAIR = 1; // --w-hair
const PROV_H = 16; // the .prov chip, board.css `.board-scope .prov` — `height: 16px`
/* --t-10 at `line-height: 1`, which is what board.css sets on every other item
   this row can hold: `.nd-meta-kind`, `.nd-meta-pos` and `.nd-meta .mono`. So a
   row with no .prov chip in it is a 10px line box, not a 16px one. */
const T_10 = 10;

/**
 * THE HAIRLINE IS IN THE ARITHMETIC, and it is the reason this is 25 and not
 * the footer's 24. The strip carries a `border-top: var(--w-hair)` — the one
 * separator Graphite law 1 permits, since a rule is structure and structure is
 * never coloured. A border is a painted pixel; leaving it out of the height
 * would make the card one pixel taller than the box ELK and the edge router
 * were handed, which is the same class of disagreement `cardBox.ts`'s header
 * opens with, only smaller.
 */
export const VISUAL_STRIP_H = SP_4 + W_HAIR + SP_4 + PROV_H;

/**
 * The same strip with NO provenance chip on it, which is a shorter row.
 *
 * The row is `align-items: center` with no height of its own, so it is as tall
 * as its tallest child. `.prov` declares `height: 16px`; the kind word, the
 * position word and the count are all --t-10 at `line-height: 1`. Drop the chip
 * and the row is 10px of text, not 16.
 */
export const VISUAL_STRIP_WORDS_H = SP_4 + W_HAIR + SP_4 + T_10;

/**
 * How much taller this node's card is in Visual mode at a rung that draws the
 * strip — the row it will PAINT, not the tallest row it could paint.
 *
 * IT TAKES THE NODE BECAUSE THE ANSWER DEPENDS ON THE NODE, and the first cut
 * of this function did not: it tested `visualMetaFor(node).kind`, and
 * `silhouetteLabel` is a total Record with no empty value, so that test could
 * never be false and every card reserved the full 25 unconditionally. A node
 * the reader drew on the board (`docEdit`) has no `evidenceRef`, so `project.ts`
 * gives it `provenance: null`; its strip is the kind word alone, it paints 21,
 * and it was handed 25 — six pixels of dead ground under one line, which is
 * sheet 08.2's "block box with one line at the top and dead ground under it",
 * the exact shape this function's own header said it existed to be able to
 * refuse.
 *
 * THE DIRECTION OF THE ERROR MATTERS AND IS WHY THIS IS DERIVED RATHER THAN
 * ROUNDED UP. Under-reserving is the harmful direction — a row painted taller
 * than the box ELK and the router were handed is text over its own border — so
 * the answer is the row's real composition (the chip's 16 when there is a chip,
 * the --t-10 line box when there is not) and never a guess in either direction.
 *
 * There is no 0 case and this no longer pretends there is: the kind word is
 * always present, so the strip always draws and the floor is the words' row.
 */
export function visualExtraHeight(node: BoardNode): number {
  return visualMetaFor(node).provenance ? VISUAL_STRIP_H : VISUAL_STRIP_WORDS_H;
}
