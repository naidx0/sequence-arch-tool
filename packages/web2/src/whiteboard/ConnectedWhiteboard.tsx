/**
 * ConnectedWhiteboard — the Whiteboard surface, on the project's boards store.
 * packages/web2/src/whiteboard/ConnectedWhiteboard.tsx
 *
 * Round 8 (lab/specs/r8-boards.md): the whiteboard is one of the project's
 * boards (`/api/boards`), picked from the same tag strip the Architecture
 * surface shows. The person's changes go back as ops (`diffOps` against the
 * store's last copy); an agent's `draw` through the MCP arrives on the boards
 * stream and is adopted without a reload.
 *
 * ONE-TIME IMPORT: before round 8 a whiteboard lived in localStorage per chat
 * session. The first time the default board is opened empty, that sketch is
 * written into it, so nobody's drawing is lost to the move.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { BoardTabs } from '../canvas/boards/BoardTabs';
import { boardsApi, setActiveWhiteboard, useActiveWhiteboard, useBoardDoc, useBoardsIndex } from '../canvas/boards/boardsClient';
import { ARCH_BOARD_ID, diffOps, nextBoardName } from '../canvas/boards/boardsModel';
import { requestHostCommand } from '../app/hostCommands';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { sendBoardAsk } from '../askInPlace/sendBoardAsk';
import { Whiteboard } from './Whiteboard';
import { readWhiteboard, whiteboardKey, writeWhiteboard, type WbItem, type WhiteboardDoc } from './whiteboardModel';

const LIVE_GRACE_MS = 1500;
const liveNow = (inFlight: boolean, until: number): boolean => inFlight || Date.now() < until;

export function ConnectedWhiteboard() {
  const state = useAppState();
  const store = useStore();
  /* A TURN IS LIVE UNTIL SHORTLY AFTER IT ENDS. React batches a whole burst of stream events into one render, so a short
     answer can start and finish between two renders and the board would never see `inFlight` set. The store tells us on
     every dispatch, and the window is long enough to cover that render and no longer: a chat switch or a reload, which
     replay old marks, must not look like a drawing arriving. */
  const liveUntil = useRef(0);
  useEffect(
    () =>
      store.subscribe(() => {
        if (store.getState().session.inFlight !== null) liveUntil.current = Date.now() + LIVE_GRACE_MS;
      }),
    [store],
  );
  const repoRoot = groundedRepoRoot(state);
  const project = repoRoot ?? 'workspace';
  const graph = state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo.graph : null;

  const { index, refresh, failed } = useBoardsIndex(true);
  const chosen = useActiveWhiteboard(project);
  const whiteboards = (index?.boards ?? []).filter((b) => b.kind === 'whiteboard');
  /* The board you were last on, else the first whiteboard. */
  const current = index === null ? null : (whiteboards.find((b) => b.id === chosen) ?? whiteboards[0] ?? null);
  const board = useBoardDoc(current?.id ?? null, current !== null);
  const doc = board.doc && board.doc.id === current?.id ? board.doc : null;

  /* What the store holds, as last seen: the baseline a change is diffed against. */
  const known = useRef<{ id: string; rev: number; items: readonly WbItem[] } | null>(null);
  /* Set in render, not in an effect: the surface adopts the new copy in ITS
     effect, which runs first, and reports it back through onDocChange — that
     report must already diff against the new copy (to nothing), or the
     store's own change would be written back to it. */
  if (doc && (known.current?.id !== doc.id || known.current.rev !== doc.rev)) {
    known.current = { id: doc.id, rev: doc.rev, items: doc.items };
  }
  const external = useMemo<WhiteboardDoc | null>(() => (doc ? { version: 1, items: doc.items } : null), [doc]);

  /* The surface hydrates from this, once per board: the store's copy if it
     is in, else empty until it arrives (then `externalDoc` adopts it). */
  const externalRef = useRef(external);
  externalRef.current = external;
  const storage = useMemo(
    () => ({
      getItem: () => (externalRef.current ? writeWhiteboard(externalRef.current) : null),
      setItem: () => undefined,
    }),
    // Re-made per board, never per revision: a new storage object re-hydrates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.id],
  );

  const write = board.write;
  const onDocChange = useCallback(
    (next: WhiteboardDoc) => {
      const base = known.current;
      if (!base || base.id !== current?.id) return;
      const ops = diffOps(base.items, next.items);
      if (ops.length === 0) return;
      known.current = { ...base, items: next.items };
      void write(ops);
    },
    [current?.id, write],
  );

  /* The localStorage sketch from before round 8, into the default board once. */
  const sessionKey = whiteboardKey(state.session.activeId);
  useEffect(() => {
    if (!doc || doc.id !== 'whiteboard' || doc.rev !== 0 || doc.items.length > 0) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(sessionKey);
    } catch {
      return;
    }
    const old = readWhiteboard(raw).items.filter((i) => i.kind !== 'artifact');
    if (old.length > 0) void write(old.map((item) => ({ op: 'put' as const, item })));
  }, [doc, sessionKey, write]);

  return (
    <div className="wb-boards wb-boards-free" data-testid="wb-boards" data-board={current?.id ?? ''}>
      <BoardTabs
        index={index}
        current={current?.id ?? ''}
        itemCount={(id) => (id === doc?.id ? doc.items.length : null)}
        onOpen={(b) => {
          if (b.id === ARCH_BOARD_ID) requestHostCommand('canvas.board');
          else setActiveWhiteboard(project, b.id);
        }}
        onCreate={() => {
          void boardsApi.create(nextBoardName(index)).then((meta) => {
            setActiveWhiteboard(project, meta.id);
            refresh();
          }, () => undefined);
        }}
        onRename={(id, name) => void boardsApi.rename(id, name).then(refresh, refresh)}
        onDelete={(id) => void boardsApi.remove(id).then(refresh, refresh)}
      />
      {board.error ? (
        <p className="wb-boards-note" role="status" data-testid="wb-boards-error">
          This board could not be saved: {board.error}
        </p>
      ) : null}
      <div className="wb-boards-body">
        {index !== null && current === null ? (
          <p className="wb-boards-note" data-testid="wb-boards-none">
            No whiteboards in this project. Press + to make one.
          </p>
        ) : (
          <Whiteboard
            /* NO STORE (no server answered): the session's own pad in
               localStorage, exactly as before boards had a store. */
            key={failed ? 'local' : `board:${current?.id ?? ''}`}
            repoRoot={repoRoot}
            {...(failed
              ? { storageKey: whiteboardKey(state.session.activeId) }
              : { storage, storageKey: `board:${current?.id ?? ''}`, externalDoc: external, onDocChange })}
            graph={graph}
            agentItems={state.session.boardAgentItems}
            live={liveNow(state.session.inFlight !== null, liveUntil.current)}
            intentGhosts={state.session.boardIntentGhosts}
            onAsk={(request) => {
              store.dispatch({ type: 'composer/draft', text: request.prompt });
              store.dispatch({ type: 'composer/focus' });
            }}
            onAskInPlace={(payload) => void sendBoardAsk(store, payload)}
            onPin={({ id, ghostAt, at }) => {
              store.dispatch({ type: 'board/pin', id, ghostAt, at });
            }}
          />
        )}
      </div>
    </div>
  );
}
