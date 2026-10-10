/* ══════════════════════════════════════════════════════════════════════════
   A COMPONENT LOADED AFTER BOOT THAT RENDERS AT ONCE ONCE LOADED
   packages/web2/src/canvas/preloadable.tsx

   The board's click-only parts (node menu, edge evidence) and the agent
   overlay are kept out of boot JS (perf ratchet, bootJsBytes). React.lazy
   would suspend on the first render even when the chunk is already in, which
   would make a right-click open its menu one frame late; this wrapper renders
   synchronously once `preload()` has resolved, and the board preloads all of
   them when the browser is idle after the first board.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, type ComponentType } from 'react';

export interface Preloadable<P> {
  Component: (props: P) => JSX.Element | null;
  preload: () => Promise<void>;
}

export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
  /* `loadOnMount: false` for a part that may wait for the idle preload (the
     agent overlay draws nothing of its own); a click-only part loads the
     moment it is first rendered. */
  { loadOnMount = true }: { loadOnMount?: boolean } = {},
): Preloadable<P> {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const waiting = new Set<() => void>();
  const preload = (): Promise<void> => {
    pending ??= load().then((c) => {
      Loaded = c;
      for (const wake of [...waiting]) wake();
    });
    return pending;
  };
  function Component(props: P): JSX.Element | null {
    const [, setReady] = useState(Loaded !== null);
    useEffect(() => {
      /* Loaded between this render and this effect: show it now. */
      if (Loaded) {
        setReady(true);
        return undefined;
      }
      const wake = () => setReady(true);
      waiting.add(wake);
      if (loadOnMount) void preload();
      return () => {
        waiting.delete(wake);
      };
    }, []);
    return Loaded ? <Loaded {...props} /> : null;
  }
  return { Component, preload };
}

/* The board's after-boot parts, one place, so the board and the test setup
   preload the same set. */
export const LazyBoardMenu = preloadable(() => import('./BoardMenu.js').then((m) => m.BoardMenu));
export const LazyEdgeEvidence = preloadable(() => import('./EdgeEvidence.js').then((m) => m.EdgeEvidence));
export const LazyBoardControlsBody = preloadable(() => import('./BoardControlsBody.js').then((m) => m.BoardControlsBody));
export const LazyAgentOverlay = preloadable(() => import('./AgentOverlay.js').then((m) => m.AgentOverlay), { loadOnMount: false });
/* Only drawn when an agent node of a workflow board is selected. */
export const LazyAgentInspector = preloadable(() => import('./AgentInspector.js').then((m) => m.AgentInspector));
/* Round 7 (perf ratchet, bootJsBytes): only an agent-workflow document draws
   the launch bar, so it loads when first drawn, never at boot. */
export const LazyWorkflowLaunchBar = preloadable(() => import('./WorkflowLaunchBar.js').then((m) => m.WorkflowLaunchBar));

/* Round 8: the architecture board's drawing layer, its capture and palette
   (one chunk). Marks render as soon as the board has any; the capture and the
   palette only in Draw. */
const archDraw = () => import('./boards/ArchDraw.js');
export const LazyArchMarks = preloadable(() => archDraw().then((m) => m.ArchMarks));
export const LazyArchCapture = preloadable(() => archDraw().then((m) => m.ArchCapture));
export const LazyArchPalette = preloadable(() => archDraw().then((m) => m.ArchPalette));

export function preloadBoardExtras(): Promise<void> {
  return Promise.all([
    LazyBoardMenu.preload(),
    LazyEdgeEvidence.preload(),
    LazyBoardControlsBody.preload(),
    LazyAgentOverlay.preload(),
    LazyAgentInspector.preload(),
  ]).then(() => undefined);
}
