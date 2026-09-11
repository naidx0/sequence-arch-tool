/* ══════════════════════════════════════════════════════════════════════════
   HOW TALL A CARD ACTUALLY IS — items 3.3 and 3.7
   packages/web2/src/canvas/cardBox.ts

   docs/brand/graphite/pages/02-the-architecture-node.html §02.3.

   THE DEFECT THIS EXISTS TO REMOVE. v1 routes every edge and computes every hit
   region against a HARDCODED 160 x 96 box — so on a one-line card the routing
   geometry is over-tall by up to 58px, and edges terminate on air. The card's
   height is content-driven; anything that reasons about the card's box has to
   be content-driven too, or the picture and the arithmetic describe two
   different boards.

   AND THE SAME DEFECT CAME BACK HERE, SMALLER, WHICH IS WHY THIS HEADER NO
   LONGER PRINTS THE SHEET'S LITERALS. Sheet 02.3 derives 56 / 75 / 99 from an
   anatomy that HAS NOT SHIPPED SINCE P2.6: a `.nd-hd` row (icon + mono kind
   tag) sitting ABOVE a `.nd-t` set at --lh-12. Neither class exists anywhere in
   web2 — grep them — and the icon is `position: absolute`, so it occupies no
   row at all. Quoting 56 as "the smallest card" is therefore quoting a card
   nobody can open. What 02.3 BINDS is the rule under the literals, and the rule
   survives its own arithmetic: "the floor may never exceed the natural height
   of the smallest legitimate card, or it is a fixed height wearing a floor's
   name."

   SO THE ROWS BELOW ARE THE DOM'S ROWS, MEASURED IN THE RUNNING APP against
   this monorepo at rung 1 (Chrome, devicePixelRatio 1, 2026-09-02):

     chassis     --sp-10 above and below + two --w-hair borders          = 22
     title only  + .nd-body's --sp-2 padding-top + --lh-14               = 45
     glance line + .nd-body's --sp-6 padding-top (the `with-sub`
                 variant, four MORE than title-only) + --lh-14
                 + the body's own --sp-4 column gap + --lh-11            = 68
     Visual on   + the card's --sp-4 column gap + the strip's own box
                 (`visualMeta.ts`, unchanged — it was already exact)     = 70
     anatomy     + the card's --sp-4 column gap + the wall (`anatomy.ts`)

   WHAT WAS THERE BEFORE: 38 for a title-only card and 57 with a glance line,
   which are the same fossil one layer down — 38 was right when `.nd-row` put
   the icon and the title on one --lh-12 line, and `.nd-row` is now labelled
   "Legacy row layout — only used in tests/specimens" in board.css. So the
   layout was positioning neighbours from a box SEVEN units shorter than the
   card, every card, on every board, while `cardBox.test.ts` was green — because
   every assertion in it checked this file's constants against the constants
   this file is built from. Both halves agreed with each other and neither had
   ever been compared to a rendered card. TWO FILES NOW MAKE THAT COMPARISON
   AND THEY ARE THE LOCKS THAT MATTER HERE: `boardRendered.test.ts`'s "the
   declared box is the painted card" measures a real Chromium's own
   `getBoundingClientRect` against `cardHeight`'s answer on four shapes, and
   `cardPainted.test.tsx` rebuilds the same four out of the rendered element
   tree and the live cascade for the machines where that browser is missing.

   THE CSS FLOOR IS PART OF THE SAME ANSWER. `--board-card-floor` was 56 — the
   dead anatomy's number — against a card whose natural height is 45, so the
   floor was holding eleven units of dead ground and was itself the thing 02.3
   forbids. It is now the natural title-only stack, derived from the same rows
   as `CARD_FLOOR` below, and `cardPainted.test.tsx` reads it back off the live
   cascade.
   ══════════════════════════════════════════════════════════════════════════ */

import type { LodRung } from '../state/types';
import type { BoardNode } from './NodeCard.js';
import { glanceLine } from './glanceLine.js';
import { visibilityAt, visibilityAtWithSubtitleBoost } from './lod.js';
import { visualExtraHeight } from './visualMeta.js';
import { anatomyExtraHeight, type AnatomyPanel } from './anatomy.js';
import { glanceFont, titleFont, wrappedLineCount, type TextMeasurer } from './textFit.js';

/* Token values, named rather than inlined. Every one is asserted against the
   live computed value in `cardBox.test.ts`, and every ROW they are summed into
   is asserted against a rendered card in `cardPainted.test.tsx`. */
