import { useEffect, useLayoutEffect, useState } from 'react';

/*
 * STYLESHEET ORDER IS LOAD-BEARING AND IS NOT ALPHABETICAL.
 * Decision 22 — product chrome is V3. Tokens first, then base, then pane sheets,
 * then overlay sheets, then v3.css last so chrome can raise off anything it covers.
 * A sheet whose position cannot be argued does not go in.
 */
import '../tokens/graphite.css';
import '../styles/base.css';
import '../canvas/board.css';
import '../files/files.css';
import '../whiteboard/whiteboard.css';
import '../app/aiCanvas.css';
import '../settings/settings.css';
import '../search/search.css';
import '../help/help.css';
import '../review/review.css';
import '../activity/activity.css';
import '../rewind/rewind.css';
import '../chat/chat.css';
import '../rail/rail.css';
import './v3.css';
/* Decision 49: the reskin shell, last, so it raises off everything it frames. */
import '../shell2/shell2.css';
import '../shell2/chat2.css';
import '../shell2/edits.css';

import { CanvasProvider, DocProvider, seqdFromGraph } from '../canvas';
import { ACCESS_STORAGE_KEY } from '../chat/accessMode';
import { MODE_NOTE_KEY, loadSavedMode } from '../chat/composerModelModes';
import { rememberPlace } from '../sessions/lastPlaceClient';
import { createBootTransport, onDesktopHelp } from '../boot';
import { openRepoSession, openWorkspaceSession } from '../sessions/openRepoSession';
import { clearSessionFlush, flushAndReload, flushSessionMemory } from '../sessions/sessionPersist';
import { sessionsClient } from '../sessions/sessionsClient';
import { inPlaceSwitchEnabled, switchWorkspaceInPlace } from '../sessions/workspaceSwitch';
import { RescanController } from '../app/RescanController';
import { SwitchProgress } from '../sessions/SwitchProgress';
import {
  readAutoEditEnabled,
  readFullAccessEnabled,
} from '../settings/autonomyPreference';
import { readShellPersisted, readShellTokens } from '../shell';
import { watchTheme } from '../settings/themePreference';
import {
  ConnectedBootHydrate,
  StoreProvider,
  createStore,
  type Store,
  useStore,
} from '../state';
import type { PermissionMode } from '../state/types';
import { FirstRunGate } from '../onboarding/FirstRunGate';
import { softLoadSession } from './sessionActions';
import { Shell2 } from '../shell2/Shell2';

const transport = createBootTransport();


const store = createStore({
  project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
  tokens: readShellTokens(document.documentElement),
  persisted: readShellPersisted(),
});

function hydrateAutonomy(target: Store): void {
  const enabled: PermissionMode[] = ['plan'];
  if (readAutoEditEnabled() || readFullAccessEnabled()) enabled.push('build');
  target.dispatch({ type: 'composer/permission-enabled', enabled });

  try {
    /* Saved mode and access load as one of the three modes (chat/composerModelModes.ts). A saved Ask never
       widens: it loads as Plan, is rewritten once through the same keys the composer saves to, and owes one note. */
    const load = loadSavedMode(localStorage.getItem('v3.composer.mode'), localStorage.getItem(ACCESS_STORAGE_KEY), enabled.includes('build'));
    if (load.intent) target.dispatch({ type: 'composer/permission', mode: load.intent });
    /* A remembered Full access is re-checked against the project's own consent by the composer (chat/AccessControl.tsx). */
    if (load.access) target.dispatch({ type: 'composer/access', access: load.access });
    if (load.rewrite) {
      localStorage.setItem('v3.composer.mode', load.rewrite.mode);
      localStorage.setItem(ACCESS_STORAGE_KEY, load.rewrite.access);
      rememberPlace({ mode: load.rewrite.mode });
      if (load.note) localStorage.setItem(MODE_NOTE_KEY, '1');
    }
  } catch {
    /* ignore */
  }
}

hydrateAutonomy(store);

/** Write the chat being left to the root it lives in, before the root changes under it. */
const leaveChat = async (): Promise<void> => {
  await flushSessionMemory(600);
  clearSessionFlush();
};

