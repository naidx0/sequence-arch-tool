/* ══════════════════════════════════════════════════════════════════════════
   THE UPDATE NOTICE'S DATA — packages/web2/src/shell2/updatePill.ts

   `useUpdateAvailable()` answers { version } when a newer release is ready to install
   from here, else null. The status bar draws it as one of its own items; this file owns
   no styling.

   One request, 10 s after the bar mounts and then at the next idle (BOOT_GRACE_MS, afterIdle), so it is never inside the
   boot request window that tools/measure/first-board.mjs counts (it ends at the first layout, under a second) and the
   bootRequests ceiling in tools/measure/perf-ratchet.json does not move. The route answers from the server's cache when
   it is fresh; when it is stale and Settings > updates.check is on, that GET itself asks GitHub once (check(false) can
   fetch), which is the first check at launch landing here if the server's own 60 s timer has not fired yet. With the
   switch off it never reaches the network.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import { createVersionClient, type UpdateSnapshot, type VersionClient } from '../settings/versionClient';

/** requestIdleCallback's own ceiling, and the timer used where there is none. */
export const IDLE_FALLBACK_MS = 30_000;
/** Nothing is asked in the first seconds: an idle callback fires the moment the first frame settles, which is still boot
 *  (the boot request window of tools/measure/first-board.mjs ends at the first layout, well under a second). */
export const BOOT_GRACE_MS = 10_000;

export interface UpdateNotice {
  version: string;
}

type IdleHost = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Run `fn` once the page is idle (after a 10 s boot grace; 30 s in all where the browser has no idle callback). Returns the cancel. */
export function afterIdle(fn: () => void, host: IdleHost = globalThis as IdleHost): () => void {
  let cancelIdle: () => void = () => undefined;
  const grace = setTimeout(() => {
    if (typeof host.requestIdleCallback === 'function') {
      const id = host.requestIdleCallback(fn, { timeout: IDLE_FALLBACK_MS });
      cancelIdle = () => host.cancelIdleCallback?.(id);
    } else {
      const t = setTimeout(fn, IDLE_FALLBACK_MS - BOOT_GRACE_MS);
      cancelIdle = () => clearTimeout(t);
    }
  }, BOOT_GRACE_MS);
  return () => {
    clearTimeout(grace);
    cancelIdle();
  };
}

/** A newer release this install can take: the server's own `installable` (newer, pinned to our releases, desktop app). */
export function noticeFrom(snap: UpdateSnapshot | null): UpdateNotice | null {
  const c = snap?.check;
  if (!c || !c.newer || !c.installable || !c.latest) return null;
  return { version: c.latest.version };
}

export interface UpdatePillDeps {
  client?: VersionClient;
  idle?: (fn: () => void) => () => void;
}

export function useUpdateAvailable(deps: UpdatePillDeps = {}): UpdateNotice | null {
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const { client, idle } = deps;
  useEffect(() => {
    let live = true;
    const api = client ?? createVersionClient();
    const cancel = (idle ?? afterIdle)(() => {
      void api
        .update()
        .then((snap) => {
          if (live) setNotice(noticeFrom(snap));
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
      cancel();
    };
  }, [client, idle]);
  return notice;
}
