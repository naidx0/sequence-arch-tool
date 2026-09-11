/* ══════════════════════════════════════════════════════════════════════════
   THE LEVEL-OF-DETAIL LADDER — item 3.8
   packages/web2/src/canvas/lod.ts

   THE SHEET THIS IMPLEMENTS IS
   docs/brand/graphite/pages/05-the-canvas.html §05.8, and only that one.

   THE ONE RULE: labels are HIDDEN at low zoom, never shrunk. Working type is
   10/11/12 and 10 is the floor, so a rung authored at --t-N paints at N x zoom
   device pixels, and the moment that product falls below the floor the rung
   goes — not scaled, not substituted, not ellipsised. Every threshold below is
   --t-10 divided by the rung's own authored size. There is no new number in
   the ladder at all.

   §05.8's table, verbatim, is the whole ladder:

     .edgetag / .nd-k / .prov / .nd-ft   --t-10      --t-10 / --t-10   1.00
     .nd-s — the subtitle                --t-11      --t-10 / --t-11   0.91
     .nd-t — the title                   --t-12      --t-10 / --t-12   0.83
     the kind icon                       1.5 stroke  --w-hair / 1.5    0.67
     silhouette, border treatment, tone  geometry    none              0.25

   and its drawn card is captioned "< 0.67 · silhouette only".

   ── READ THE LAST ROW CAREFULLY ─────────────────────────────────────────────

   Its threshold column says **none**. The silhouette has no threshold of its
   own: it is geometry, not type, so there is no size at which it falls under
   the type floor. The 0.25 in the "Holds to" column is `ZOOM_MIN` from
   camera.ts — §05.9 assertion 5, "Zoom is clamped to 0.25 … 4.00 on every path
   — gesture, button, key and fit alike." The row is therefore saying that the
   silhouette outlives the camera: at EVERY zoom this board can reach, the card
   is drawn and its outline is still naming the kind. There is exactly one
   handoff in the ladder, at 0.67, and it is silhouette-and-icon to
   silhouette-alone.

   ── WHAT THIS FILE USED TO SAY, AND WHY IT IS GONE ──────────────────────────

   A previous revision shipped a THIRD ladder that neither sheet states: the
   icon gone at 0.667, the silhouette gone at 0.50, and "nothing on the card"
   from 0.354 down. At zoom 0.30 the sheet draws a silhouette and this module
   drew nothing; at 0.25 — a stop the zoom buttons land on — it drew a dot. Both
   extra numbers were this module's own arithmetic (half a card from _core.html's
   `.silswatch`, and the box that would hold an .i-14 glyph), and `lod.test.ts`
   asserted them, which is CANON §6's named failure mode: the test locked the
   invention rather than the invariant.

   CANON's precedence table settles it — a Graphite sheet wins anything visual,
   over any other document and over any lane's reading of it. §05.8 states an
   explicit numeric table; §08.2 states a prose generalisation. §05.8 wins, and
   is what is implemented here.

   ── THE CONTRADICTION IS REAL, AND IT IS OWED UPWARDS, NOT PATCHED HERE ─────

   §08.2 says: "the silhouette carries it to half a card and no further, the
   icon carries it below that, and below the icon nothing does." Under §05.8's
   own numbers that hand-off cannot happen — the icon's floor (0.67) is ABOVE
   any half-card reading, so the icon is already gone before the silhouette
   could reach a limit. The two sheets genuinely disagree, and the disagreement
   is arithmetic rather than taste.

   It is recorded as **Open question 1** in docs/brand/GRAPHITE-DECISIONS.md,
   which is the only sanctioned way to change the book. It is NOT fixed by
   editing a sheet: a sheet is never edited to encode a ruling that is not
   written there first.
   ══════════════════════════════════════════════════════════════════════════ */

import { ZOOM_MIN } from './camera.js';
import { STROKE, T_FLOOR, T_SUBTITLE, T_TITLE, W_HAIR } from './typeRamp.js';
import type { LodRung } from '../state/types';

