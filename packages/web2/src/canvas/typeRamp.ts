/* ══════════════════════════════════════════════════════════════════════════
   THE TYPE RAMP, AS ARITHMETIC — the numbers two modules derive from
   packages/web2/src/canvas/typeRamp.ts

   docs/brand/graphite/pages/05-the-canvas.html §05.8 and §05.5.

   ── WHY THIS FILE EXISTS, AND IT IS NOT TIDINESS ──────────────────────────

   Sheet 05.5 states the rule that creates it, about the auto-fit floor:

     "the type floor is one number for the whole product, so the fit floor is
      one number derived from it, not two derived from two card designs."

   Two modules therefore need the same two numbers. `lod.ts` divides the type
   floor by each rung's authored size to get the LOD ladder; `camera.ts`
   divides it by the TITLE's authored size to get the floor Fit may not go
   below. Before this file, `lod.ts` held them privately and `camera.ts` had a
   comment claiming a `FIT_MIN_ZOOM` that existed in no file — the exact shape
   of a second source of truth that has already drifted.

   IT CANNOT BE SOLVED BY camera.ts IMPORTING lod.ts. `lod.ts` imports
   `ZOOM_MIN` from `camera.ts` (§05.8's last row has no threshold of its own —
   it holds to where the CAMERA stops), so the reverse edge closes a cycle, and
   an ES module cycle whose members read each other's `const` at evaluation time
   is a temporal-dead-zone crash that depends on which side the bundler happens
   to enter first. A leaf module with no imports of its own cannot have that
   problem.

   ── THESE ARE NOT A COPY OF THE TOKENS, THEY ARE ARITHMETIC ABOUT THEM ────

   Every value is asserted against the LIVE computed token in `lod.test.ts` and
   `camera.test.ts` — `var(--t-10)` resolved by the real cascade, not restated —
   so this list cannot drift away from `tokens/graphite.css` without a red test.
   They are plain numbers rather than `font-size` declarations, so the firewall's
   rule 4 is untouched: this module is arithmetic about type, never a
   declaration of it.
   ══════════════════════════════════════════════════════════════════════════ */

/** `--t-10`. THE TYPE FLOOR: below it a label is not small text, it is no
 *  text. One number for the whole product — §05.5's own words. */
export const T_FLOOR = 10;

/** `--t-11` — `.nd-s`, the subtitle. */
export const T_SUBTITLE = 11;

/** `--t-12` — `.nd-t`, the node's own name, and the last thing on the card a
 *  reader can use to tell one node from another. */
export const T_TITLE = 12;

/** The kind icon's stroke. Sheet 09: one 1.5px stroke, everywhere. */
export const STROKE = 1.5;

/** `--w-hair` — the one device pixel a stroke falls to before it stops being
 *  a line the renderer can honestly draw. */
export const W_HAIR = 1;

/**
 * THE ZOOM AT WHICH A CARD STILL CARRIES ITS TITLE, and the sheet's own row.
 *
 * §05.8's ladder, third row: `.nd-t` is authored at --t-12, the floor is
 * --t-10, and the quotient is the "Holds to" column's 0.83. Below it the title
 * is not shown smaller — it is not shown, because "labels are HIDDEN at low
 * zoom, never shrunk".
 *
 * It is exported from here rather than from `lod.ts` for the cycle reason
 * above: `camera.ts` is the module that has to obey it and `lod.ts` is the
 * module that has to agree with it, and neither may own it.
 */
export const TITLE_HOLDS_TO = T_FLOOR / T_TITLE;
