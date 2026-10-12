/* ══════════════════════════════════════════════════════════════════════════
   FAR-ZOOM BOX CLASSES — DISCRETE, NOT PER FRAME (S4 review, item 3)
   packages/web2/src/canvas/farLod.ts

   At far zoom a box's hairline scales below a device pixel and its glass fill
   to nothing, so the label floats. The fix is NOT a border width driven by a
   per-frame zoom variable (a repaint of every card on every wheel tick): two
   classes on the board root, which change only when the zoom crosses ~0.5
   and ~0.3. board.css gives each a heavier fill and a rim of at least one
   device pixel down to the camera floor (ZOOM_MIN 0.25).
   ══════════════════════════════════════════════════════════════════════════ */

/** Below this zoom the board takes `lod-far`. */
export const FAR_LOD_ZOOM = 0.5;
/** Below this zoom it takes `lod-farther` as well. */
export const FARTHER_LOD_ZOOM = 0.3;

/** The board root's far-zoom classes at `zoom` ('' when near). */
export function farLodClass(zoom: number): string {
  if (zoom < FARTHER_LOD_ZOOM) return 'lod-far lod-farther';
  if (zoom < FAR_LOD_ZOOM) return 'lod-far';
  return '';
}
