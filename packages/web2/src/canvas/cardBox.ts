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

   DECISION 49 (the reskin) REPLACED THE ROWS BELOW WITH ONE: the card is
   the chassis plus `.nd-in`, a 30px icon chip beside a text column of two
   reserved --lh-14 title lines, --sp-2 and one --lh-11 definition line
   (22 + 59 = 81). The table that follows
   is the history of how the old rows were measured; `cardHeight` is current.

   SO THE ROWS BELOW WERE THE DOM'S ROWS, MEASURED IN THE RUNNING APP against
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
import { measureWithCanvas, titleFont, type TextMeasurer } from './textFit.js';
import { displayLabel } from './displayLabel.js';
import { TITLE_LINES, boardTitleFit } from './titleFit.js';

/* Token values, named rather than inlined. Every one is asserted against the
   live computed value in `cardBox.test.ts`, and every ROW they are summed into
   is asserted against a rendered card in `cardPainted.test.tsx`. */
const SP_10 = 10; // --sp-10
const LH_14 = 21; // --lh-14 — the title's line box
const LH_11 = 15; // --lh-11 — the definition's line box
const SP_2 = 2; // --sp-2 — the gap between the title and the definition
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

/**
 * THE ICON CHIP AND ITS GAP, BESIDE THE WORDS (Decision 49). `.nd-ic` is a
 * 30px chip and `.nd-in` puts --sp-10 between it and the text column, so the
 * title wraps in the card's content width less these 40 units. On the far
 * rungs the chip is scaled with the words, so the inset is in the row's own
 * (unscaled) units there too.
 */
export const CHIP_INSET = 30 + SP_10;

/** The widest a card grows to hold its own name. Past it the title wraps (and
 *  at far zoom the condensed title takes an ellipsis): a last resort. */
export const CARD_MAX_W = 184;
/**
 * THE NARROWEST MEASURED CARD (Decision 49, the picked mix's card, about
 * 168-184 wide). Where text cannot be measured (jsdom) the card is CARD_W.
 *
 * MEASURED, NOT PICKED (coordinator, 2026-10-06): 200-260 wide cards with
 * one-line names, and far boxes widened to keep that shape, fitted shopfront
 * at 45% in an 801px pane and painted the far titles at 9.5px (5.3px at
 * 1024x700): wider boxes cost fit zoom faster than they buy screen size,
 * because the layout's gaps do not grow with them. So the card is narrow, the
 * name takes its two reserved lines, and the far row is counter-scaled in the
 * card's own box (see `boardFarScale`).
 */
export const CARD_MIN_W = 168;
/** Room beside the title for the status dot and its gap. */
const TITLE_SLACK = 8;
/**
 * The zoom the name must still fit at, held at its screen size. Below the
 * full-title rung (lod.ts, 0.67) the far title is counter-scaled to hold its
 * screen size, and where the card is too narrow for that the title is drawn
 * smaller: at 1024x700 shopfront fits at 43% and "Notifications", "Postgres
 * database" and "Order Created messages" painted at 9-10 px beside a 14 px
 * "Shipping" (round 3 review). So the card is widened for the zoom a pane
 * that size fits at, not the text shrunk; CARD_MAX_W still bounds it.
 */
export const FAR_FIT_ZOOM = 0.45;

/**
 * THE CARD IS AS WIDE AS ITS NAME, between --arch-card-w and CARD_MAX_W:
 * wide enough that the icon chip and the name fit on one line at 100%.
 *
 * DECISION 49 DROPPED THE FAR-ZOOM WIDENING. It used to widen every card so
 * its far title, held at screen size, fitted one line at FAR_FIT_ZOOM; with
 * the chip beside the words that made nearly every card CARD_MAX_W wide, the
 * board wider, its fit lower and every title smaller (measured on shopfront
 * at 1440x900: the fit fell to 56% and the far titles painted near 11px). A
 * card sized for its near line lets the board fit higher; on the far rungs
 * the name takes its two reserved lines instead (titleFit.ts), and the
 * definition keeps its own line under them. FAR_FIT_ZOOM still caps the
 * far scale (`farTitleScaleMax`).
 *
 * Measured before layout with the same face the title paints in, so ELK, the
 * router and the painted card agree. Rounded up to the 8px grain. Where text
 * cannot be measured (jsdom) the answer is the fixed width, as before.
 */
const widthMemo = new Map<string, number>();
export function cardWidth(label: string, measure: TextMeasurer = measureWithCanvas): number {
  const text = displayLabel(label);
  if (!text) return CARD_W;
  const font = titleFont();
  const memoKey = measure === measureWithCanvas ? `${font}\u0000${text}` : null;
  const memo = memoKey === null ? undefined : widthMemo.get(memoKey);
  if (memo !== undefined) return memo;
  const ink = measure(text, font);
  if (!Number.isFinite(ink)) return CARD_W;
  const pad = SP_10 * 2 + W_HAIR * 2;
  const need = Math.ceil((ink + pad + TITLE_SLACK + CHIP_INSET) / 8) * 8;
  const out = Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, need));
  if (memoKey !== null && widthMemo.size < 5000) widthMemo.set(memoKey, out);
  return out;
}

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
export const CARD_FLOOR = CHASSIS + LH_14 * TITLE_LINES + SP_2 + LH_11;

