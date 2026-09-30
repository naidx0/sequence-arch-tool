/**
 * ConnectedWhiteboard — store-backed agent drawing surface.
 * packages/web2/src/whiteboard/ConnectedWhiteboard.tsx
 */

import { Whiteboard } from './Whiteboard';
import { whiteboardKey } from './whiteboardModel';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';

export function ConnectedWhiteboard() {
  const state = useAppState();
  const store = useStore();
  const repoRoot = groundedRepoRoot(state);
  const graph = state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo.graph : null;

  return (
    <Whiteboard
      repoRoot={repoRoot}
      storageKey={whiteboardKey(state.session.activeId)}
      graph={graph}
      agentItems={state.session.boardAgentItems}
      intentGhosts={state.session.boardIntentGhosts}
      onAsk={(request) => {
        store.dispatch({ type: 'composer/draft', text: request.prompt });
        store.dispatch({ type: 'composer/focus' });
      }}
      onPin={({ id, ghostAt, at }) => {
        store.dispatch({ type: 'board/pin', id, ghostAt, at });
      }}
    />
  );
}