/**
 * Go to a chat that belongs to no repository.
 *
 * The same shape as {@link openProject} with the opposite verb: that one
 * attaches a folder, and being in the workspace is being attached to nothing.
 * Routing a workspace row through the attach door is what made every one of
 * them unclickable — the browse jail refuses the home directory by name.
 */
async function openWorkspace(target: Store, sessionId: string): Promise<string | null> {
  if (inPlaceSwitchEnabled()) {
    const moved = await switchWorkspaceInPlace({ store: target, transport, sessions: sessionsClient, leave: leaveChat }, null, sessionId);
    if (moved.outcome === 'ok') return null;
    if (moved.outcome === 'refused') return moved.message;
    await flushAndReload();
    return null;
  }
  const result = await openWorkspaceSession(transport, sessionsClient, sessionId, leaveChat);
  if (result.outcome !== 'ok') {
    return result.message;
  }
  target.dispatch({
    type: 'session/index',
    sessions: target.getState().session.sessions,
    activeId: sessionId,
  });
  target.dispatch({ type: 'session/hydrating' });
  void softLoadSession(target, sessionId, undefined, sessionsClient);
  await flushAndReload();
  return null;
}

async function openProject(target: Store, repoPath: string, sessionId: string): Promise<string | null> {
  if (inPlaceSwitchEnabled()) {
    const moved = await switchWorkspaceInPlace({ store: target, transport, sessions: sessionsClient, leave: leaveChat }, repoPath, sessionId);
    if (moved.outcome === 'ok') return null;
    if (moved.outcome === 'refused') return moved.message;
    await flushAndReload();
    return null;
  }
  const result = await openRepoSession(transport, sessionsClient, repoPath, sessionId, leaveChat);
  if (result.outcome !== 'ok') {
    return result.message;
  }
  /* Optimistic transcript before full reload so the seat sees the right chat. */
  target.dispatch({
    type: 'session/index',
    sessions: target.getState().session.sessions,
    activeId: sessionId,
  });
  target.dispatch({ type: 'session/hydrating' });
  void softLoadSession(target, sessionId, undefined, sessionsClient);
  await flushAndReload();
  return null;
}

function V3AppInner() {
  const activeStore = useStore();
  const [openFailure, setOpenFailure] = useState<{ message: string; retry: () => void } | null>(null);
  function runOpen(request: () => Promise<string | null>) {
    setOpenFailure(null);
    void request().then(message => {
      if (message) setOpenFailure({ message, retry: () => runOpen(request) });
    }).catch((error: unknown) => setOpenFailure({
      message: error instanceof Error ? error.message : String(error), retry: () => runOpen(request),
    }));
  }

  useEffect(() => {
    return onDesktopHelp(() => {
      activeStore.dispatch({ type: 'shell/overlay', overlay: { kind: 'help' } });
    });
  }, [activeStore]);

  return (
    <CanvasProvider>
      <DocProvider>
        <Shell2
          openFailure={openFailure}
          onDismissOpenFailure={() => setOpenFailure(null)}
          onOpenProject={(repoPath, sessionId) => {
            runOpen(() => openProject(activeStore, repoPath, sessionId));
          }}
          onOpenWorkspace={(sessionId) => {
            runOpen(() => openWorkspace(activeStore, sessionId));
          }}
          onOpenSettings={() =>
            activeStore.dispatch({
              type: 'shell/overlay',
              overlay: { kind: 'settings', pane: 'provider' },
            })
          }
        />
        <FirstRunGate />
      </DocProvider>
    </CanvasProvider>
  );
}

export function V3App({ appStore = store }: { appStore?: Store } = {}) {
  useEffect(() => watchTheme(), []);
  /* A layout effect: the saved mode is in the store before the first paint, and (parents' layout effects
     run after their children's, before any passive effect) before the composer looks for the note it owes. */
  useLayoutEffect(() => {
    hydrateAutonomy(appStore);
  }, [appStore]);

  return (
    <StoreProvider store={appStore}>
      <ConnectedBootHydrate transport={transport} />
      <V3AppInner />
      <RescanController />
      <SwitchProgress />
    </StoreProvider>
  );
}
