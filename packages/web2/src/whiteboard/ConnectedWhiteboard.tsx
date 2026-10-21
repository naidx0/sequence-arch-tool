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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { BoardTabs } from '../canvas/boards/BoardTabs';
import { boardsApi, ensureFirstSpace, setActiveWhiteboard, useActiveWhiteboard, useBoardDoc, useBoardsIndex } from '../canvas/boards/boardsClient';
import { ARCH_BOARD_ID, diffOps, nextBoardName } from '../canvas/boards/boardsModel';
import { requestHostCommand } from '../app/hostCommands';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { sendBoardAsk } from '../askInPlace/sendBoardAsk';
import { agentRuns } from '../agents/agentRuns';
import { modelConfigured } from '../onboarding/setupFallback';
import { Whiteboard } from './Whiteboard';
import { readScenes, writeScenes } from './sceneStore';
import { useCloseWhenEmpty } from './useCloseWhenEmpty';
import { readWhiteboard, whiteboardKey, writeWhiteboard, type WbItem, type WhiteboardDoc } from './whiteboardModel';

const LIVE_GRACE_MS = 1500;
const liveNow = (inFlight: boolean, until: number): boolean => inFlight || Date.now() < until;

export function ConnectedWhiteboard() {
  const state = useAppState();
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
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

  const chat = state.session.activeId;
  /* SPACES ARE PER CHAT: the list, the first Space and the close-when-empty all belong to this project AND this chat. */
  const scope = `${project}\u0000${chat ?? ''}`;
  const { index, refresh, failed, adopt } = useBoardsIndex(true, project);
  const chosen = useActiveWhiteboard(project);
  const whiteboards = (index?.boards ?? []).filter((b) => b.kind === 'whiteboard');
  /* The board you were last on, else the first whiteboard. */
  const current = index === null ? null : (whiteboards.find((b) => b.id === chosen) ?? whiteboards[0] ?? null);
  /* THE LAST SPACE IS GONE, WHOEVER DELETED IT: there is nothing left on this surface to look at, so it closes (no
     "No spaces" note, no error). Only a list that HAD a Space and now has none: a project opened with none keeps its note. */
  useCloseWhenEmpty(scope, index, whiteboards.length, () => requestHostCommand('whiteboard.close'));
  /* OPENING SPACES WITH NONE MAKES ONE, and shows it ready to draw (no empty screen). Only an index fetched for a project
     that has never shown a Space on this surface: a list that HAD one and emptied is the close above, not a reason to make
     another. The request is shared (ensureFirstSpace), so a double open or a StrictMode double effect is one create. */
  const hadSpace = useRef<string | null>(null);
  const [makeFailed, setMakeFailed] = useState(false);
  useEffect(() => {
    if (index === null || failed) return;
    if (whiteboards.length > 0) {
      hadSpace.current = scope;
      return;
    }
    if (hadSpace.current === scope) return;
    hadSpace.current = scope;
    void ensureFirstSpace(scope, () => boardsApi.create(nextBoardName(index))).then((meta) => {
      if (meta) {
        setActiveWhiteboard(project, meta.id);
        /* Drawn now: the list read below confirms it, it is not waited for. */
        adopt(meta);
      } else setMakeFailed(true);
      refresh();
    });
  }, [index, failed, whiteboards.length, project, scope, refresh, adopt]);
  const board = useBoardDoc(current?.id ?? null, current !== null, project);
  const doc = board.doc && board.doc.id === current?.id ? board.doc : null;

  /* What the store holds, as last seen: the baseline a change is diffed against. */
  const known = useRef<{ project: string; id: string; rev: number; items: readonly WbItem[] } | null>(null);
  if (known.current && (known.current.project !== project || known.current.id !== current?.id)) known.current = null;
  /* Set in render, not in an effect: the surface adopts the new copy in ITS
     effect, which runs first, and reports it back through onDocChange — that
     report must already diff against the new copy (to nothing), or the
     store's own change would be written back to it. */
  if (doc && (known.current?.id !== doc.id || known.current.rev !== doc.rev)) {
    known.current = { project, id: doc.id, rev: doc.rev, items: doc.items };
  }
  /* SCENES live on this machine until the store takes the kind (sceneStore.ts): the board's own items, then its scenes. */
  const lastScenes = useRef<Record<string, string>>({});
  const [sceneVersion, setSceneVersion] = useState(0);
  const external = useMemo<WhiteboardDoc | null>(() => {
    if (!doc) return null;
    const have = new Set(doc.items.map((i) => i.id));
    const local = readScenes(doc.id, project).filter((s) => !have.has(s.id));
    return { version: 1, items: [...doc.items, ...local] };
  }, [doc, project, sceneVersion]);
  const legacyScenes = doc ? readScenes(doc.id).filter((s) => !external?.items.some((i) => i.id === s.id)) : [];

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
    [project, current?.id],
  );

  const write = board.write;
  const onDocChange = useCallback(
    (next: WhiteboardDoc) => {
      const base = known.current;
      if (!base || base.project !== project || base.id !== current?.id) return;
      const scenes = JSON.stringify(next.items.filter((i) => i.kind === 'scene'));
      const sceneScope = `${project}\u0000${base.id}`;
      if (scenes !== lastScenes.current[sceneScope]) {
        lastScenes.current[sceneScope] = scenes;
        writeScenes(base.id, next.items, project);
      }
      const ops = diffOps(base.items, next.items);
      if (ops.length === 0) return;
      known.current = { ...base, items: next.items };
      void write(ops);
    },
    [project, current?.id, write],
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
        /* Absolutely placed between the pane's corners: its width is the pane's, so it folds on a measured fit. */
        measureFold
        caption="Spaces"
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
        onLinked={(meta) => {
          setActiveWhiteboard(project, meta.id);
          refresh();
        }}
        onRename={(id, name) => void boardsApi.rename(id, name).then(refresh, refresh)}
        onDelete={(id) => void boardsApi.remove(id).then(refresh, refresh)}
      />
      {doc && legacyScenes.length > 0 ? (
        <p className="wb-boards-note" data-testid="wb-legacy-scenes">
          Local scenes from an earlier version have no project attached.{' '}
          <button type="button" className="s2-btn s2-btn-sm" onClick={() => {
            writeScenes(doc.id, [...(external?.items ?? []), ...legacyScenes], project);
            setSceneVersion((n) => n + 1);
          }}>Import into this board</button>
        </p>
      ) : null}
      {board.error && current !== null ? (
        <p className="wb-boards-note" role="status" data-testid="wb-boards-error">
          This board could not be saved: {board.error}
        </p>
      ) : null}
      <div className="wb-boards-body">
        {index !== null && current === null ? (
          /* The first Space is being made (above); nothing to read in the meantime. */
          <p className="wb-boards-note" data-testid="wb-boards-making" aria-busy={!makeFailed}>
            {makeFailed ? 'A board could not be made. Press + to try again.' : null}
          </p>
        ) : (
          <Whiteboard
            /* NO STORE (no server answered): the session's own pad in
               localStorage, exactly as before boards had a store. */
             key={failed ? 'local' : `board:${project}:${current?.id ?? ''}`}
            repoRoot={repoRoot}
            {...(failed
              ? { storageKey: whiteboardKey(state.session.activeId) }
              : { storage, storageKey: `board:${current?.id ?? ''}`, externalDoc: external, onDocChange })}
            graph={graph}
            agentItems={state.session.boardAgentItems}
            live={liveNow(state.session.inFlight !== null, liveUntil.current)}
            intentGhosts={state.session.boardIntentGhosts}
            canAnswer={modelConfigured(state.composer.model) || Boolean(runsState.agents?.[state.session.activeId ?? ''])}
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
