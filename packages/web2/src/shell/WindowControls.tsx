/* ══════════════════════════════════════════════════════════════════════════
   THE WINDOW BUTTONS, DRAWN BY US
   packages/web2/src/shell/WindowControls.tsx

   Owner, 2026-09-13, on the first frameless cut: "on ML Harness we did a
   really good job with the way we were able to use the minimise, close, expand
   within our application. Right now it doesn't look as good."

   THE DIFFERENCE IS WHO DRAWS THEM. That cut used Electron's `titleBarOverlay`:
   Chromium hides its frame and then paints the SYSTEM buttons over our bar —
   the platform's glyphs, at the platform's metrics, on a rectangle we are
   allowed to colour and nothing else. They sit in our chrome without belonging
   to it. ML Harness is Tauri with `decorations: false` and draws its own, and
   that is the entire reason it reads better.

   So the window is frameless (`frame: false`, desktop/src/main.ts) and these
   three are ours: our icon rung, our radius, our hover, our tokens.

   ── WHAT THIS IS CAREFUL ABOUT ───────────────────────────────────────────

   IT DRAWS NOTHING IN A BROWSER TAB. A web page cannot minimise anything, and
   three dead buttons over a tab that already has its own controls would be the
   worst of both. The gate is `shell` being a FUNCTION on the bridge, not
   `isDesktop()` — `isDesktop()` only ever promised `openRepo`, and a shell
   built before 2026-09-12 has no `shell` channel at all.

   CLOSE IS THE LAST BUTTON AND THE ONLY RED ONE. Every desktop platform puts
   it last and marks it; a close button that looks like its neighbours is a
   mis-click that loses work. It takes `--wont` on hover — the one place in
   this product where that hue is not a verdict about the repository but about
   what the press is going to do, which is said here because Graphite law 1
   would otherwise be silently bent.

   THE MAXIMISE GLYPH IS READ BACK, NEVER ASSUMED. Each press returns the
   resulting state from the main process and the glyph redraws from THAT, so a
   window maximised by a double-click on the bar, by the OS, or by a chord
   still shows the right shape. Assuming the press worked is how a control
   starts lying about the thing it controls.
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { Icon } from '../chat/Icon';
import { desktopBridge } from '../boot/desktopBridge';
import type { DesktopHost } from '../boot/desktopBridge';

/** What `window-state` and the two state-changing actions answer with. */
function maximizedFrom(answer: unknown): boolean | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const value = (answer as { maximized?: unknown }).maximized;
  return typeof value === 'boolean' ? value : null;
}

export interface WindowControlsProps {
  /** A test double for the bridge. Omitted in the app, which reads `window`. */
  host?: DesktopHost;
}

export function WindowControls({ host }: WindowControlsProps): JSX.Element | null {
  const bridge = desktopBridge(host);
  /*
   * MEMOISED, and the case below is why. `bind` returns a NEW function every
   * call, so an unmemoised `run` changed identity on every render — and the
   * mount effect, which depends on it, re-ran each time and asked the main
   * process for the window state again. Caught by
   * "sends each action, and READS THE STATE BACK": it counted five calls where
   * four were sent. `window.sequence` is one stable object, so keying on the
   * bridge holds the identity still.
   */
  const run = useMemo(
    () => (typeof bridge?.shell === 'function' ? bridge.shell.bind(bridge) : null),
    [bridge],
  );
  const [maximized, setMaximized] = useState(false);

  /* Ask once on mount: the window may already be maximised before this ever
     rendered — restored by the OS from the last session, or opened that way. */
  useEffect(() => {
    if (run === null) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const state = maximizedFrom(await run('window-state'));
        if (!cancelled && state !== null) setMaximized(state);
      } catch {
        /* An older shell that does not know this action leaves the glyph on
           its default. A throw here must never take the app bar down with it. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  const press = useCallback(
    async (action: string) => {
      if (run === null) return;
      try {
        const state = maximizedFrom(await run(action));
        if (state !== null) setMaximized(state);
      } catch {
        /* Same reason as above. `window-close` resolves with nothing and there
           is no pane left to update either way. */
      }
    },
    [run],
  );

  if (run === null) return null;

  return (
    <span className="shell-winctl" data-testid="shell-window-controls">
      <button
        type="button"
        className="shell-winbtn"
        data-testid="shell-window-minimize"
        aria-label="Minimise"
        title="Minimise"
        onClick={() => void press('window-minimize')}
      >
        <Icon name="win-minimize" size={14} />
      </button>
      <button
        type="button"
        className="shell-winbtn"
        data-testid="shell-window-maximize"
        aria-label={maximized ? 'Restore down' : 'Maximise'}
        title={maximized ? 'Restore down' : 'Maximise'}
        onClick={() => void press('window-maximize-toggle')}
      >
        <Icon name={maximized ? 'win-restore' : 'win-maximize'} size={14} />
      </button>
      <button
        type="button"
        className="shell-winbtn shell-winbtn-close"
        data-testid="shell-window-close"
        aria-label="Close"
        title="Close"
        onClick={() => void press('window-close')}
      >
        <Icon name="x" size={14} />
      </button>
    </span>
  );
}