const SP_2 = 2; // --sp-2 — .nd-body.title-only's padding-top
const SP_4 = 4; // --sp-4 — the column gap, on the card and inside the body
const SP_6 = 6; // --sp-6 — .nd-body.with-sub's padding-top
const SP_10 = 10; // --sp-10
const LH_11 = 15; // --lh-11 — the glance line's line box
const LH_14 = 21; // --lh-14 — the title's line box
const W_HAIR = 1; // --w-hair
const DOT = 6; // --dot

/** --arch-card-w. Width is FIXED, because a board reads as a board when its
 *  columns line up. Height is not, and must not be. */
export const CARD_W = 160;

/**
 * THE WIDTH TEXT ACTUALLY WRAPS IN, which is not the card's width.
 *
 * `.nd-body` sits inside the chassis, so the text box is the card minus its two
 * --sp-10 pads and two hairlines. `.nd-s` then takes `max-width: 92%` of that,
 * declared in board.css — so the glance line wraps EARLIER than the title does,
 * and measuring both against 138 would under-count exactly the strings that sit
 * near the boundary.
 */
export const CARD_CONTENT_W = CARD_W - SP_10 * 2 - W_HAIR * 2;
export const GLANCE_CONTENT_W = CARD_CONTENT_W * 0.92;

/** `.node`'s own frame: --sp-10 above and below, plus its two borders. Every
 *  row below sits inside this and nothing else does. */
const CHASSIS = SP_10 * 2 + W_HAIR * 2;

/**
 * THE FLOOR IS THE SMALLEST CARD THAT CAN ACTUALLY BE DRAWN, and 02.3 binds it
 * to exactly that: "the floor may never exceed the natural height of the
 * smallest legitimate card, or it is a fixed height wearing a floor's name."
 *
 * That card is the chassis plus one `.nd-body` holding one `.nd-t` — the
 * `title-only` variant, so --sp-2 of padding-top and one --lh-14 line box. It
 * is a FLOOR and not a height: the moment a card has a glance line, a strip or
 * a wall it is taller, and `--board-card-floor` in board.css is the same sum so
 * the CSS cannot hold ground the arithmetic does not.
 */
export const CARD_FLOOR = CHASSIS + SP_2 + LH_14;

/**
 * What the card in front of the reader actually measures, at the rung it is
 * drawn at.
 *
 * A DROPPED RUNG TAKES ITS ROOM WITH IT (sheet 08.2): "rung 1 is the only rung
 * that reserves --arch-card-min-h; every rung below it is content-tall, because
 * a card that has dropped its subtitle and still holds the room for it is a
 * block box with one line at the top and dead ground under it."
 */