/* ── the token values every threshold is derived from ──────────────────────
   These are read off tokens/graphite.css, and `lod.test.ts` asserts each one
   against the LIVE computed value rather than trusting this list: a copy of a
   token is a second source of truth, and the test is what stops it drifting
   into one. They are plain numbers rather than a `font-size` declaration, so
   the firewall's rule 4 is untouched — the ladder is arithmetic about type,
   not a declaration of it.

   There is deliberately NO card-geometry constant in this list any more. The
   two that used to be here read --arch-card-min-h as the card's floor, which
   is the second of the two jobs sheet 08.1 gives that one token — see Open
   question 2 in docs/brand/GRAPHITE-DECISIONS.md. §05.8 needs no card
   dimension to state its ladder, so this module no longer holds one.

   THEY NOW LIVE IN `typeRamp.ts` RATHER THAN HERE, and that move is the whole
   of item canvas-fixes 1's first half. Sheet 05.5 says the auto-fit floor is
   "one number derived from" the type floor, so `camera.ts` needs --t-10 and
   --t-12 too — and `lod.ts` cannot be the module it takes them from, because
   this file imports ZOOM_MIN from `camera.ts` and the reverse edge closes an
   ES-module cycle. A leaf with no imports of its own cannot. Nothing about the
   ladder below changed; the five numbers are the same five numbers. */

/**
 * The five rungs of sheet 05.8, as the zoom AT OR ABOVE WHICH the rung holds.
 *
 * Read the list as a staircase: a rung holds while zoom >= its own floor and
 * below the floor of the rung above it. `rungFor` is the only thing that should
 * ever compare against these, so a renderer never re-derives a threshold.
 */
export interface LodStep {
  rung: LodRung;
  /** Zoom at or above which this rung is the live one. */
  floor: number;
  /** What this rung gives up relative to the one above it. */
  drops: string;
  /** What carries kind at this rung. The honest answer, not the hopeful one. */
  carries: string;
  /** The arithmetic, so nobody has to trust the number. */
  derivation: string;
}

export const LOD_LADDER: readonly LodStep[] = [
  {
    rung: 1,
    floor: T_FLOOR / T_FLOOR,
    drops: 'nothing — the full card',
    carries: 'silhouette, icon and the mono kind tag',
    derivation: '--t-10 / --t-10',
  },
  {
    rung: 2,
    floor: T_FLOOR / T_SUBTITLE,
    drops: 'the --t-10 rungs: the kind tag, the footer, the provenance',
    carries: 'silhouette and icon',
    derivation: '--t-10 / --t-11',
  },
  {
    rung: 3,
    floor: T_FLOOR / T_TITLE,
    drops: 'the subtitle (--t-11)',
    carries: 'silhouette and icon',
    derivation: '--t-10 / --t-12',
  },
  {
    rung: 4,
    floor: W_HAIR / STROKE,
    drops: 'the title (--t-12)',
    carries: 'silhouette and icon',
    derivation: '--w-hair / 1.5',
  },
  {
    rung: 5,
    floor: ZOOM_MIN,
    drops: 'the icon — a 1.5 stroke is now under one device pixel',
    carries: 'the silhouette alone, and it still separates all six',
    derivation:
      '§05.8 threshold column: NONE. The silhouette is geometry, not type, so ' +
      'it has no floor of its own; 0.25 is ZOOM_MIN — where the camera stops.',
  },
] as const;

/**
 * Which rung a zoom is on.
 *
 * A pure lookup so the card, the legend, the census and the tests cannot
 * disagree about which rung is live — which is also why `CanvasSlice.rung` is
 * state rather than a render-local.
 *
 * IT NEVER RETURNS 6 OR 7. `LodRung` still admits them and `visibilityAt` is
 * still total over them — a surface can draw a card at a rung directly, and
 * `NodeCard.test.tsx` does — but §05.8 gives the card box no threshold, so no
 * zoom in the camera's range hands one out. The fallback below is rung 5 rather
 * than 7 for the same reason: below the camera floor the sheet still says
 * silhouette.
 */
export function rungFor(zoom: number): LodRung {
  for (const step of LOD_LADDER) {
    if (zoom >= step.floor) return step.rung;
  }
  return 5;
}

