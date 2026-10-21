/* ══════════════════════════════════════════════════════════════════════════
   ONE SEQUENCE AT A TIME (round 7, A8)
   packages/desktop/src/singleInstance.ts

   Jaden: "From double click on desktop to boot up, it's taking a very long
   time." Measured on the packaged app: with an earlier Sequence still alive
   (two windowless ones were, on this machine), a new launch shares its
   Chromium profile and waits on it: composer at 6.5 s instead of 0.8 s, and
   a second app with a second server. Now the second launch hands over to the
   one already running, which shows (or re-creates) its window, and exits.

   And quitting never lingers: the server's teardown is bounded, after which
   the process exits anyway, so a closed Sequence cannot sit windowless
   holding the profile for the next launch.
   ══════════════════════════════════════════════════════════════════════════ */

export interface LockApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): unknown;
}

export interface WindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  isVisible(): boolean;
  show(): void;
  focus(): void;
}

/**
 * Take the single-instance lock. False means another Sequence holds it: the
 * caller quits at once (that one has been told to show itself). Smoke runs
 * are measurements of a fresh launch and skip the lock.
 */
export function claimSingleInstance(app: LockApp, opts: { smoke: boolean; onSecondInstance: () => void }): boolean {
  if (opts.smoke) return true;
  if (!app.requestSingleInstanceLock()) return false;
  app.on('second-instance', opts.onSecondInstance);
  return true;
}

/** Bring the running window forward, or make one if it is gone. */
export function showOrCreate(win: WindowLike | null, create: () => void): 'focused' | 'created' {
  if (!win || win.isDestroyed()) {
    create();
    return 'created';
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return 'focused';
}

/** Run `stop`, but give up waiting after `ms`: a quit must end the process. */
export async function stopWithin(stop: () => Promise<void>, ms: number): Promise<'stopped' | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([stop().then(() => 'stopped' as const, () => 'stopped' as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