export function cardHeight(
  node: BoardNode,
  rung: LodRung,
  visual = false,
  /* THE PANEL, NOT A BOOLEAN. What an open anatomy costs depends on whether it
     renders its zero-band note, which is a fact about the graph rather than the
     sheet — see `anatomyExtraHeight`. A boolean here under-reserved by 42 units
     on every container with an empty child. */
  anatomy: Pick<AnatomyPanel, 'zeroCount' | 'bucketUnnamed'> | null = null,
  /* THE MEASURER, INJECTED SO THE ARITHMETIC STAYS TESTABLE. Production passes
     nothing and gets the shared offscreen canvas; a test can hand in a stub with
     a known face and assert the row count without owning a browser. */
  measure?: TextMeasurer,
): number {
  const line = glanceLine(node.subtitle, node.annotation);
  const show = visibilityAtWithSubtitleBoost(rung, Boolean(line));

  if (!show.card) return DOT;

  // The chassis: padding top and bottom, plus the two borders.
  let height = CHASSIS;

  /* ── `.nd-body`, AND IT IS ONE BOX WITH A VARIABLE LID ──────────────────
     `NodeCard` renders the body under exactly this condition and gives it
     exactly one of two classes, and board.css gives those two DIFFERENT
     padding-tops (--sp-2 vs --sp-6). That four-unit step is a row of its own
     and it was not in the old arithmetic at all — which is why a glance line
     costs 23 here and not the 19 a reading of `--sp-4 + --lh-11` alone
     suggests. THE ICON IS NOT IN THIS SUM: `.nd-ic` is `position: absolute`
     and takes no row. */
  const glance = show.subtitle && Boolean(line);
  const titleRow = show.title || show.shortTitle;
  if (titleRow || glance) {
    height += glance ? SP_6 : SP_2;
    /* `.nd-t`. The condensed far-zoom title takes the SAME line box: board.css
       declares `.nd-t-short` at --t-11/1.15 BEFORE `.nd-t`, at equal
       specificity, so `.nd-t`'s --lh-14 wins on source order. Measured at rung
       5 in the running app: 21, not 12.65. */
    /* EVERY LINE THE ROW TAKES, NOT ONE. Both rows wrap, and reserving a single
       line box was the last place the declared card was shorter than the painted
       one: measured in the running app, `svc:web2` declared 68 and painted 83
       because "packages web2 · packages web2 test" fills two --lh-11 boxes.

       `.nd-t` is unbounded (`overflow-wrap: anywhere`, no clamp); `.nd-s` is
       `-webkit-line-clamp: 2`, so it is capped at two and a third row would be
       dead ground under ink the browser truncates. Where the text cannot be
       measured — jsdom has no 2D context — `wrappedLineCount` returns 1 and this
       is byte-identical to the arithmetic it replaced. */
    if (titleRow) {
      height += LH_14 * wrappedLineCount(node.label, CARD_CONTENT_W, titleFont(), measure);
    }
    /* The glance line — annotate or English subtitle, never both, never a path
       dump. A5.2: detailed cards keep the line one rung longer (boost). The
       --sp-4 is the BODY's own column gap and only exists when both rows do. */
    if (glance) {
      height +=
        (titleRow ? SP_4 : 0) +
        LH_11 * wrappedLineCount(line!, GLANCE_CONTENT_W, glanceFont(), measure, 2);
    }
  }
  /* Footer (provenance / counts) only paints when the card is selected. Do not
     reserve it in the rest layout — that re-clumps every card for ink that is
     not shown at first glance. */

  /* VISUAL MODE'S STRIP IS THE ONE ROW THAT IS DRAWN AT REST, so it is the one
     row that must be reserved. The footer above is reserved by nothing because
     it appears behind a click and re-flowing the board on selection would move
     every other card; the strip appears the moment Visual is on, and a strip
     that is painted without room is a card whose text overflows its own border
     — which is precisely what the legibility gate exists to catch.

     GATED ON `show.footer`, the same --t-10 rung the strip renders at, so a
     zoomed-out board reserves nothing for ink it is not drawing. */
  if (visual && show.footer) height += visualExtraHeight(node);

  /* ANATOMY IS A FOOTPRINT, SO IT IS GEOMETRY BEFORE IT IS PAINT.
     The wall is a real 129px-tall object inside the card. Painting it without
     reserving it would put a treemap over the card's own border and over the
     cards below — the same class of disagreement this file's header opens with,
     only larger. It grows the card DOWNWARD only: width stays --arch-card-w, so
     opening one node never breaks the column rhythm. Not gated on a rung: the
     wall opens because a reader asked for it, and a reader who asked for it at
     a far zoom is asking to see it. */
  height += anatomyExtraHeight(anatomy);

  const floored = Math.max(height, CARD_FLOOR);

  /* P2.6: unified chassis — module no longer reserves a folder-tab margin. */
  return floored;
}

/** The box the layout and the router reason about. One function, so a hit
 *  region, an edge endpoint and a fit-bounds can never disagree about where a
 *  card is. */
export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * HOW MANY CARDS AN ANNOTATION MAKES TALLER AT THIS RUNG.
 *
 * `cardHeight` reserves an annotation's line only where the subtitle shows
 * (`show.subtitle && node.annotation`), so anything that keys a layout on "how
 * many cards carry English" must ask the same question through the same ladder
 * or it will spend a relayout on boxes that did not move. One function, so the
 * count and the room cannot disagree — finding F6.
 */
export function annotatedCountForLayout(nodes: readonly BoardNode[], rung: LodRung): number {
  return nodes.filter((node) => {
    const line = glanceLine(node.subtitle, node.annotation);
    return Boolean(line) && visibilityAtWithSubtitleBoost(rung, true).subtitle;
  }).length;
}

export function cardBox(
  node: BoardNode,
  position: { x: number; y: number },
  rung: LodRung,
  visual = false,
  anatomy: Pick<AnatomyPanel, 'zeroCount' | 'bucketUnnamed'> | null = null,
  measure?: TextMeasurer,
): CardBox {
  return {
    id: node.id,
    x: position.x,
    y: position.y,
    w: visibilityAt(rung).card ? CARD_W : CARD_W,
    h: cardHeight(node, rung, visual, anatomy, measure),
  };
}