/** What a rung shows, as the card's own four slots plus its two carriers. */
export interface LodVisibility {
  /** `.nd-hd` — the icon and the mono kind tag. */
  kindTag: boolean;
  /** `.nd-t` — the node's own name. */
  title: boolean;
  /**
   * Condensed title at distance (owner 2026-08-27): big-picture labels stay
   * readable past the full-title floor. Rendered only when `title` is off.
   */
  shortTitle: boolean;
  /** `.nd-s` — one line of summary. */
  subtitle: boolean;
  /** `.nd-ft` — evidence left, counts right. A --t-10 rung. */
  footer: boolean;
  /** The kind glyph. Kept through ZOOM_MIN so kinds stay readable at distance. */
  icon: boolean;
  /** The card is drawn as a card at all, rather than as a mark. */
  card: boolean;
  /**
   * `.edgetag` — the connector's own label. §05.8's FIRST ladder row, which
   * this module has stated in its header since it was written and never
   * handed out: authored at --t-10, so its threshold is --t-10 / --t-10 = 1.00
   * and it is the first ink to go. Nothing read it because nothing drew an
   * edge label; `ElbowEdge` does now, and it asks here rather than picking its
   * own zoom.
   */
  edgeTag: boolean;
}

/**
 * DETAIL LEAVES IN A FIXED ORDER AND EACH RUNG LEAVES WHOLE (sheet 08.2). Each
 * rung is a strict subset of the one above it — nothing is ever added back —
 * and `lod.test.ts` asserts that as a property over the whole ladder rather
 * than by reading this table.
 *
 * Rungs 6 and 7 stay defined because `LodRung` admits them and this function
 * must be total, but under §05.8 no zoom selects them. See `rungFor`.
 *
 * Owner seat (2026-08-27, Option A): icons yield FIRST below ~0.67 (rung 4+);
 * condensed/plain titles stay through ZOOM_MIN so a zoomed-out board still
 * reads names — not silhouette-only emptiness.
 */
export function visibilityAt(rung: LodRung): LodVisibility {
  return {
    /* Owner 2026-08-26: kind reads on the tinted icon only — no mono tag. */
    kindTag: false,
    footer: rung <= 1,
    subtitle: rung <= 2,
    title: rung <= 3,
    shortTitle: rung <= 5,
    icon: rung <= 3,
    card: rung <= 6,
    /* Rung 1 is the 1.00 row. A --t-10 label at any lower rung paints below the
       type floor, and the ladder's one rule is that labels are HIDDEN at low
       zoom, never shrunk. */
    edgeTag: rung <= 1,
  };
}

/**
 * A5.2 — nodes that carry a real subtitle (detailed `whatItDoes`) keep that
 * line one rung longer than the default ladder, so detailed proposals do not
 * lose their descriptions at the first zoom-out.
 */
export function visibilityAtWithSubtitleBoost(
  rung: LodRung,
  hasSubtitle: boolean,
): LodVisibility {
  const base = visibilityAt(rung);
  if (!hasSubtitle || base.subtitle) return base;
  if (rung <= 3) return { ...base, subtitle: true };
  return base;
}

/**
 * Does the SILHOUETTE still separate all six at this zoom?
 *
 * The one question the greyscale invariant is asked, answered in one place so
 * that a surface which wants to claim kind-at-a-glance has to consult it.
 *
 * DERIVED, NOT DECLARED. §05.8 gives the silhouette no threshold, so this
 * function must not hold one — it holds wherever a card is drawn at all. The
 * revision that wrote `zoom >= 0.5` here was writing a second, private ladder
 * beside `LOD_LADDER`, and the two could disagree without anything going red.
 */
export function silhouetteSeparates(zoom: number): boolean {
  return visibilityAt(rungFor(zoom)).card;
}

/**
 * The lowest zoom at which anything ON THE CARD still says what kind it is.
 *
 * It is the camera's own floor, because §05.8's last row has no threshold: the
 * board never reaches a zoom where the legend and the census are the only
 * things naming a kind.
 */
export const KIND_CARRIED_TO = ZOOM_MIN;

/**
 * The lowest zoom at which the node is still drawn as a card rather than a
 * mark. Also the camera's floor: §05.8 gives the card box no threshold either,
 * and the mark is a rung the ladder describes without the camera reaching it.
 */
export const CARD_DRAWN_TO = ZOOM_MIN;
