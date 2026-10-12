/* ══════════════════════════════════════════════════════════════════════════
   MOUNTS THE S5 WATCHER ONCE, AT THE SHELL
   packages/web2/src/notify/AttentionHost.tsx

   Loaded lazily by AttentionBoot.tsx (first blur or hide). Renders nothing. Starts `startAttention` over the page's one run store and
   says how to bring a chat forward when a notification is clicked: open the
   run's thread if another one is on screen, then focus the composer.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';

import { agentRuns } from '../agents/agentRuns';
import { readAttentionEnabled } from '../settings/attentionPreference';
import { useAppState, useStore } from '../state/connect';
import { activateSession } from '../v3/sessionActions';
import { browserNotifier, desktopAttention, pageVisible, startAttention } from './attention';

export function AttentionHost() {
  const store = useStore();
  const state = useAppState();
  const activeId = useRef<string | null>(state.session.activeId ?? null);
  activeId.current = state.session.activeId ?? null;

  useEffect(() => {
    const handle = startAttention({
      runs: agentRuns,
      isVisible: pageVisible,
      desktop: desktopAttention(),
      browser: browserNotifier(),
      prefs: (kind) => readAttentionEnabled(kind),
      /* Started by AttentionBoot the first time the window goes to the
         background: an approval already waiting then is news. */
      seed: 'runs',
      focusChat: (run) => {
        if (run?.sessionId && run.sessionId !== activeId.current) void activateSession(store, run.sessionId);
        store.dispatch({ type: 'composer/focus' });
      },
    });
    /* Focus coming back is when a badge stops being true; the desktop main
       process clears its own, and this re-reads so the count it holds is fresh. */
    const onFocus = (): void => handle.check();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      handle.stop();
    };
  }, [store]);

  return null;
}

export default AttentionHost;
