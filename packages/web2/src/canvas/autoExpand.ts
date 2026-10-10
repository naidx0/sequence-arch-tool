/* ══════════════════════════════════════════════════════════════════════════
   EXPAND ALL, AS FAR AS THE PANE CAN READ IT
   packages/web2/src/canvas/autoExpand.ts

   Pure. Expand all opens the board's groups one at a time in rank order. After
   each one, the board reports the zoom a fit of the finished arrangement needs
   (Board `onArrangedFit`). While that stays at or above READABLE_FIT the next
   group opens; the group that takes it below is closed again and expansion
   stops. What is left waits behind a "+N groups" chip that opens one at a
   time. So the box budget is the pane's, not a fixed 50: a 1024 pane holds
   fewer open groups than a 1440 one, and no box is ever cut off.

   A group the reader opens by hand may go below READABLE_FIT, down to the
   camera's floor; one that would need less than the floor (FIT_FLOOR) is
   closed again with a note, because past the floor the fit can only cut
   boxes off.
   ══════════════════════════════════════════════════════════════════════════ */

/** The fit zoom expand-all keeps the board at or above (names stay readable). */
export const READABLE_FIT = 0.35;
/** The camera's floor (ZOOM_MIN): a fit below it cuts boxes off. */
export const FIT_FLOOR = 0.25;

export interface AutoExpandState {
  /** Groups still to open, in rank order. */
  queue: string[];
  /** The group opened last, waiting for its arrangement's fit. */
  tried: string | null;
  /** Expansion stopped (the pane is full, or the queue ran out). */
  done: boolean;
}

export interface AutoExpandStep {
  state: AutoExpandState;
  /** Open this group now. */
  expand?: string;
  /** Close this group again (it took the fit below READABLE_FIT). */
  collapse?: string;
}

export function startAutoExpand(ranked: readonly string[]): AutoExpandState {
  return { queue: [...ranked], tried: null, done: ranked.length === 0 };
}

/**
 * One step, on a finished arrangement whose fit needs `fitZoom`.
 * `fits(id)` says whether opening `id` stays inside the box budget (50).
 */
export function autoExpandStep(
  s: AutoExpandState,
  fitZoom: number,
  fits: (id: string) => boolean = () => true,
  readable = READABLE_FIT,
): AutoExpandStep {
  if (s.done) return { state: s };
  if (s.tried !== null && fitZoom < readable) {
    /* The last group made the board too small to read: close it, keep it
       first in what is left, and stop. */
    return { state: { queue: [s.tried, ...s.queue], tried: null, done: true }, collapse: s.tried };
  }
  if (s.tried === null && fitZoom < readable) return { state: { ...s, done: true } };
  const queue = [...s.queue];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (!fits(next)) {
      /* Past the box budget: stop here, this one first in what is left. */
      return { state: { queue: [next, ...queue], tried: null, done: true } };
    }
    return { state: { queue, tried: next, done: false }, expand: next };
  }
  return { state: { queue: [], tried: null, done: true } };
}

/** Groups to rank for Expand all: drawn, top level, with members, not open;
 *  most connected first, then by name, so the same scan ranks the same way. */
export function rankGroups(
  boxes: ReadonlyArray<{ id: string; label: string; parentId?: string }>,
  openable: ReadonlySet<string>,
  expanded: readonly string[],
  lines: ReadonlyArray<{ source: string; target: string }>,
): string[] {
  const degree = new Map<string, number>();
  for (const l of lines) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const open = new Set(expanded);
  return boxes
    .filter((b) => !b.parentId && openable.has(b.id) && !open.has(b.id))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((b) => b.id);
}
