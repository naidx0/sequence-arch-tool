/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT PANE'S AGENT LAYER
   packages/web2/src/chat/AgentChatLayer.tsx

   Mounted once inside the chat transcript. It is the seam between the page's
   agent run store (agents/agentRuns.ts) and the app store:

     · it registers the chat as the runs' host, so a run started anywhere
       (the board's node menu) belongs to the open thread and pins its node
       as a composer context chip;
     · it draws the open thread's runs as cards, and their approvals as
       bottom-right toasts;
     · on an empty thread it offers three starters tied to the open board.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { agentRuns, followLiveTurns, type AgentRunStore } from '../agents/agentRuns';
import { editUndo } from '../agents/editUndo';
import { CHAT_TITLE_EVENT, loadOlderRuns, loadSavedRunsChecked } from '../agents/savedRuns';
import { useCanvas } from '../canvas/canvasChannel';
import { composerPropsFrom } from '../state';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { AppState } from '../state/types';
import { ChatStarters, starterActions, type StarterAction, type StarterEdge, type StarterNode } from './ChatStarters';
/* Static on purpose: it looks for a waiting note on mount, so it is on the first page anyway, and a chunk of its own cost two more boot requests (script and style) and a module. */
import { RefineNoteCard } from './RefineNoteCard';

/* The cards and toasts load with the first run, not at boot. */
const AgentRunsPane = lazy(() => import('./AgentRunsPane'));

/**
 * The board's selection, or none when no board channel is mounted (a chat
 * rendered on its own). `useCanvas` reads one context and then throws when it
 * is absent, so catching it keeps the hook order the same on every render.
 */
function useBoardSelection(): readonly string[] {
  try {
    return useCanvas().canvas.selection.nodeIds;
  } catch {
    return NO_SELECTION;
  }
}
const NO_SELECTION: readonly string[] = [];

function graphOf(state: AppState): { nodes: StarterNode[]; edges: StarterEdge[] } {
  if (state.repo.phase !== 'attached' && state.repo.phase !== 'stale') return { nodes: [], edges: [] };
  const g = state.repo.repo.graph;
  return { nodes: (g.nodes ?? []) as StarterNode[], edges: (g.edges ?? []) as StarterEdge[] };
}

/** Chats whose saved agent turns this page has asked for. */
const askedSaved = new Set<string>();
/** The page has asked once which chat turns the server is still running (after a reload), to follow them. */
let askedLive = false;

/** `cards` false: the virtualized transcript draws the run cards (S6); this layer keeps the host, starters and toasts. */
export function AgentChatLayer({ empty, runs = agentRuns, cards = true }: { empty: boolean; runs?: AgentRunStore; cards?: boolean }) {
  const store = useStore();
  const state = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const repoRoot = groundedRepoRoot(state);

  useEffect(() => {
    runs.setHost({
      sessionId: () => stateRef.current.session.activeId,
      pinNode: (nodeId) => {
        const node = graphOf(stateRef.current).nodes.find((n) => n.id === nodeId) ?? null;
        store.dispatch({
          type: 'composer/chip-add',
          chip: {
            id: `node:${nodeId}`,
            kind: 'node',
            ref: nodeId,
            label: node?.label ?? nodeId,
            nodeKind: (node?.kind as never) ?? null,
          },
        });
        return node?.label ?? null;
      },
    });
    return () => runs.setHost(null);
  }, [runs, store]);

  /* Reloaded, or another workspace opened: every chat turn still running on the server streams here again. */
  useEffect(() => {
    if (askedLive) return;
    askedLive = true;
    void followLiveTurns(runs);
  }, [runs]);

  const all = useSyncExternalStore(runs.subscribe, runs.get, runs.get);
  const sessionId = state.session.activeId;
  /* An edit that emptied the chat still shows its Undo. */
  const undoable = useSyncExternalStore(editUndo.subscribe, () => editUndo.get() !== null, () => false);

  /* Round 9: a chat's agent turns come back from disk after a relaunch, once per chat per page. */
  /* The saved-file notice and the archive pager live in the run store, per chat: this layer is mounted at
     another place in the tree when the transcript goes virtual or the chat changes, and loses its own state. */
  const savedText = sessionId ? all.notes?.[sessionId] : undefined;
  const olderNow = sessionId ? all.older?.[sessionId] : undefined;
  useEffect(() => {
    if (!sessionId || askedSaved.has(sessionId)) return;
    askedSaved.add(sessionId);
    /* Saved history merges ahead of anything already live; a failed fetch is asked again next time. */
    void loadSavedRunsChecked(sessionId).then((saved) => {
      if (saved === null) askedSaved.delete(sessionId);
      else {
        runs.hydrate(sessionId, saved.runs);
        runs.patch((st) => ({
          ...st,
          ...(saved.notice ? { notes: { ...st.notes, [sessionId]: saved.notice } } : {}),
          ...(saved.archived > 0 ? { older: { ...st.older, [sessionId]: { remaining: saved.archived, loaded: 0 } } } : {}),
        }));
      }
    });
  }, [runs, sessionId]);

  const showOlder = (): void => {
    if (!sessionId || !olderNow) return;
    void loadOlderRuns(sessionId, olderNow.loaded).then((page) => {
      if (!page) return;
      runs.hydrate(sessionId, page.runs);
      runs.patch((st) => ({ ...st, older: { ...st.older, [sessionId]: { remaining: page.remaining, loaded: olderNow.loaded + page.runs.length } } }));
    });
  };

  /* Reloaded mid-turn: the server's turn is still running. Its card is live; follow it until it ends. */
  const followed = useMemo(() => all.runs.filter((r) => r.sessionId === sessionId && r.restored && r.status === 'running').map((r) => r.id), [all.runs, sessionId]);
  useEffect(() => {
    if (!sessionId || followed.length === 0) return;
    const timer = setInterval(() => {
      void loadSavedRunsChecked(sessionId).then((saved) => {
        if (!saved) return;
        const done = new Map(saved.runs.filter((r) => r.status !== 'running').map((r) => [r.id, r]));
        if (!followed.some((id) => done.has(id))) return;
        runs.patch((s) => ({ ...s, runs: s.runs.map((r) => (done.has(r.id) && followed.includes(r.id) ? { ...done.get(r.id)!, restored: true } : r)) }));
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [runs, sessionId, followed.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Round 9: the server named a chat from its first agent exchange; the rail and the header show it. */
  useEffect(() => {
    const onTitle = (ev: Event): void => {
      const d = (ev as CustomEvent<{ sessionId?: string; title?: string }>).detail;
      if (!d?.sessionId || !d.title) return;
      const s = stateRef.current.session;
      const entry = s.sessions.find((x) => x.id === d.sessionId);
      if (!entry || entry.titleEdited || entry.title === d.title) return;
      store.dispatch({ type: 'session/index', sessions: s.sessions.map((x) => (x.id === d.sessionId ? { ...x, title: d.title! } : x)), activeId: s.activeId });
    };
    window.addEventListener(CHAT_TITLE_EVENT, onTitle);
    return () => window.removeEventListener(CHAT_TITLE_EVENT, onTitle);
  }, [store]);
  const mine = useMemo(() => all.runs.filter((r) => r.sessionId === sessionId), [all.runs, sessionId]);
  /* The note card belongs to every chat, whichever model answered: a turn of either kind ends it. */
  const lastRun = mine[mine.length - 1];
  const turnBusy = state.session.inFlight !== null || (lastRun !== undefined && (lastRun.status === 'running' || lastRun.queued === true));
  const lastEndedKey = lastRun || state.session.turns.length > 0 ? `${lastRun ? `${lastRun.id}:${lastRun.status}` : ''}|${state.session.turns.length}` : null;
  const selection = useBoardSelection();
  const graph = graphOf(state);
  const actions = useMemo(() => starterActions(graph.nodes, graph.edges, selection), [graph.nodes, graph.edges, selection]);

  const pick = (a: StarterAction): void => {
    const composer = composerPropsFrom(store.getState(), store);
    if (!a.send) {
      composer.onTeachToggle?.(false);
      composer.onPermissionChange('plan');
      composer.onDraftChange(a.prompt);
      const field = document.querySelector<HTMLTextAreaElement>('.v3-composer textarea');
      if (field) {
        field.focus();
        field.setSelectionRange(a.prompt.length, a.prompt.length);
      }
      return;
    }
    composer.onDraftChange(a.prompt);
    /* The draft is in the store now; the send reads it from a fresh snapshot. */
    composerPropsFrom(store.getState(), store).onSend();
  };

  return (
    <>
      {savedText ? (
        <p className="s2-empty" role="alert" data-testid="chat-saved-note">
          {savedText}
        </p>
      ) : null}
      {olderNow && olderNow.remaining > 0 ? (
        <p className="s2-empty" role="status" data-testid="chat-older-note">
          {olderNow.remaining} older {olderNow.remaining === 1 ? 'turn is' : 'turns are'} saved on disk but not shown here.{' '}
          <button type="button" className="s2-btn s2-btn-sm" data-testid="chat-show-older" onClick={showOlder}>
            Show older turns
          </button>
        </p>
      ) : null}
      {empty && mine.length === 0 ? <ChatStarters actions={actions} onPick={pick} /> : null}
      {/* Toasts cover every thread's runs, so the pane mounts once any run exists. */}
      {all.runs.length > 0 || undoable ? (
        <Suspense fallback={null}>
          <AgentRunsPane runs={mine} store={runs} repoRoot={repoRoot} cards={cards} sessionId={sessionId} />
        </Suspense>
      ) : null}
      <RefineNoteCard sessionId={sessionId} lastEndedKey={lastEndedKey} busy={turnBusy} />
    </>
  );
}
