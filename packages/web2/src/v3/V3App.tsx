import { useEffect } from 'react';

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

import { CanvasProvider, DocProvider, seqdFromGraph } from '../canvas';
import { createBootTransport, onDesktopHelp } from '../boot';
import { openRepoSession } from '../sessions/openRepoSession';
import { flushAndReload } from '../sessions/sessionPersist';
import { createSessionsClient } from '../sessions/sessionsClient';
import {
  readAutoEditEnabled,
  readFullAccessEnabled,
} from '../settings/autonomyPreference';
import { readShellPersisted, readShellTokens } from '../shell';
import {
  ConnectedBootHydrate,
  StoreProvider,
  createStore,
  type Store,
  useStore,
} from '../state';
import type { PermissionMode } from '../state/types';
import { softLoadSession } from './sessionActions';
import { V3Shell } from './V3Shell';

const transport = createBootTransport();
const sessionsClient = createSessionsClient();

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
    const mode = localStorage.getItem('v3.composer.mode');
    if (mode === 'build' && enabled.includes('build')) {
      target.dispatch({ type: 'composer/permission', mode: 'build' });
    } else if (mode === 'teach') {
      target.dispatch({ type: 'composer/teach', on: true });
      target.dispatch({ type: 'composer/permission', mode: 'plan' });
    }
  } catch {
    /* ignore */
  }
}

hydrateAutonomy(store);

async function openProject(target: Store, repoPath: string, sessionId: string): Promise<void> {
  const result = await openRepoSession(transport, sessionsClient, repoPath, sessionId);
  if (result.outcome !== 'ok') {
    console.error('[v3] open project failed:', result.message);
    return;
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
}

function V3AppInner() {
  const activeStore = useStore();

  useEffect(() => {
    return onDesktopHelp(() => {
      activeStore.dispatch({ type: 'shell/overlay', overlay: { kind: 'help' } });
    });
  }, [activeStore]);

  return (
    <CanvasProvider>
      <DocProvider>
        <V3Shell
          onOpenProject={(repoPath, sessionId) => {
            void openProject(activeStore, repoPath, sessionId);
          }}
          onOpenSettings={() =>
            activeStore.dispatch({
              type: 'shell/overlay',
              overlay: { kind: 'settings', pane: 'provider' },
            })
          }
        />
      </DocProvider>
    </CanvasProvider>
  );
}

export function V3App({ appStore = store }: { appStore?: Store } = {}) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  useEffect(() => {
    hydrateAutonomy(appStore);
  }, [appStore]);

  return (
    <StoreProvider store={appStore}>
      <ConnectedBootHydrate transport={transport} />
      <V3AppInner />
    </StoreProvider>
  );
}