/** `.nd-tx`'s height: two reserved title lines, the gap, the definition line. */
export const CARD_TEXT_H = LH_14 * TITLE_LINES + SP_2 + LH_11;

/**
 * THE FAR TITLE'S LARGEST SCALE ON A BOARD (S4 review, item 1).
 *
 * On the far rungs (4-5) the condensed title is counter-scaled to hold its
 * screen size. Its height was never reserved, so a two-line far title
 * ("Notifications service" at 56%) painted 74 units in a 45-unit box. The
 * scale is now capped at the smaller of the board's two-line title fit
 * (titleFit.ts) and 1/FAR_FIT_ZOOM, the zoom a name must still fit at held
 * at its screen size; board.css applies the same cap (--far-fit carries it).
 * A box that holds the title at that scale holds it at every far zoom,
 * because a smaller scale never takes more lines. Below FAR_FIT_ZOOM the
 * title shrinks with its card instead of outgrowing it.
 */
export function farTitleScaleMax(fit: number): number {
  return Math.min(fit, 1 / FAR_FIT_ZOOM);
}

/** The board's far-title scale ceiling, from the same fit Board.tsx paints
 *  with. Undefined where text cannot be measured (jsdom). */
export function boardFarScale(nodes: readonly BoardNode[], measure: TextMeasurer = measureWithCanvas): number | undefined {
  /* The words (title and definition) are counter-scaled beside the chip,
     which keeps its own size (it is a glyph, not type), never past the scale
     at which every name on the board still fits its two reserved lines in
     the room the chip leaves. */
  const font = titleFont();
  const fit = boardTitleFit(
    nodes
      .filter((n) => !n.group)
      .map((n) => ({ text: displayLabel(n.label), contentW: cardWidth(n.label, measure) - SP_10 * 2 - W_HAIR * 2 - CHIP_INSET })),
    (t) => measure(t, font),
  );
  return fit === undefined ? undefined : farTitleScaleMax(fit);
}

/** Drop every memoised card width: the face they were measured in changed
 *  (a font finished loading after a card was sized). */
export function clearCardWidthMemo(): void {
  widthMemo.clear();
}

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
  /* THE MEASURER. Since Decision 49 the height no longer depends on how the
     words wrap (two reserved lines, the definition inside them), so it is
     unread here; kept so every caller's argument list stays as it was. */
  _measure?: TextMeasurer,
  /* The board's far-title scale ceiling (`boardFarScale`). On the far rungs
     the title row reserves the condensed title at that scale. */
  farScale?: number,
): number {
  const line = glanceLine(node.subtitle, node.annotation);
  const show = visibilityAtWithSubtitleBoost(rung, Boolean(line));

  if (!show.card) return DOT;

  // The chassis: padding top and bottom, plus the two borders.
  let height = CHASSIS;

  /* ── `.nd-in`: THE CHIP AND THE WORDS ────────────────────────────────
     Decision 49's card is one row: a 30px icon chip beside a text column
     that reserves two title lines (Decision 48), the --sp-2 gap and the
     one-line definition, on every card: a row of boxes is one height
     whether its names wrap or not, and the words sit centred in it. On the
     far rungs the row is counter-scaled as one piece, so it is reserved at
     the board's largest far scale (`farTitleScaleMax`). The chip (30) is
     never taller than the column (59), so it adds no row. */
  const titleRow = show.title || show.shortTitle;
  if (titleRow && !show.title && farScale) {
    height += Math.ceil(CARD_TEXT_H * farScale);
  } else {
    height += CARD_TEXT_H;
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
  /** An expanded group's frame. Edges may cross it; it is never an obstacle. */
  container?: boolean;
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
export function annotatedCountForLayout(_nodes: readonly BoardNode[], _rung: LodRung): number {
  /* DECISION 49: the annotation takes the definition line every card already
     reserves, at every rung, so no card is taller for one and no annotation
     may spend a relayout. Kept as a function so the layout key's call site
     says what it is asking. */
  return 0;
}

export function cardBox(
  node: BoardNode,
  position: { x: number; y: number },
  rung: LodRung,
  visual = false,
  anatomy: Pick<AnatomyPanel, 'zeroCount' | 'bucketUnnamed'> | null = null,
  measure?: TextMeasurer,
  farScale?: number,
): CardBox {
  return {
    id: node.id,
    x: position.x,
    y: position.y,
    w: visibilityAt(rung).card ? cardWidth(node.label, measure) : CARD_W,
    h: cardHeight(node, rung, visual, anatomy, measure, farScale),
  };
}
