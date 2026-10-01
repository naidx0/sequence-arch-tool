/**
 * ══ FAR-ZOOM LABELS YIELD WHEN THEY COLLIDE ═══════════════════════════════
 *
 * Owner, 2026-09-22 (photo 2, the board at about 25%): "a lot of labels are
 * mixing on top of each other … texts look a little faulty".
 *
 * Measured on this repository's board at 25%: `.nd-t-short` is counter-scaled
 * by `1 / zoom` so a far title keeps its screen size (board.css, "Far-zoom
 * labels"). That was the right call for legibility and it has a consequence
 * nobody drew: the cards' SPACING shrinks with the camera and the labels do
 * not, so at 25% every label is four times its card's share of the screen.
 * "Desktop" and "Gateway" rendered as one word, "DesktopGateway".
 *
 * lod.ts states the ladder's one rule — labels are HIDDEN at low zoom, never
 * shrunk — and this applies it per label rather than per rung: where two far
 * labels would overlap on screen, the one that matters less yields. The same
 * greedy placement a map uses for town names. Which matters more is the
 * card's own evidence: the selected card first, then the card with more
 * connections, then the shorter label, then board order so the answer is
 * stable frame to frame.
 *
 * A yielded label is not gone: hovering the card shows it (board.css).
 */

export interface FarLabelInput {
  id: string;
  /** Card centre in FLOW coordinates. */
  cx: number;
  cy: number;
  /** The text the far rung paints. */
  text: string;
  /** Edges touching this card. */
  degree: number;
  selected: boolean;
}

/** Screen metrics of a far label, from board.css `.nd-t` (14px, --lh-14). */
export const FAR_LABEL_CHAR_PX = 8.2;
export const FAR_LABEL_LINE_PX = 21;
/** Breathing room between two labels, in screen px. */
export const FAR_LABEL_GAP_PX = 6;

function labelBox(item: FarLabelInput, zoom: number) {
  const w = (item.text.length * FAR_LABEL_CHAR_PX + FAR_LABEL_GAP_PX) / zoom;
  const h = (FAR_LABEL_LINE_PX + FAR_LABEL_GAP_PX) / zoom;
  return { x0: item.cx - w / 2, x1: item.cx + w / 2, y0: item.cy - h / 2, y1: item.cy + h / 2 };
}

/** The ids whose far label yields at this zoom. Empty when nothing collides. */
export function farLabelsToYield(items: readonly FarLabelInput[], zoom: number): Set<string> {
  const hidden = new Set<string>();
  if (!(zoom > 0) || items.length < 2) return hidden;
  const order = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.item.selected) - Number(a.item.selected) ||
        b.item.degree - a.item.degree ||
        a.item.text.length - b.item.text.length ||
        a.index - b.index,
    );
  const kept: ReturnType<typeof labelBox>[] = [];
  for (const { item } of order) {
    const box = labelBox(item, zoom);
    const hits = kept.some((k) => box.x0 < k.x1 && k.x0 < box.x1 && box.y0 < k.y1 && k.y0 < box.y1);
    if (hits && !item.selected) hidden.add(item.id);
    else kept.push(box);
  }
  return hidden;
}
