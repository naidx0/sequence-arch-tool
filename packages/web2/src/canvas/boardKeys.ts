/* ══════════════════════════════════════════════════════════════════════════
   BOARD KEYS — the keyboard-native board, as pure functions
   packages/web2/src/canvas/boardKeys.ts

   Round 7, C.1 and C.5. Jaden: "Easier to use and interact with... more
   keyboard native, hold space, move around even in draw. Click on an element,
   exit, simple."

     Space (held)   pan by dragging, in Select and in Draw
     Arrows         move the selection to the nearest card that way
     Arrows on a    move that card (Shift: further). A card has keyboard
     focused card   focus after Tab; a click focuses the board, not the card
     + / -          zoom in / out
     0              fit the board
     1              100%
     2              fit the selection
     Esc            back one level: Draw, then the selection, then the open
                    anatomy, then the drilled-in level

   `BOARD_KEYS` (boardKeysHint.ts) is what the More menu prints; a test holds
   it to the keys this handler binds.
   ══════════════════════════════════════════════════════════════════════════ */

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export const NUDGE_PX = 8;
export const NUDGE_FAR_PX = 40;
/** A press moves less than this and is a click; past it, a drag (C.1). */
export const NODE_DRAG_THRESHOLD = 4;

/**
 * THE CARD KEEPS UNDER THE POINTER. The renderer starts a drag only once the press has moved past
 * NODE_DRAG_THRESHOLD and measures the card's travel from THAT point, so the card trailed the pointer by the
 * threshold for the whole drag (a steady 4px slip, measured). This is the distance the pointer had already
 * travelled when the drag began, in flow units; adding it to the renderer's position puts the card back under
 * the pointer.
 */
export function dragCatchUp(
  pressedAt: { x: number; y: number } | null,
  dragBeganAt: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  if (!pressedAt || !(zoom > 0)) return { x: 0, y: 0 };
  return { x: (dragBeganAt.x - pressedAt.x) / zoom, y: (dragBeganAt.y - pressedAt.y) / zoom };
}

/* The hint the More menu prints is boardKeysHint.ts, in the More menu's lazy
   chunk, so its words cost boot nothing. */

export function isArrow(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

export function nudge(at: { x: number; y: number }, key: ArrowKey, far: boolean): { x: number; y: number } {
  const d = far ? NUDGE_FAR_PX : NUDGE_PX;
  if (key === 'ArrowLeft') return { x: at.x - d, y: at.y };
  if (key === 'ArrowRight') return { x: at.x + d, y: at.y };
  if (key === 'ArrowUp') return { x: at.x, y: at.y - d };
  return { x: at.x, y: at.y + d };
}

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The card an arrow moves the selection to: the nearest box whose centre lies
 * that way, scored by distance along the arrow plus twice the sideways offset,
 * so a card straight ahead beats a nearer one off to the side. With nothing
 * selected, the first card in reading order (top, then left). Null when there
 * is nothing that way, and the selection stays.
 */
export function nextInDirection(boxes: readonly Box[], fromId: string | null, key: ArrowKey): string | null {
  if (boxes.length === 0) return null;
  const from = fromId ? boxes.find((b) => b.id === fromId) : undefined;
  if (!from) {
    const first = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    return first ? first.id : null;
  }
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best: { id: string; score: number } | null = null;
  for (const b of boxes) {
    if (b.id === from.id) continue;
    const dx = b.x + b.w / 2 - cx;
    const dy = b.y + b.h / 2 - cy;
    const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
    const side = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + side * 2;
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best ? best.id : null;
}

/** Keys typed into a field are the field's, never the board's. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}
