/* ══════════════════════════════════════════════════════════════════════════
   THE SURFACE ORDER (round 0.1.5, G2)
   packages/web2/src/shell2/surfaceOrder.ts

   Owner: the top tabs "can't be dragged". The surface pills are reorderable:
   drag a name sideways (or Alt+arrow on a focused one) and the bar remembers
   it. Pure helpers plus one stored key; the shell owns the pointer.
   ══════════════════════════════════════════════════════════════════════════ */

export const SURFACE_ORDER_KEY = 'sequence.surfaceOrder';

/** The saved order laid over the base list: saved ids first, in saved order; ids the save never saw keep their base place at the end. */
export function applyOrder<T extends string>(base: readonly T[], saved: readonly string[] | null | undefined): T[] {
  if (!saved || saved.length === 0) return [...base];
  const known = new Set<string>(base);
  const head = saved.filter((id, i): id is T => known.has(id) && saved.indexOf(id) === i);
  return [...head, ...base.filter((id) => !head.includes(id))];
}

/** `id` moved so it sits at `to` (clamped); the same list when it is already there. */
export function moveTo<T extends string>(list: readonly T[], id: T, to: number): T[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const at = Math.max(0, Math.min(list.length - 1, to));
  if (at === from) return [...list];
  const next = list.filter((x) => x !== id);
  next.splice(at, 0, id);
  return next;
}

/**
 * Where a dragged pill belongs for a pointer at `x`: the number of the other pills whose centre is left of it.
 * `centres` are every pill's centre in the current order, the dragged one included.
 */
export function slotAt(centres: readonly number[], dragged: number, x: number): number {
  let n = 0;
  centres.forEach((c, i) => {
    if (i !== dragged && c < x) n += 1;
  });
  return n;
}

export function readOrder(): string[] | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SURFACE_ORDER_KEY) ?? 'null');
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function writeOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(SURFACE_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* the order still holds for this session */
  }
}

/**
 * Surfaces in the order of their visible names (0.1.8, C3, owner: "surfaces should open according to their titles ...
 * it shouldn't sort on the recency of windows ... it should sort based off of the surface names"). The label is read
 * at runtime, so a renamed surface sorts under its new name.
 */
export function sortByTitle<T extends string>(ids: readonly T[], labelOf: (id: T) => string): T[] {
  /* One collator for the sort: `localeCompare(b, 'en', options)` builds a new one per comparison (about 12 ms for the
     surface strip at boot). The ordering is the same. */
  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  return [...ids].sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
}
