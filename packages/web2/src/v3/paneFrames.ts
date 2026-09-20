/* ══════════════════════════════════════════════════════════════════════════
   STILL FRAMES — the widths a pane snaps to
   packages/web2/src/v3/paneFrames.ts

   Owner, 2026-09-17: "when it comes to screens where people can minimize,
   expand and drag side to side, we should create still frames they can lock
   to, so we get consistent graphics instead of failing graphics some of the
   time … I don't know if this is 25/25/25/25 or 50/25/25 — the send button
   and the plan buttons are all stacking on top of each other."

   A free-dragged split lands on whatever pixel the pointer let go at, and
   every surface then has to survive a width nobody designed for. This module
   turns the drag into a choice between a few widths that WERE designed for:
   quarters, thirds and halves of the space the panes share.

   THE DRAG ALWAYS LANDS ON A FRAME. Owner, 2026-09-17: "snap frames are much
   better … make sure it makes people snap to those frames instead of letting
   them infinitely choose." The first cut kept a 22px magnet, so a drag that
   let go more than 22px from every frame stayed free — which is most of the
   travel, and exactly the ~455px chat column that stacked the composer into
   two rows. A magnet makes frames an OFFER; the owner asked for a choice
   between frames. The magnet is gone: the nearest allowed frame wins at any
   distance.

   AND IT LANDS ON ONE — it does not LIVE on one. Owner, 2026-09-18: "I like
   the snap frames… but I kind of like the fluid drag motion. Right now it's
   purely snapping and no drag-to-snap." Calling `snapToFrame` on every
   pointermove made the pane a five-position switch; `snapOnRelease` below
   splits the live width (the pointer's, clamped) from the landing (the frame),
   and the shell draws the landing as a guide while the drag runs.

   The clamp still outranks the frames, and a frame outside it is still not
   offered — a snap onto a width the pane cannot have is not a snap. When the
   clamp admits no frame at all there is nothing to choose between, and the
   clamped raw width comes back with `frame: null`.

   PURE. Numbers in, number out. The shell measures; this decides.
   ══════════════════════════════════════════════════════════════════════════ */

/** Fractions of the shared width a pane may lock to. */
export const FRAME_FRACTIONS: readonly number[] = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];

export interface FrameSnap {
  /** The width to use — a frame's width when snapped, else the raw width. */
  width: number;
  /** The fraction that was hit, as its label ("1/3"), or null when free. */
  frame: string | null;
}

function fractionLabel(fraction: number): string {
  for (const [num, den] of [
    [1, 4],
    [1, 3],
    [1, 2],
    [2, 3],
    [3, 4],
  ] as const) {
    if (Math.abs(fraction - num / den) < 1e-9) return `${num}/${den}`;
  }
  return fraction.toFixed(2);
}

/**
 * Snap `raw` to the NEAREST frame of `total`, at any distance, after clamping
 * to `[min, max]`. A frame that itself falls outside the clamp is not offered
 * — a snap that lands on a width the pane cannot have is not a snap — and when
 * the clamp admits no frame the clamped raw width comes back with no frame.
 */
export function snapToFrame(
  raw: number,
  total: number,
  min: number,
  max: number,
  fractions: readonly number[] = FRAME_FRACTIONS,
): FrameSnap {
  const clamped = Math.min(max, Math.max(min, raw));
  if (!Number.isFinite(total) || total <= 0) return { width: clamped, frame: null };
  let best: { width: number; frame: string; distance: number } | null = null;
  for (const fraction of fractions) {
    const width = Math.round(total * fraction);
    if (width < min || width > max) continue;
    const distance = Math.abs(width - clamped);
    if (best === null || distance < best.distance) {
      best = { width, frame: fractionLabel(fraction), distance };
    }
  }
  return best ? { width: best.width, frame: best.frame } : { width: clamped, frame: null };
}

export interface DragPreview {
  /** What to draw RIGHT NOW: the pointer's own width, clamped, never snapped. */
  width: number;
  /** Where letting go would land it — the guide line's x, and its label. */
  release: FrameSnap;
}

/**
 * THE DRAG FOLLOWS THE POINTER; THE RELEASE LANDS ON A FRAME.
 *
 * Owner, 2026-09-18, on the installed app: "I like the snap frames… but I kind
 * of like the fluid drag motion. Right now it's purely snapping and no
 * drag-to-snap." Yesterday's cut called `snapToFrame` on every pointermove, so
 * the pane teleported between five widths and the pointer and the edge were
 * never in the same place — there was no drag left, only a five-position
 * switch.
 *
 * Splitting the answer in two restores the motion without giving back the free
 * width: `width` is the pointer, clamped, so the edge stays under the finger;
 * `release` is the frame the drag WILL land on, which the shell draws as a
 * guide line so the reader can see the landing before they let go. Only
 * `release` is ever persisted.
 *
 * PURE. Numbers in, numbers out — the shell measures and draws.
 */
export function snapOnRelease(
  raw: number,
  total: number,
  min: number,
  max: number,
  fractions: readonly number[] = FRAME_FRACTIONS,
): DragPreview {
  return {
    width: Math.min(max, Math.max(min, raw)),
    release: snapToFrame(raw, total, min, max, fractions),
  };
}

/** Which frame (if any) a settled width sits on — for the `data-frame` hook. */
export function frameOf(width: number, total: number, fractions: readonly number[] = FRAME_FRACTIONS): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  for (const fraction of fractions) {
    if (Math.abs(Math.round(total * fraction) - width) <= 1) return fractionLabel(fraction);
  }
  return null;
}

/**
 * Snap a two-pane split. `left + right` is the shared width; the left pane
 * snaps to a frame of it and the right takes the rest, both above `min`.
 */
export function snapSplit(
  rawLeft: number,
  total: number,
  min: number,
  fractions: readonly number[] = [1 / 3, 1 / 2, 2 / 3],
): { left: number; right: number; frame: string | null } {
  const snapped = snapToFrame(rawLeft, total, min, Math.max(min, total - min), fractions);
  return { left: snapped.width, right: total - snapped.width, frame: snapped.frame };
}
