import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCanvas } from '../canvas';
import { IndexRail, buildFunctionIndex, type RailStatus } from '../rail';
import { createReviewClient, type ReviewClient } from '../review';
import type { Coverage, FlowPlayback, FunctionIndex, NodeId } from '../state/types';
import { useAppState, useStore } from '../state';
import { deriveScanLiveStatus } from './scanProgressModel';
import { rescanRepo } from './rescanClient';

/* ══════════════════════════════════════════════════════════════════════════
   THE INDEX RAIL, WIRED — the Wave 4 handback, taken.
   packages/web2/src/app/ConnectedIndexRail.tsx

   ── WHY THIS FILE IS HERE AND NOT IN `state/connect.tsx` ─────────────────

   The rail lane's handback asks for its prop builder "beside `chatColumnPropsFrom`
   in connect.tsx, because that file is where the store meets React, and nowhere
   else". That is the right long-term home and this is not it, for one reason
   that outranks tidiness: `state/` belongs to the state lane, and this lane owns
   `app/` and `shell/`. Twelve agents editing twelve files with no coordination
   cost this project a full repair cycle (CANON §6), and the rule that came out
   of it is one agent per file.

   So the shape is the one `connect.tsx` uses — a component that reads the store
   and hands a surface plain props — and the MOVE is mechanical: cut the body
   into `indexRailPropsFrom(state, store)` there, and this file becomes the same
   three lines `ConnectedChatColumn` is. Nothing about the rail changes.

   ── WHAT IS REAL HERE, AND WHAT IS NOT, ITEM BY ITEM ─────────────────────

   REAL, off the store, no fallback and no invention:
     graph       the `/archgraph.json` payload whole, off the phase's own
                 payload. `stale` still draws: a stale graph is still a graph,
                 and the staleness is said in the status strip rather than by
                 blanking the column.
     coverage    the LAST assistant turn's, found by walking backwards. Item
                 4.4 is the strongest single claim this product makes and it is
                 a claim about ONE answer — showing the newest coverage that
                 happens to be non-null would attach turn 3's reading to turn 7.
     repoName /
     lastReadAt  `ScannedRepo.repoName` and `scannedAt`, parsed once.
     status      the phase, mapped. Three rail states, three phases.

     functions   FETCHED HERE — see the effect below, and read the paragraph
                 after this one before moving it.
     onRetry     WIRED to POST /api/scan via `rescanClient`. The stale strip
                 draws Retry when `status === 'stale'`; omitting the handler
                 used to hide the button because a no-op click is worse than
                 silence. The route is the same force-scan attach already uses.

   ── WHY THE FUNCTION INDEX IS FETCHED HERE, WHICH BOTH LANES DECLINED ────

   The rail lane left `functions` at `null` and called the fetch the store
   lane's call. That was right for a lane that owns one directory. It is not
   right for the product, and the screenshot is what proved it rather than any
   test: mounted against a store whose `functions` is null, THE RAIL PRINTS `0`
   BESIDE EVERY FILE AND EVERY CARD. Five hundred rows each asserting that the
   scan found zero functions in that file — and the scan found thousands. That is
   Graphite law 4 ("never invent a number") broken on every row of the pane
   this lane just mounted, and mounting it is what made the state reachable, so
   it is this lane's to answer.

   THE PRECEDENT IS INSIDE THIS PACKAGE AND IT IS THIS SAME ROUTE.
   `review/ConnectedReview.tsx` fetches `/api/functions` in exactly this shape,
   for exactly this reason, and states it: "Waiting for the rail to be opened
   first would make that claim appear and disappear depending on which pane the
   user happened to visit. The route is read-only and cached server-side."

   IT IS SEEDED FROM THE STORE AND NEVER WRITTEN BACK. `repo.functions` belongs
   to the repo slice; a second writer of that field is how two panes come to
   disagree about what was scanned. So the store wins whenever it has an answer
   (`repo.functions ?? fetched`), and the day it learns the route this effect
   deletes itself with nothing else moving.

   AND IT DOES NOT CLOSE THE UNDERLYING DEFECT, which is escalated rather than
   papered over: while the request is in flight, and forever on an origin with
   no engine behind it, `functions` is null and the rail still prints those
   zeros — and expanding a file still says "The scan read this file and could
   not name a function in it", which is a statement about the scan that nobody
   scanned. `IndexRail.tsx` has a branch for the true case, "The function index
   has not been read yet", and it is UNREACHABLE: its guard reads
   `row.functionCount > 0 && functions === null`, while `functionCount` is
   derived from `functions` and is therefore always 0 when it is null. That is
   one file this lane does not own and one condition to correct.

   ── THE PLAYBACK CURSOR NO LONGER LIVES HERE — item playback ─────────────

   WHAT THIS PARAGRAPH USED TO SAY, and it was true when it was written: the
   cursor was a `useState` in this file, the board held its canvas slice in a
   private `useReducer`, "the rail and the board are two React trees with no
   state between them", and this file "does not pretend otherwise" — while the
   flow panel's own heading did, until it was retreated to "Traced path".

   IT IS NOW `canvas.view`, WHICH IS WHERE THE FROZEN CONTRACT PUT IT.
   `state/types.ts` has modelled S3 as `{state:'S3'; playback: FlowPlayback}`
   since item 2.1. `canvas/canvasChannel.tsx` holds that ONE slice above both
   surfaces and its header argues why it is there rather than in
   `state/store.ts` — the fold into the store is unchanged in shape and is still
   one case block.

   SO THE THREE CALLBACKS BELOW ARE DISPATCHES, and the prediction the old
   paragraph made is the diff that was applied: "delete the `useState` here,
   read `state.canvas.view.state === 'S3' ? …playback : null`, and dispatch
   `canvas/*` in the three callbacks. The shape does not change."
   ══════════════════════════════════════════════════════════════════════════ */

