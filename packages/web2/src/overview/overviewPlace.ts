/* Where the chat overview sits. PURE: boxes in, a placement out. No React, no DOM.
 *
 * The overview floats over the background at the right of a chat that is alone. It reserves no grid column and it
 * covers nothing of the chat. To make room for the panel the centred chat card first gives up its LEFT margin (it
 * shifts left, keeping its width), then, only if that is not enough, narrows, never below the composer's minimum
 * width. Where even that cannot fit the panel it is the small pill beside the card, or inline in the chat header.
 * Only the geometry folds it: a chat that is alone has no manual collapse, and an older build's stored fold is not read.
 * The card's natural place comes from the main column (which the panel does not change), so placing never feeds back
 * into the measurement. */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Breathing room between the overview and the edge it floats beside. */
export const OVERVIEW_GAP = 8;
export const PANEL_MAX_W = 272;
export const PANEL_MIN_W = 208;
export const PILL_W = 104;
export const PANEL_MAX_H = 440;
/** The centred chat card's own width (shell2.css: min(960px, 100%)). */
export const CHAT_CARD_W = 960;
/** The composer's reading width (800) plus the card's side padding (2 x 24): the card never narrows below it. */
export const CHAT_MIN_W = 848;
/** The width the chat-only card keeps while the panel can still give room instead (e2e g2-chat-only-width: at least 900 at 1440). */
export const CHAT_COMFY_W = 900;

/** Where the chat card sits when it gives way: its left offset from the main column's left edge, and its width. */
export interface ChatShift {
  left: number;
  width: number;
}

export type OverviewPlacement =
  | { mode: 'panel'; right: number; top: number; width: number; maxHeight: number; chatShift: ChatShift | null }
  | { mode: 'pill'; right: number; top: number; /** The panel would fit if the reader expanded it. */ canExpand: boolean; chatShift: null }
  | { mode: 'inline'; canExpand: false; chatShift: null };

export interface PlaceInput {
  /** The row the overview floats in. Null or zero-width: nothing is measured yet (first paint, jsdom). */
  container: Box | null;
  /** The main column the chat card is centred in (grid column 2). */
  column: Box | null;
  /** The chat card's real bounds: only its top is read, which a shift does not change. */
  chat: Box | null;
  /** No surface is open: the chat is alone and centred. With a surface the margin is the stage, never free. */
  centred: boolean;
}

const wide = (b: Box | null): b is Box => b !== null && b.right - b.left > 0;

/** Room the panel needs to the right of the card: the panel, a gap to the card and a gap to the window edge. */
const NEED = PANEL_MAX_W + 2 * OVERVIEW_GAP;

export function placeOverview(i: PlaceInput): OverviewPlacement {
  if (!i.centred) return { mode: 'inline', canExpand: false, chatShift: null };
  const top = OVERVIEW_GAP;
  if (!wide(i.container) || !wide(i.column) || !wide(i.chat)) {
    return { mode: 'panel', right: OVERVIEW_GAP, top, width: PANEL_MAX_W, maxHeight: PANEL_MAX_H, chatShift: null };
  }
  const { container, column, chat } = i;
  const colW = column.right - column.left;
  const w0 = Math.min(CHAT_CARD_W, colW);
  const left0 = column.left + (colW - w0) / 2;
  const margin0 = container.right - (left0 + w0);
  const at = Math.max(OVERVIEW_GAP, chat.top - container.top);
  const height = Math.max(0, Math.min(PANEL_MAX_H, container.bottom - container.top - at - OVERVIEW_GAP));

  /* The panel's room: none to find if the margin is already wide; else shift left, then narrow. */
  let chatShift: ChatShift | null = null;
  let fitsPanel = margin0 >= NEED;
  let panelW = PANEL_MAX_W;
  if (!fitsPanel) {
    const extra = NEED - margin0;
    const shift = Math.min(extra, Math.max(0, left0 - column.left - OVERVIEW_GAP));
    /* What shifting could not find: first from the card, but only down to the comfortable width; then from the panel,
       down to its minimum; the card goes below the comfortable width only for what is still missing. */
    let rest = extra - shift;
    const fromCard = Math.min(rest, Math.max(0, w0 - CHAT_COMFY_W));
    rest -= fromCard;
    const fromPanel = Math.min(rest, PANEL_MAX_W - PANEL_MIN_W);
    rest -= fromPanel;
    /* Whether it fits is decided by the full-width panel, as before: the panel's give only moves narrowing off the card. */
    if (w0 - (extra - shift) >= CHAT_MIN_W) {
      chatShift = { left: left0 - shift - column.left, width: w0 - fromCard - rest };
      panelW = PANEL_MAX_W - fromPanel;
      fitsPanel = true;
    }
  }
  if (fitsPanel) return { mode: 'panel', right: OVERVIEW_GAP, top: at, width: panelW, maxHeight: height, chatShift };
  /* Pill or header: the panel does not fit, so the pill sits beside the card where it was, unmoved. */
  if (margin0 >= PILL_W + 2 * OVERVIEW_GAP) return { mode: 'pill', right: OVERVIEW_GAP, top: at, canExpand: fitsPanel, chatShift: null };
  return { mode: 'inline', canExpand: false, chatShift: null };
}

export function samePlacement(a: OverviewPlacement, b: OverviewPlacement): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'inline' || b.mode === 'inline') return true;
  if (a.mode === 'pill' && b.mode === 'pill') return a.top === b.top && a.right === b.right && a.canExpand === b.canExpand;
  if (a.mode === 'panel' && b.mode === 'panel') {
    const sa = a.chatShift;
    const sb = b.chatShift;
    const sameShift = sa === sb || (sa !== null && sb !== null && sa.left === sb.left && sa.width === sb.width);
    return sameShift && a.top === b.top && a.right === b.right && a.width === b.width && a.maxHeight === b.maxHeight;
  }
  return false;
}

export const toBox = (r: { left: number; right: number; top: number; bottom: number }): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
