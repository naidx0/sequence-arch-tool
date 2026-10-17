/**
 * What to do when the renderer process dies: reload the window once, and if it
 * dies again within WINDOW_MS show the error dialog instead of looping.
 * Pure: the caller holds the list of recent death times (epoch ms).
 */
export const RELOAD_WINDOW_MS = 60_000;

export type RecoveryAction = { action: 'reload' | 'dialog'; recent: number[] };

export function decideRendererRecovery(
  recent: readonly number[],
  now: number,
  windowMs: number = RELOAD_WINDOW_MS
): RecoveryAction {
  const kept = recent.filter((t) => now - t < windowMs);
  return kept.length === 0
    ? { action: 'reload', recent: [now] }
    : { action: 'dialog', recent: [...kept, now] };
}
