/* One surface of the stage (Decision 49). The surfaces themselves are the
   product's own; only the frame around them is new. */
import { Suspense, lazy, useEffect, useState } from 'react';

import type { ChromeTabId } from '../app/chromeTabModel';
import { BrowserPane } from '../browser/BrowserPane';
import { ConnectedBoard } from '../canvas/ConnectedBoard';
import { groundedRepoRoot, useAppState } from '../state/connect';

/* Round 8 integration (perf ratchet, bootJsBytes): the Whiteboard and the AI
   Canvas draw nothing on the first frame (the first frame is the architecture
   board with its tag strip, which stays static), so the whiteboard surface
   (Whiteboard, its code cards, ask and camera) loads the first time one of
   them is opened. */
/* Perf ratchet: the Files panel (tree, operations, preview) is not drawn on the first
   frame; it loads the first time the Files surface opens. */
const ConnectedFilesPanel = lazy(() => import('../files/ConnectedFilesPanel').then((m) => ({ default: m.ConnectedFilesPanel })));
const ConnectedWhiteboard = lazy(() => import('../whiteboard/ConnectedWhiteboard').then((m) => ({ default: m.ConnectedWhiteboard })));
/* Perf ratchet (0.1.4 integrate): the terminal (pane, screen model, prompt condenser) draws nothing on the
   first frame; it loads the first time the Terminal tab opens. */
const TerminalPane = lazy(() => import('../terminal/TerminalPane').then((m) => ({ default: m.TerminalPane })));
const AgentsSurface = lazy(() => import('../agents/AgentsSurface').then((m) => ({ default: m.AgentsSurface })));
const ConnectedAiCanvas = lazy(() => import('../app/AiCanvas').then((m) => ({ default: m.ConnectedAiCanvas })));

/**
 * THE DEFAULT WORKSPACE IS A PROJECT (round 7, B6). With nothing attached the
 * terminal opens in the home workspace's own folder, the one GET /api/workspace
 * names and the server's terminal falls back to; null while unanswered.
 */
export function useWorkspaceRoot(enabled: boolean): string | null {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    void fetch('/api/workspace', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { root?: unknown } | null) => {
        if (controller.signal.aborted || !body) return;
        setRoot(typeof body.root === 'string' && body.root.trim() ? body.root : null);
      })
      .catch(() => {
        /* No answer: the pane keeps its honest "open a project" state. */
      });
    return () => controller.abort();
  }, [enabled]);
  return enabled ? root : null;
}

export function LiveSurface({ tab }: { tab: ChromeTabId }) {
  const state = useAppState();
  const repoRoot = groundedRepoRoot(state);
  const workspaceRoot = useWorkspaceRoot(tab === 'terminal' && !repoRoot);
  const body =
    tab === 'architecture' ? (
      <div className="v3-board-wrap">
        <ConnectedBoard />
      </div>
    ) : tab === 'files' ? (
      <div className="v3-files-wrap">
        <Suspense fallback={null}>
          <ConnectedFilesPanel />
        </Suspense>
      </div>
    ) : tab === 'whiteboard' ? (
      <div className="v3-whiteboard">
        <Suspense fallback={null}>
          <ConnectedWhiteboard />
        </Suspense>
      </div>
    ) : tab === 'ai-canvas' ? (
      <div className="v3-ai-canvas">
        <Suspense fallback={null}>
          <ConnectedAiCanvas />
        </Suspense>
      </div>
    ) : tab === 'terminal' ? (
      <div className="v3-terminal">
        <Suspense fallback={null}>
          <TerminalPane repoRoot={repoRoot ?? workspaceRoot} />
        </Suspense>
      </div>
    ) : tab === 'agents' ? (
      <div className="v3-agents">
        <Suspense fallback={null}>
          <AgentsSurface />
        </Suspense>
      </div>
    ) : tab === 'browser' ? (
      <div className="v3-browser">
        <BrowserPane />
      </div>
    ) : null;
  if (!body) return null;
  return (
    <div className="v3-surface" data-surface={tab}>
      {body}
    </div>
  );
}
