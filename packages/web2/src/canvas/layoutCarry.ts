/**
 * THE LAST ARRANGEMENT STANDS IN WHILE THE NEXT ONE IS COMPUTED (0.1.8.4 audit, "the board flickers when Architecture is reopened").
 *
 * The board drew `projection.positions` (the seed: every card piled at the top left) for as long as no layout matched the current
 * layout key. The key changes when the pane's shape does, so a reopened tab, a resized pane or a direction choice showed the pile for
 * a few frames and then jumped twice. The arrangement already drawn is the better stand-in: the same cards, where the reader last saw them.
 * It is kept at module level so a remounted board has it too, and it stands in only while it still places every card that is drawn.
 */

export interface CarriedLayout {
  key: string;
  positions: Record<string, { x: number; y: number }>;
  sizes?: Record<string, { w: number; h: number }>;
  routes?: Record<string, unknown[]>;
  orphanRow?: { x: number; y: number; count: number; ids?: string[] };
  direction?: 'LR' | 'TD';
}

const KEEP = 6;
const kept = new Map<string, unknown>();
const signature = (ids: readonly string[]): string => [...ids].sort().join('\u0001');

/** Remember the arrangement just drawn for this set of cards. */
export function rememberLayout<T extends CarriedLayout>(ids: readonly string[], layout: T): void {
  const sig = signature(ids);
  kept.delete(sig);
  kept.set(sig, layout);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
}

/** The arrangement last drawn for exactly this set of cards, if any. */
export function carriedLayout<T extends CarriedLayout>(ids: readonly string[]): T | null {
  return (kept.get(signature(ids)) as T | undefined) ?? null;
}

/**
 * What to draw: the layout for the current key when it has landed, else the previous one (or the one carried over a remount) while it
 * still places every drawn card, else nothing (the caller draws the seed).
 */
export function drawnLayout<T extends CarriedLayout>(current: T | null, carried: T | null, key: string, ids: readonly string[]): T | null {
  const pick = current?.key === key ? current : (current ?? carried);
  if (!pick) return null;
  return ids.every((id) => pick.positions[id] !== undefined) ? pick : null;
}

/** For tests. */
export function forgetLayouts(): void {
  kept.clear();
}
