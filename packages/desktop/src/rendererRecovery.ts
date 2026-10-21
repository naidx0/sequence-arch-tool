/**
 * What to do when the renderer process dies: reload the window once, and if it
 * dies again within WINDOW_MS show the Reload / Quit dialog instead of looping.
 * Pure: the caller holds the list of recent death times (epoch ms).
 *
 * APP-01: deaths less than COALESCE_MS apart are ONE death. main.log showed two
 * `crashed exitCode=7` lines 35 ms apart (the second event arrived right after
 * the auto-reload), and counting them twice sent the app to a dead-end dialog.
 *
 * Only duplicate reports of the SAME death coalesce: those arrive before the reloaded page
 * has loaded. Once the reload has settled (`reloadSettled`), any death is a new one and
 * must act, so a renderer that crashes again 1.5 s after its reload gets the dialog.
 */
export const RELOAD_WINDOW_MS = 60_000;
export const COALESCE_MS = 2_000;

export type RecoveryAction = {
  action: 'reload' | 'dialog';
  recent: number[];
  /** True when this death is the same death as the last one: a reload is already under way, do not start another. */
  coalesced: boolean;
};

export function decideRendererRecovery(
  recent: readonly number[],
  now: number,
  windowMs: number = RELOAD_WINDOW_MS,
  coalesceMs: number = COALESCE_MS,
  /** True once the reloaded page finished loading: from then on a death is a new death, never a duplicate. */
  reloadSettled: boolean = false
): RecoveryAction {
  const kept = recent.filter((t) => now - t < windowMs);
  if (kept.length === 0) return { action: 'reload', recent: [now], coalesced: false };
  const last = kept[kept.length - 1] as number;
  if (!reloadSettled && now - last < coalesceMs) {
    /* Same death reported twice. If the first one was already past its reload the
       window is already coming back; if it was a dialog death the dialog is open. */
    return { action: kept.length === 1 ? 'reload' : 'dialog', recent: kept, coalesced: true };
  }
  return { action: 'dialog', recent: [...kept, now], coalesced: false };
}

/** The buttons of the "window stopped" box, in order. The window never stays dead: both choices act. */
export const RENDERER_DIALOG_BUTTONS = ['Reload', 'Quit'] as const;

/** Which button was pressed. Anything but Quit reloads: dismissing the box must not leave a dead window. */
export function rendererDialogChoice(response: number | undefined): 'reload' | 'quit' {
  return response === 1 ? 'quit' : 'reload';
}
