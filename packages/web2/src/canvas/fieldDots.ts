/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD'S DOTS AT LOW ZOOM (round 13, A7)
   packages/web2/src/canvas/fieldDots.ts

   Jaden: "zoomed out, the background dots get tiny and noisy." The field's
   pitch is 20px in the content's own space, so at 0.3x the dots sit 6px
   apart and read as grain. Two numbers fix that and nothing else moves:

     step  the pitch is multiplied by 2, 4, 8... until the dots sit at least
           10px apart on screen (so a zoomed-out board has FEWER dots, in the
           same lattice, not denser ones);
     fade  the dot ink thins out as the board zooms out, to 40% at the floor.

   Both go to board.css as custom properties beside the camera's three.
   ══════════════════════════════════════════════════════════════════════════ */

/** The least on-screen gap between dots, in px, below which the pitch doubles. */
export const FIELD_MIN_GAP = 10;
/** The content-space pitch (matches --board-field-pitch = --sp-20). */
export const FIELD_PITCH = 20;
/** The ink never fades below this share of full strength. */
export const FIELD_FADE_FLOOR = 0.4;

export interface FieldDots {
  /** 1, 2, 4, 8... : the multiplier on the pitch. */
  step: number;
  /** 0.4 to 1: the share of the dot's ink. */
  fade: number;
}

export function fieldDots(zoom: number): FieldDots {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  let step = 1;
  while (FIELD_PITCH * z * step < FIELD_MIN_GAP && step < 64) step *= 2;
  const fade = Math.min(1, Math.max(FIELD_FADE_FLOOR, z * 1.5));
  return { step, fade: Math.round(fade * 100) / 100 };
}