/** The stable client, so the effect below does not re-run every render. The
 *  prop exists so a test can hand in a recorder or a refusal; nothing in the
 *  application passes it. */
const DEFAULT_CLIENT = createReviewClient();

export interface ConnectedIndexRailProps {
  client?: ReviewClient;
}

export function ConnectedIndexRail({ client = DEFAULT_CLIENT }: ConnectedIndexRailProps = {}) {
  const store = useStore();
  const state = useAppState();
  const { canvas, dispatch } = useCanvas();

  /* THE GRAPH IS READ OFF THE PHASE'S OWN PAYLOAD, never off an optional field
     a failed scan could leave stale behind an `unattached` phase. During a
     rescan the phase is `scanning` but `previous` still carries the graph on
     screen — same rule the store documents for the canvas. */
  const repo =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo
      : state.repo.phase === 'scanning' && state.repo.previous
        ? state.repo.previous
        : null;

  const status: RailStatus =
    state.repo.phase === 'scanning' ? 'reading' : state.repo.phase === 'stale' ? 'stale' : 'idle';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.repo.phase !== 'scanning') return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.repo.phase, state.repo.phase === 'scanning' ? state.repo.startedAt : null]);

  const readingStatus = useMemo(() => {
    if (state.repo.phase !== 'scanning') return null;
    return deriveScanLiveStatus({
      startedAt: state.repo.startedAt,
      progress: state.repo.progress,
      now,
      repoName: state.repo.repoName,
      rescan: state.repo.previous !== null,
    });
  }, [state.repo, now]);

  /* THE LAST ANSWER'S COVERAGE — the last one, not the last non-null one.
     A backwards walk that stops at the first assistant turn answers "what
     could the answer I am looking at see"; one that skips past a turn with no
     coverage answers a question about a different turn. */
  const coverage = useMemo<Coverage | null>(() => {
    for (let i = state.session.turns.length - 1; i >= 0; i -= 1) {
      const turn = state.session.turns[i];
      if (turn.role !== 'assistant') continue;
      return turn.coverage;
    }
    return null;
  }, [state.session.turns]);

  /* ── the function index ────────────────────────────────────────────────
   *
   * THE STORE FIRST, THE WIRE ONLY IF THE STORE HAS NOTHING. The `??` is the
   * whole of the precedence rule, and it is what makes this effect delete
   * itself the day `store.ts` learns the route rather than become a second
   * opinion beside it.
   *
   * A REFUSAL IS SILENCE, ON PURPOSE, AND IT IS NOT A SWALLOWED ERROR. An
   * origin that serves a static graph and no engine answers this route with a
   * 404, and that is a true fact about the origin rather than a failure the
   * reader can act on. The rail already has a vocabulary for "there is no
   * function index" — it draws its file rung and no function rung — and a
   * second error line here would say the same absence twice.
   * ────────────────────────────────────────────────────────────────────────*/
  const [fetched, setFetched] = useState<FunctionIndex | null>(null);
  const functions = repo?.functions ?? fetched;

  useEffect(() => {
    if (repo === null || functions !== null) return undefined;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const answer = await client.functions(controller.signal);
      if (!live) return;
      if (answer.outcome !== 'ok') return;
      /* `warnings` is `[]` because `ReviewClient.functions` is typed
         `{ functionGraph }` and this lane will not cast a body to a shape its
         own type does not promise. The route does return warnings and nothing
         in the rail renders them today; they arrive with the shared client the
         plan's §5 skeleton puts in `src/api/`, which is also where this whole
         call belongs. */
      setFetched(buildFunctionIndex({ functionGraph: answer.body.functionGraph, warnings: [] }));
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [client, repo, functions]);

  /* THE ONE READ. S3 or nothing — there is no local copy to fall back to, so
     the strip the reader is looking at and the cards the board has lit are
     driven by the same object. */
  const playback: FlowPlayback | null =
    canvas.view.state === 'S3' ? canvas.view.playback : null;

  /* `onPlay` — a function row was clicked and the rail resolved a traced path.
     A new flow REPLACES whatever was playing; the reducer drops the previous
     lit set rather than inheriting it. */
  const startFlow = useCallback(
    (next: FlowPlayback) => dispatch({ type: 'canvas/flow', playback: next }),
    [dispatch],
  );

  /* `onPlaybackChange` — the strip's play/pause and its scrub.
     IT SENDS THE CURSOR, NOT THE WHOLE PLAYBACK, and that is the difference
     between a control and a second author of the flow: the strip may move the
     playhead and may start or stop the clock, and it may not rewrite the hop
     list. `canvas/flow-cursor` clamps, and is a no-op outside S3 so a scrub
     that lands after the flow was cleared cannot resurrect it. */
  const moveCursor = useCallback(
    (next: FlowPlayback) =>
      dispatch({ type: 'canvas/flow-cursor', cursor: next.cursor, playing: next.playing }),
    [dispatch],
  );

  const clearFlow = useCallback(() => dispatch({ type: 'canvas/flow-clear' }), [dispatch]);

  /**
   * A NODE THE USER POINTED AT BECOMES THE COMPOSER'S CONTEXT — the same
   * gesture, the same chip, whichever surface it was pointed at from.
   *
   * `Board.tsx` already binds a node click to `composer/chip-add`: "Selecting a
   * grounded node and grounding the composer on it are the same gesture, so
   * there is exactly one chip per click and no second control to find." A card
   * row in the rail and a card on the board are the SAME `ArchNode`, so binding
   * them to two different outcomes would be the product holding two opinions
   * about what pointing at a node means. The store dedupes chips by id, so
   * reading down the rail does not stack a list.
   *
   * ── AND IT MOVES THE BOARD, WHICH IT PREVIOUSLY COULD NOT ──────────────
   * The escalation that used to close this comment — "It does not move the
   * canvas… there is no reducer to send it to" — was answered by item playback:
   * one `CanvasSlice` above both surfaces, so the same click that grounds the
   * composer also selects the card on the board, through the SAME
   * `canvas/select` a click on the board itself dispatches. One selection rule,
   * not a second one for the rail.
   *
   * A NODE THE BOARD IS NOT DRAWING IS NOT SELECTED, and no substitute is put
   * in its place. The guard above already refuses ids the SCAN never produced;
   * this one is narrower and is the board's: `canvas.selection` naming a node
   * with no card would be a selection nobody can see, which reads as a click
   * that did nothing. The detail panel still opens, which is the answer that
   * does not depend on the board.
   *
   * `onOpenScope` is still this same handler and still not a scope push: there
   * is no scope route wired into this shell, and `GraphScope.trail` with a crumb
   * nothing can pop would be a breadcrumb to nowhere.
   */
  const groundNode = useCallback(
    (nodeId: NodeId) => {
      const node = repo?.graph.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      store.dispatch({
        type: 'composer/chip-add',
        chip: {
          id: `node:${node.id}`,
          kind: 'node',
          ref: node.id,
          label: node.label ?? node.id,
          nodeKind: null,
        },
      });
      const drawn = repo?.doc.nodes.some((n) => n.id === node.id) ?? false;
      if (drawn) dispatch({ type: 'canvas/select', nodeId: node.id, additive: false });
    },
    [dispatch, repo, store],
  );

  return (
    <IndexRail
      /* THE OTHER DIRECTION, and the half that never arrived. `rail/reveal`
         writes `rail.selectedPath` and NO COMPONENT READ IT, so clicking a
         card on the board moved nothing over here - the two panes that are
         meant to drive each other only ever talked one way. */
      revealPath={state.rail.selectedPath}
      /* And the node the board asked about. `rail.detail` was declared for
         this and written by nobody. */
      explainNodeId={state.rail.selectedNodeId}
      /* THE ANNOTATE ANSWER, from the one canvas slice — the same record the
         board's cards read, so the panel and the card never disagree about
         what the endpoint said. */
      annotations={canvas.annotations}
      graph={repo?.graph ?? null}
      functions={functions}
      coverage={coverage}
      playback={playback}
      status={status}
      repoName={
        state.repo.phase === 'scanning'
          ? state.repo.repoName
          : repo?.repoName ?? null
      }
      readingStatus={readingStatus}
      lastReadAt={repo ? Date.parse(repo.scannedAt) : null}
      onRetry={
        repo === null
          ? undefined
          : () => {
              const held = repo;
              const startedAt = Date.now();
              store.dispatch({
                type: 'repo/scanning',
                root: held.root,
                repoName: held.repoName,
                at: startedAt,
              });
              void rescanRepo(fetch, undefined, (progress) => {
                store.dispatch({ type: 'repo/scan-progress', progress });
              }).then((answer) => {
                if (answer.outcome === 'ok') {
                  store.dispatch({ type: 'repo/loaded', draft: answer.draft, at: Date.now() });
                  return;
                }
                store.dispatch({
                  type: 'net/failed',
                  failure: {
                    status: answer.status,
                    message: answer.message,
                    route: 'POST /api/scan',
                    at: Date.now(),
                  },
                });
                /* Put the previous graph back — `repo/failed` would blank the
                   board; a refused rescan must not erase the one on screen. */
                store.dispatch({
                  type: 'repo/loaded',
                  draft: {
                    root: held.root,
                    repoName: held.repoName,
                    graph: held.graph,
                    summary: held.summary,
                    scannedAt: held.scannedAt,
                  },
                  at: Date.now(),
                });
                store.dispatch({
                  type: 'repo/stale',
                  at: Date.now(),
                  reason: 'external',
                  changedPaths: [],
                });
              });
            }
      }
      onPlay={startFlow}
      onPlaybackChange={moveCursor}
      onClearFlow={clearFlow}
      onFocusNode={groundNode}
      onOpenScope={groundNode}
    />
  );
}
