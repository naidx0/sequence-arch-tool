/* The board's view state, kept in the URL hash (viewState.ts) so it survives a
   reload and a shared link opens the same board. replaceState, not a push: a
   view change is not a page the Back button should walk through. */

import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_VIEW_STATE, fromHash, isBoardHash, toHash, type BoardViewState } from './viewState';

function readHash(): BoardViewState {
  if (typeof window === 'undefined') return DEFAULT_VIEW_STATE;
  const hash = window.location.hash;
  return isBoardHash(hash) ? fromHash(hash) : DEFAULT_VIEW_STATE;
}

export function useBoardView(
  /** Which repository and scan; a different one starts from the default view. */
  identity: string | null,
): [BoardViewState, (update: (was: BoardViewState) => BoardViewState) => void] {
  const [view, setView] = useState<BoardViewState>(readHash);
  const lastIdentity = useRef<string | null>(identity);

  useEffect(() => {
    const was = lastIdentity.current;
    lastIdentity.current = identity;
    /* Null -> a repo is the page loading; keep the view the link asked for. */
    if (was !== null && identity !== null && was !== identity) setView(DEFAULT_VIEW_STATE);
  }, [identity]);

  useEffect(() => {
    if (typeof window === 'undefined' || identity === null) return;
    const next = toHash(view);
    if (window.location.hash !== next) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${next}`);
    }
  }, [view, identity]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHash = () => {
      if (isBoardHash(window.location.hash)) setView(fromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      /* The board left the screen (its pane closed): the URL stops describing
         a board that is not there. */
      if (isBoardHash(window.location.hash)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
    };
  }, []);

  const update = useCallback((fn: (was: BoardViewState) => BoardViewState) => setView(fn), []);
  return [view, update];
}
