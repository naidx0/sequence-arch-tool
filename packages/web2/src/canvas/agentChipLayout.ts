/**
 * ══ AGENT CHIPS STACK, THEN YIELD, WHEN THEY WOULD OVERLAP ═══════════════════
 *
 * Round 9, ask 25 (Jaden: agent labels overlap when zoomed out). A chip is
 * counter-scaled to a constant screen size (board.css, "THE AGENT CHIP"), so
 * when the camera is zoomed out the lit cards sit close together on screen and
 * their fixed-size chips land on top of each other.
 *
 * Placed greedily, most recent touch first, the way farLabels.ts places far
 * titles: a chip takes the lowest lane (lane 0 is just above its card, each
 * lane another chip-height up) where it touches neither an already placed
 * chip nor a card that is not its own; with no free lane it yields, and the card's chip shows on hover. Pure,
 * so it is tested without a layout engine.
 */

export interface ChipInput {
  id: string;
  /** Screen-space left/right of the chip when it sits in lane 0. */
  x0: number;
  x1: number;
  /** Screen-space top of the chip when it sits in lane 0. */
  y0: number;
  /** Larger wins the lowest lane: the newest touch. */
  priority: number;
}

/** A card on screen: a chip never lands on a card other than its own. */
export interface ChipObstacle {
  id: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ChipPlacement {
  id: string;
  /** 0 is the chip's home position; each step is one chip-height up. */
  lane: number;
  /** No lane was free: the chip is not drawn until its card is hovered. */
  hidden: boolean;
}

/** Screen height of one chip (11px type, --lh-11 plus padding) and the gap between lanes. */
export const CHIP_H = 18;
export const CHIP_GAP = 2;
export const CHIP_MAX_LANES = 4;

export function placeChips(items: readonly ChipInput[], obstacles: readonly ChipObstacle[] = []): ChipPlacement[] {
  const order = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out = new Map<string, ChipPlacement>();
  for (const item of order) {
    let chosen = -1;
    for (let lane = 0; lane < CHIP_MAX_LANES; lane += 1) {
      const dy = lane * (CHIP_H + CHIP_GAP);
      const box = { x0: item.x0, x1: item.x1, y0: item.y0 - dy, y1: item.y0 - dy + CHIP_H };
      const hit =
        placed.some((p) => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1) ||
        obstacles.some((o) => o.id !== item.id && box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1);
      if (!hit) {
        placed.push(box);
        chosen = lane;
        break;
      }
    }
    out.set(item.id, { id: item.id, lane: Math.max(chosen, 0), hidden: chosen < 0 });
  }
  return items.map((i) => out.get(i.id)!);
}

/** The chip's width on screen: measured at about 4.9px a character at 11px type (glyph included as two), plus padding. */
export function chipWidth(text: string): number {
  return Math.round((text.length + 2) * 5 + 14);
}
