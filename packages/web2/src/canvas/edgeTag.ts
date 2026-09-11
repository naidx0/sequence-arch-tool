/* ══════════════════════════════════════════════════════════════════════════
   WHAT FITS ON A CONNECTOR — sheet 04's `.edgetag`, bounded.
   packages/web2/src/canvas/edgeTag.ts

   THE MEASUREMENT THAT PUT THIS FILE HERE. With edge labels wired through,
   this monorepo's one scanned connector arrived carrying every distinct member
   label the projector had joined together:

       "read user_daily_usage, read user_usage, write user_daily_usage,
        write user_usage"

   — 480 painted pixels of --t-10 mono lying across the board, measured in the
   shipped bundle at 1:1. Sheet 04 draws the tag as a short mark ON the line
   ('POST /charge', 'pub order.placed'); a caption wider than the cards it
   passes between is the overflow sheet 08 is about, arriving through the one
   piece of ink that has no box to be clipped by. An SVG <text> has no
   `text-overflow`, so nothing downstream would have caught it.

   ── WHY THIS SHORTENS RATHER THAN DROPS ───────────────────────────────────

   Dropping a long label would take the verb away from exactly the connectors
   that had the most to say. Shortening keeps the first fact and COUNTS the rest
   — '+3 more' is a measurement, not a hiding — and the full text is carried
   alongside so the connector can hand it over on hover. Nothing is invented and
   nothing is silently lost.

   PURE, and separate from `project.ts` for the reason `glanceLine.ts` is: "how
   much of this is worth showing" is a question about the data, asked in one
   place, so the card, the connector and the tests cannot answer it differently.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The budget, in characters.
 *
 * DERIVED FROM THE CARD, NOT PICKED. `CARD_W` is 160 and `.edgetag` is --t-10
 * mono, whose advance width is 0.6em — so a tag the width of one card is
 * 160 / (10 * 0.6) ≈ 26 characters. One card is the right budget because the
 * open channel a route's longest segment runs down is a card-width gap: a tag
 * wider than that is over a card by construction, which is the one thing the
 * label anchor exists to avoid.
 */
export const EDGE_TAG_MAX = 26;

/** The ellipsis is a character too, so a cut leaves room for it. */
const ELLIPSIS = '…';

export interface EdgeTag {
  /** What is painted on the line. */
  text: string;
  /** The whole label, present ONLY when it was shortened — so a caller can tell
   *  "this is all of it" from "there is more" without comparing strings. */
  full?: string;
}

/**
 * One connector's label, cut to the budget, or null when there is nothing to
 * say.
 *
 * The projector joins a projected edge's distinct member labels with ', ' —
 * that is where the 480px string came from — so a comma list is shortened by
 * KEEPING THE FIRST AND COUNTING THE REST rather than by cutting mid-word: the
 * first member is a whole fact, and 'read user_daily_usage +3 more' says
 * strictly more than 'read user_daily_usage, read user_us…'.
 */
export function edgeTag(label: string | null | undefined): EdgeTag | null {
  const text = label?.trim();
  if (!text) return null;
  if (text.length <= EDGE_TAG_MAX) return { text };

  const parts = text
    .split(', ')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    const rest = parts.length - 1;
    const suffix = ` +${rest} more`;
    const room = EDGE_TAG_MAX - suffix.length;
    const first = parts[0]!;
    const head = first.length <= room ? first : `${first.slice(0, Math.max(1, room - 1))}${ELLIPSIS}`;
    return { text: `${head}${suffix}`, full: text };
  }

  return { text: `${text.slice(0, EDGE_TAG_MAX - 1)}${ELLIPSIS}`, full: text };
}
