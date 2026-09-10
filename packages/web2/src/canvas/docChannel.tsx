/* ══════════════════════════════════════════════════════════════════════════
   THE DOCUMENT CHANNEL — one editable `.seqd` for every surface that edits it
   packages/web2/src/canvas/docChannel.tsx

   THE SAME SHAPE AS `canvasChannel.tsx`, FOR THE SAME REASON, AND IT SAYS SO
   THERE: the canvas family belongs in `state/store.ts`, and it is not folded in
   yet because `state/` is another lane's tree and CANON §6 costs a repair cycle
   every time two lanes edit one file. This provider is the same handback —

       case 'doc/…': …  →  return { ...state, docSession:
                             docSessionReduce(state.docSession, action) };

   — and nothing about the shape changes when it moves.

   WHY A CHANNEL AND NOT PROPS. Editing is not the board's alone. The composer
   edits by chat, the rail renames from a tree row, and the Draw layer creates
   by gesture; three surfaces holding three copies of one document is exactly
   the defect `canvasChannel`'s header describes, where the rail and the board
   were "two React trees with no state between them". One document, one funnel.

   THE STORE STILL OWNS THE SCAN. This provider never fetches. It watches the
   document the store already produced and feeds it in as a BASE, and
   `docSessionReduce` decides whether a base may replace what the user has
   drawn. That division is the point: the store knows what the scanner found,
   this knows what the person did, and only the session knows how to reconcile
   them.
   ══════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { SeqDiagramV1 } from '@sequence/schema';

import {
  EMPTY_DOC_SESSION,
  type DocSession,
  type DocSessionAction,
  docSessionReduce,
} from './docSession.js';
import { fromBoardSeqd } from '../sessions/boardMemory.js';
import { useAppState } from '../state';

export interface DocChannel {
  session: DocSession;
  dispatch: (action: DocSessionAction) => void;
}

const DocContext = createContext<DocChannel | null>(null);

/**
 * IT THROWS RATHER THAN FALLING BACK TO A PRIVATE DOCUMENT.
 *
 * A default here would be a surface editing a diagram nobody else can see —
 * the bug this file removes, wearing the costume of a convenience. The message
 * names the fix, the way `useCanvas` does.
 */
export function useDoc(): DocChannel {
  const channel = useContext(DocContext);
  if (channel === null) {
    throw new Error(
      'useDoc: no <DocProvider> above this component. The board, the rail and the composer ' +
        'share one SeqDiagram; mount DocProvider inside StoreProvider in app/App.tsx.',
    );
  }
  return channel;
}

/**
 * The scanned document, or null.
 *
 * `repo.phase` is the only thing that says a document exists, and it is read
 * off the phase's own payload rather than an optional field a failed scan could
 * leave stale — the rule `ConnectedBoard` already states and follows.
 */
function scannedDoc(state: ReturnType<typeof useAppState>): SeqDiagramV1 | null {
  return state.repo.phase === 'attached' || state.repo.phase === 'stale'
    ? state.repo.repo.doc
    : null;
}

export function DocProvider({ children }: { children: ReactNode }) {
  const state = useAppState();
  const activeId = state.session.activeId;
  const [session, dispatch] = useReducer(docSessionReduce, EMPTY_DOC_SESSION);

  const fromScan = scannedDoc(state);

  /* When the active session changes, drop the previous overlay so a new thread
     cannot inherit another session's Architecture board. */
  const prevActiveId = useRef<string | null | undefined>(undefined);
  const restoredFromServer = useRef(false);

  useEffect(() => {
    const previous = prevActiveId.current;
    prevActiveId.current = activeId;
    if (previous !== undefined && previous !== activeId) {
      dispatch({ type: 'doc/reset' });
      restoredFromServer.current = false;
    } else if (previous === undefined) {
      restoredFromServer.current = false;
    }

    if (!activeId) return undefined;

    const controller = new AbortController();
    void fetch(`/api/sessions/${encodeURIComponent(activeId)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        const boardSeqd = (body as { boardSeqd?: unknown }).boardSeqd;
        if (typeof boardSeqd !== 'string' || !boardSeqd.trim()) return;
        const doc = fromBoardSeqd(boardSeqd);
        if (!doc) return;
        restoredFromServer.current = true;
        dispatch({ type: 'doc/base', doc });
      })
      .catch(() => {
        /* Unreachable server — scratch / scan paths below still apply. */
      });
    return () => controller.abort();
  }, [activeId]);

  /* KEYED ON THE DOCUMENT OBJECT, NOT ON A COUNTER OR A TIMESTAMP. The store
     replaces `repo.doc` wholesale on every scan, so identity already means
     "this is new information" and no second signal has to be kept in step with
     it. Feeding the same object twice is harmless — `docSessionReduce` compares
     `graphId` and, when there are no edits, adopting an identical document is a
     no-op the reducer performs rather than a case this effect has to guard.

     A session's stored `boardSeqd` wins over a fresh scan of the same repo:
     the reader's edits are the point of persisting per session. */
  useEffect(() => {
    if (!fromScan) return;
    if (restoredFromServer.current && session.baseGraphId === fromScan.grounded.graphId) return;
    dispatch({ type: 'doc/base', doc: fromScan });
  }, [fromScan, session.baseGraphId]);

  const channel = useMemo<DocChannel>(() => ({ session, dispatch }), [session]);

  return <DocContext.Provider value={channel}>{children}</DocContext.Provider>;
}
