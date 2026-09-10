import { createContext, type ReactNode, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

import { fromCanvasMemory, toCanvasMemory, worthPersistingCanvas } from '../sessions/canvasMemory';
import { fromChatMemory, toChatMemory, worthPersisting } from '../sessions/chatMemory';
import { rememberCanvasForFlush, rememberChatForFlush } from '../sessions/sessionPersist';

import { ChatColumn, type ChatColumnProps, type ComposerProps, type ToolbeltId } from '../chat';
import { ASK_STREAM_ROUTE, createAskTransport, type AskTransport } from '../chat/askClient';
import { toolbeltAskText } from '../chat/composerModel';
import {
  chipFromMention,
  detectMention,
  mentionSources,
  rankMentions,
} from '../chat/mentionModel';
import { BootSurface, type BootOutcome, type BootSurfaceProps, type BootTransport } from '../boot';
import { useBoot } from '../boot/useBoot';
import { requestHostCommand } from '../app/hostCommands';
import { setActivityLaunch } from '../activity/activityLaunch';
import { Shell, type ShellProps } from '../shell';
import type { Store } from './store';
import type { AppState, ComposerAttachment, PermissionMode, ProposalId, Turn, TurnId } from './types';
import type { AskContextBreakdown } from '@sequence/api-types';
import { askHistoryMeta } from '../chat/askHistory';
import { modelFromConfig, modelLabel } from '../chat/modelSelection';
import { publishedContextWindow } from '../chat/publishedContextWindow';
import { sessionHomeContextFrom } from '../chat/sessionHomeModel';
import { migrateLegacyWorkspaceScratch, scratchStorage } from '../canvas/localScratch';
import { checkpointSessionId } from '../review/writeSession';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.2 — WHERE THE STORE MEETS REACT, AND NOWHERE ELSE.
   packages/web2/src/state/connect.tsx

   `store.ts` has no React in it and this file has no rules in it. That split is
   the adoption study's single most transferable finding
   (`docs/research/ml-harness-adoption.md` §1.10, from
   `MLH/frontend/src/lib/engine/client.ts:3-7`): the frontend "never contains a
   business rule", so every component is a renderer and a renderer's inputs are
   props.

   THE PROP BUILDERS ARE PURE FUNCTIONS OF (state, dispatch). That is what makes
   the three surfaces testable with props alone AND drivable from the store
   without either of them knowing about the other — the shell, chat and boot
   lanes each wrote a props interface, and this file is the only place that
   knows how to fill one from the state contract. None of those three files
   changes to be connected.

   NO SELECTOR HOOK, DELIBERATELY. `useSyncExternalStore` compares snapshots
   with `Object.is`, so a `useSelect(s => ({...}))` that builds a fresh object
   per call re-renders forever. The whole state is one stable object; a surface
   takes it and the prop builder does the narrowing. When a pane is measurably
   too expensive to re-render, the fix is `memo` on that pane, not a selector
   layer that can loop.
   ══════════════════════════════════════════════════════════════════════════ */

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  /*
   * A THROW, NOT A FALLBACK STORE. A default store created here would let a
   * component mount outside the provider, render an empty product, and take
   * every dispatch into a void nothing is subscribed to. That failure looks
   * exactly like "the feature is not built yet", which is the one thing this
   * wave cannot afford to be ambiguous about.
   */
  if (store === null) throw new Error('useStore was called outside a <StoreProvider>');
  return store;
}

export function useAppState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/* ========================================================================== *
 * THE PROP BUILDERS
 * ========================================================================== */

/**
 * The composer's props.
 *
 * `composer.send` is passed through UNTOUCHED. It is the store's derived value,
 * and re-deriving it here would be the second source of truth this whole
 * arrangement exists to prevent — the renderer would then be one place, the
 * store another, and `Composer.tsx:126` (Enter sends when `send === 'ready'`)
 * would be reading whichever one won the race.
 */
/**
 * The last question the user actually asked, or null.
 *
 * Retry re-asks THIS rather than the composer draft: the draft is cleared on
 * send and may since have been typed into, so retrying it would re-send
 * something the user never asked and did not know was queued.
 */
function lastAsked(state: AppState): string | null {
  for (let i = state.session.turns.length - 1; i >= 0; i--) {
    const turn = state.session.turns[i]!;
    if (turn.role === 'user' && turn.text.trim()) return turn.text;
  }
  return null;
}

/**
 * The `fix` the most recent failed turn named, or null.
 *
 * Read from the TURN rather than from `net.lastFailure`: the transport records
 * that something failed, and only the server's turn event knows whether the
 * failure has a route out.
 */
/**
 * Narrow the wire's `instructions` field, or null.
 *
 * NARROWED, NOT CAST. This is text written by whoever wrote the repository
 * being examined, arriving over a route whose whole purpose is to show it to a
 * person — the one field in this file where a malformed shape would put
 * `undefined` (or an object) into a `<pre>` the reader is being asked to
 * decide on. A missing file is the ordinary answer, so null is not an error.
 */
function readInstructionsDisclosure(
  raw: unknown,
): { file: string; text: string; truncated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { file?: unknown; text?: unknown; truncated?: unknown };
  if (typeof v.file !== 'string' || typeof v.text !== 'string') return null;
  return { file: v.file, text: v.text, truncated: v.truncated === true };
}

function lastTurnFix(state: AppState): 'provider' | null {
  for (let i = state.session.turns.length - 1; i >= 0; i--) {
    const turn = state.session.turns[i]!;
    const failure = (turn as { failure?: { kind: string; fix?: 'provider' | null } }).failure;
    if (!failure) continue;
    return failure.kind === 'error' ? (failure.fix ?? null) : null;
  }
  return null;
}

/**
 * The input tokens of the most recent metered turn, or null when none is.
 *
 * NOT A SUM over the thread. The digest is rebuilt per turn rather than
 * accumulated, so a running total would climb past the window on a long
 * conversation while every individual call still fitted — a ring filling up for
 * a reason that was not true.
 *
 * AND NOT A SUM OVER THE TURN'S OWN ROUNDS EITHER — the wire half of the same
 * bug. `turn.usage.inputTokens` is the BILL: the sum over up to eight provider
 * calls, each of which rebuilt the prompt. A six-round turn reported ~150k
 * against a 200k window when no single call used more than ~15% of it, and the
 * ring told the reader to wrap up a conversation that fitted comfortably.
 * `contextBreakdown.totalMeasured` is the provider-reported input of the LAST
 * call of that turn — the one number that is actually a window measurement —
 * so it wins whenever present. The usage sum stays as the fallback for turns
 * metered before the breakdown existed: possibly high, never invented.
 *
 * Narrowed on `role` rather than on the presence of `usage`, because only an
 * assistant turn carries one and TypeScript is right to say so.
 */
function lastMeteredInput(turns: readonly Turn[]): number | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role !== 'assistant') continue;
    if (typeof turn.contextBreakdown?.totalMeasured === 'number') {
      return turn.contextBreakdown.totalMeasured;
    }
    if (turn.usage) return turn.usage.inputTokens;
  }
  return null;
}

/** Last assistant turn's prompt-section breakdown (B3.4), or null. */
function lastContextBreakdown(turns: readonly Turn[]): AskContextBreakdown | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.role === 'assistant' && turn.contextBreakdown) return turn.contextBreakdown;
  }
  return null;
}

/**
 * WHICH REPOSITORY THIS FRAME IS ABOUT — one answer, one place.
 *
 * The composer's "grounded on X" and the shell's repo name are the same claim,
 * and they used to be the same EXPRESSION written twice, under a comment saying
 * "the same selector ... deliberately so: two different answers to 'which
 * repository is this' in one frame would be a bug nobody could see."
 *
 * That was right about the risk and wrong about the mechanism: a copy is not a
 * selector. Either half could be edited alone and the frame would disagree with
 * itself exactly as the comment feared, silently, because both would still look
 * correct in isolation.
 *
 * A STALE GRAPH STILL NAMES ITS REPO. It is the graph on screen, so the frame
 * must keep saying whose it is; "stale" is a statement about freshness, not
 * about identity.
 */
export function groundedRepoName(state: AppState): string | null {
  return state.repo.phase === 'attached' || state.repo.phase === 'stale'
    ? state.repo.repo.repoName
    : null;
}

export function composerPropsFrom(
  state: AppState,
  store: Store,
  transport: AskTransport = createAskTransport(fetch),
): ComposerProps {
  const { dispatch } = store;
  return {
    composer: state.composer,
    /* Read straight off the slice rather than held beside it: one place holds
       what is attached, and it is the same place the send payload reads. */
    attachments: state.composer.attachments,
    /* The placeholder re-teaches its lesson only once: a thread with a turn in
       it says "Ask for a follow-up change" instead. */
    live: state.session.turns.length > 0,
    grounding: groundedRepoName(state),
    sessionStrip:
      state.session.turns.length === 0
        ? sessionHomeContextFrom({
            repo: groundedRepoName(state),
            branch: state.session.git.branch,
            modelLabel: modelLabel(state.composer.model),
          })
        : null,
    /*
     * THE LAST METERED TURN, not a sum over the thread. The digest is rebuilt
     * per turn rather than accumulated, so a running total would climb past the
     * window on a long conversation while every individual call still fitted -
     * a ring that filled up for a reason that was not true.
     */
    contextUsed: lastMeteredInput(state.session.turns),
    contextWindow: state.composer.contextWindow,
    contextBreakdown: lastContextBreakdown(state.session.turns),
    /*
     * THE FAILURE STRIP IS NOW RECOVERABLE, AND DISMISSABLE.
     *
     * `retryable` was hardcoded false with a comment citing item 2.9 — "there
     * is no ask transport to retry with". That item has since shipped as
     * `chat/askClient.ts`, and this function already receives the transport as
     * an argument, so the reason no longer holds.
     *
     * The comment's own warning still binds and is honoured: a Retry that did
     * nothing would be worse than no Retry. So this is retryable ONLY when
     * there is a real question to re-ask — the last user turn — and false
     * otherwise. A failure with nothing behind it still shows no button.
     *
     * Dismiss needed a `net/clear` action, which did not exist: `net/failed`
     * had shipped with nothing able to undo it, so the strip was permanent for
     * the rest of the session while its X called an `onDismiss` nobody passed.
     * That is exactly the defect §3.6 of the adoption study records in MLH —
     * `dismissError` existing and wired to nothing.
     */
    failure:
      state.net.lastFailure === null
        ? null
        : {
            message: state.net.lastFailure.message,
            retryable: lastAsked(state) !== null,
            /*
             * THE ROUTE OUT, when the turn that failed named one.
             *
             * Read off the LAST TURN's failure rather than off `net`, because
             * `net.lastFailure` is the transport's record and `fix` is the
             * server's judgement about the turn. A turn that ended "add your
             * own API key in Settings" is the only case that offers it.
             */
            fix: lastTurnFix(state),
          },
    /*
     * ── THE TRUST MOMENT ───────────────────────────────────────────────
     *
     * Rendered ONLY when the probe has answered (`root !== null`) AND the
     * answer was "not trusted". Both halves matter: the first is the third
     * state that keeps the strip from accusing every repo while a request is
     * in flight, and the second is what makes this a notice rather than
     * permanent chrome.
     */
    trust:
      state.trust.root === null || state.trust.trusted
        ? null
        : {
            repoName: groundedRepoName(state) ?? state.trust.root,
            instructions: state.trust.instructions,
            reviewing: state.trust.reviewing,
            onReview: (open: boolean) => dispatch({ type: 'trust/review', open }),
            /*
             * ONE ACTION, SCOPED TO THIS ROOT. The answer is re-read from the
             * server rather than assumed, because the decision is written to
             * the USER-level store and a write that failed (a read-only home)
             * must not leave the UI claiming a trust the gates will refuse.
             */
            onTrust: () => {
              void fetch('/api/repo-trust', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ trusted: true }),
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((body) => {
                  if (!body) return;
                  dispatch({
                    type: 'trust/loaded',
                    root: typeof body.root === 'string' ? body.root : state.trust.root!,
                    trusted: body.trusted === true,
                    instructions: state.trust.instructions,
                  });
                })
                .catch(() => {
                  /* The strip stays up, which is the honest outcome: nothing
                     changed, and claiming otherwise would hide a live gate. */
                });
            },
          },
    onDismissFailure: () => dispatch({ type: 'net/clear' }),
    /*
     * The strip's way out. Clears the strip AND opens the pane: leaving the
     * failure up behind the panel that fixes it would tell the reader the fix
     * had already failed.
     */
    onOpenSettings: () => {
      dispatch({ type: 'net/clear' });
      dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'provider' } });
    },
    /* C1.7 — Terminal pane shipped; host opens the workspace pill. */
    onOpenTerminal: () => requestHostCommand('terminal.open'),
    /* C2.5 — Browser pane shipped; host opens the workspace pill. */
    onOpenBrowser: () => requestHostCommand('browser.open'),
    queued: state.session.queued,
    onUnqueue: () => dispatch({ type: 'turn/unqueue' }),
    onRetry: () => {
      const again = lastAsked(state);
      if (!again) return;
      /* The strip goes as the new attempt starts. Leaving the old error above a
         running turn says the thing now in flight has already failed. */
      dispatch({ type: 'net/clear' });
      dispatch({ type: 'composer/draft', text: again });
      composerPropsFrom({ ...state, composer: { ...state.composer, draft: again } }, store, transport).onSend();
    },
    onDraftChange: (text: string) => dispatch({ type: 'composer/draft', text }),
    /*
     * THE `@` PICKER RESOLVES HERE, because this is the only place that holds
     * the graph. Sheet 12.4: "@ resolves against the graph, or it resolves
     * against nothing… where nothing matches it says so and offers no free-text
     * fallback, because a reference the engine cannot resolve is the exact
     * thing this product exists to prevent."
     *
     * A stale graph still answers: it is the graph on screen, and refusing to
     * resolve against it would leave the picker dead for the whole window
     * between an accepted edit and the next scan.
     */
    onMentionProbe: (draft: string, caret: number) => {
      const repo =
        state.repo.phase === 'attached' || state.repo.phase === 'stale'
          ? state.repo.repo
          : null;
      const token = caret < 0 ? null : detectMention(draft, caret);
      if (token === null || repo === null) {
        dispatch({ type: 'composer/mention', mention: null });
        return;
      }
      const results = rankMentions(token.query, mentionSources(repo.graph, repo.functions?.graph ?? null));
      dispatch({
        type: 'composer/mention',
        mention: {
          query: token.query,
          from: token.from,
          to: token.to,
          /* `resolved` and `no-matches` are DIFFERENT rendered states — the
             second draws "No grounded matches" as its own row rather than an
             empty box the reader cannot interpret. */
          status: results.length === 0 ? 'no-matches' : 'resolved',
          results,
          activeIndex: 0,
        },
      });
    },
    onMentionMove: (delta: number) => dispatch({ type: 'composer/mention-move', delta }),
    onMentionPick: (result) => {
      const mention = state.composer.mention;
      /* The `@token` comes OUT of the draft — the chip is the reference now, and
         leaving the text behind would send the name twice, once as prose the
         engine cannot resolve. */
      if (mention) {
        dispatch({
          type: 'composer/draft',
          text: `${state.composer.draft.slice(0, mention.from)}${state.composer.draft.slice(mention.to)}`,
        });
      }
      dispatch({ type: 'composer/chip-add', chip: chipFromMention(result) });
      dispatch({ type: 'composer/mention', mention: null });
    },
    /*
     * SEND OPENS THE STREAM. Until item 2.9 this dispatched `turn/send` and
     * stopped there — the message landed in the transcript and no request was
     * ever made, so the answer never came and there was nothing to stop.
     *
     * The order matters: `turn/send` first, so the user's words are on screen
     * before the wire is touched, and so `state.composer.draft` is read BEFORE
     * the reducer clears it.
     */
    onSend: () => {
      const question = state.composer.draft.trim();
      if (!question) return;

      /*
       * A FOLLOW-UP TYPED MID-STREAM IS HELD, NOT DROPPED.
       *
       * `send` refuses while a turn is unsettled, so pressing Enter during a
       * stream used to do nothing at all: no error, no queue, no sign. The
       * reader had to notice their question had not been asked and ask it
       * again.
       *
       * Held rather than sent silently later — it is shown, and it can be
       * taken back. A question that fires itself two minutes after it was
       * typed, with no sign it was pending, is worse than one that was
       * dropped.
       */
      if (state.session.inFlight !== null) {
        dispatch({ type: 'turn/queue', text: question });
        return;
      }

      /*
       * BLANK WORKSPACE → DESIGN-MODE ASK, NOT A HARD BLOCK.
       *
       * Seat walk blocked unattached send to avoid a raw 409. Owner follow-up:
       * a blank workspace must still let you chat. The engine already accepts
       * `/api/ask` with `design: { title, outline }` when nothing is attached —
       * that is the from-scratch path. Carry the question as the outline so
       * the prompt has grounding text rather than inventing architecture.
       */
      const unattached =
        state.repo.phase !== 'attached' && state.repo.phase !== 'stale';

      const historyMeta = askHistoryMeta(state.session.turns);
      dispatch({
        type: 'turn/send',
        at: Date.now(),
        memoryTrim: historyMeta.droppedTurns > 0 ? { droppedTurns: historyMeta.droppedTurns } : null,
      });
      /*
       * THE ATTACHMENTS GO WITH THE TURN THAT CARRIED THEM.
       *
       * Keeping them would push the same log through every following turn -
       * invisibly, since the chips would sit there looking like a record of
       * what was sent rather than a promise about what will be. The answer
       * enters the history, so the follow-up already has the context; what it
       * does not need is the raw 128KB again.
       *
       * Dispatched AFTER the payload above is built from `state`, which is
       * this render's snapshot, so the ids still reach the request.
       */
      dispatch({ type: 'composer/attachments-clear' });

      liveTurn?.abort();
      const controller = new AbortController();
      liveTurn = controller;

      void transport
        .stream(
          {
            question,
            /* The chips the user grounded on are context, not prose glued onto
             * their question — the same separation the server's prompt keeps. */
            context: state.composer.chips.length
              ? {
                  /* Chip refs are grounded ids (node:/file:); labels alone lose
                     dual-board grounding when whiteboard + architecture share a node. */
                  lines: state.composer.chips.map((chip) =>
                    chip.ref ? `${chip.kind}:${chip.ref} (${chip.label})` : chip.label,
                  ),
                }
              : undefined,
            /*
             * THE CONVERSATION, WHICH THIS NEVER SENT.
             *
             * Every other piece was already built: `history` is in
             * `PostAskRequest`, the server parses it, and
             * `renderAskHistorySection` puts it in the prompt under "PRIOR CHAT
             * (same workspace; continue coherently)". The client stopped at
             * `{ question, context }`, so the second message in any thread was
             * answered as if it were the first — "and its callers?" arrived
             * with nothing to resolve "its" against.
             *
             * `state` is this render's snapshot, taken BEFORE the `turn/send`
             * dispatch above commits the question being asked. So the question
             * is not in here twice, and `askHistory.test.ts` locks that.
             */
            history: historyMeta.turns,
            ...(historyMeta.droppedTurns > 0 ? { historyDropped: historyMeta.droppedTurns } : {}),
            /*
             * THE MODE THE READER CHOSE, WHICH NEVER LEFT THE BROWSER.
             *
             * The control under the composer said what the agent was allowed
             * to do; `PostAskRequest` had no field for it, and the server
             * enforced its own rules having never learned what was chosen. The
             * control was decorative.
             */
            permission: state.composer.permission.mode,
            /*
             * WHICH SITTING THE AGENT'S OWN WRITES BELONG TO.
             *
             * Under Auto-edit / Full the server writes files without an Accept,
             * and it files their pre-write baselines under this id — the same
             * one the Review apply and PUT /api/file already send — so a turn
             * the agent wrote on its own has a restore point like any other.
             * Without it those writes were invisible to Rewind.
             */
            sessionId: checkpointSessionId(),
            /*
             * WHICH CONVERSATION THIS ASK BELONGS TO, WHICH THIS NEVER SENT.
             *
             * A teach turn's lesson is filed under this id. Without it the
             * server fell back to the session index's `activeId` — a guess about
             * which conversation the person meant — and when the guess was
             * wrong the lesson went to a different session from the chat. The
             * conversation on screen then had no lesson, so no concept, so no
             * chart and no check-in, and the model closed with a clarifying
             * question the teach contract bans. The 2026-09-06 seat read
             * reported that as three separate faults.
             *
             * `state.session.activeId` is the conversation this client is
             * DISPLAYING. Sending it means the server never has to guess.
             */
            ...(state.session.activeId ? { threadId: state.session.activeId } : {}),
            /* Teach Mode: on the wire only when on — absent means off, and an
               older server ignores the unknown field harmlessly. */
            ...(state.composer.teach ? { teach: true } : {}),
            /* The one click, on the wire only when the learner made it. Absent
               means "not stated", which adds no skip rather than asserting they
               are a beginner. */
            ...(state.composer.teachKnown ? { teachKnown: state.composer.teachKnown } : {}),
            /*
             * WHAT THE USER IS LOOKING AT — workspace Architecture / Whiteboard.
             * Absent on chat-alone so deictic "this" is not answered against a
             * board that is not open. Wire id `task-board` means Whiteboard.
             */
            surface: state.composer.askSurface ?? undefined,
            /*
             * WHAT THE USER ATTACHED - IDS, NOT CONTENT.
             *
             * The text is already on disk under `.sequence/attachments`; a
             * follow-up naming the same log would otherwise push it through
             * the request body again on every turn. The server skips an id it
             * cannot resolve rather than refusing the question, so an
             * attachment swept between turns costs the evidence and not the
             * question.
             */
            attachmentIds: state.composer.attachments.length
              ? state.composer.attachments.map((a) => a.id)
              : undefined,
            ...(unattached
              ? {
                  /* Outline is the question itself — proposeArchitecture so the
                     model proposes a diagram instead of refusing a blank outline. */
                  design: {
                    title: 'Blank workspace',
                    outline: question,
                    proposeArchitecture: true,
                  },
                }
              : {}),
          },
          {
            signal: controller.signal,
            onEvent: (event) => {
              dispatch({ type: 'turn/event', event, at: Date.now() });
              /*
               * A TURN THAT FAILS MUST ALSO RAISE THE STRIP.
               *
               * `net/failed` was dispatched only when the TRANSPORT failed. A
               * turn that streams perfectly and ends in an `error` EVENT - a
               * 200, an SSE frame saying the provider refused - left
               * `net.lastFailure` null, so no strip appeared and neither Retry
               * nor any other action was ever offered. That is the most common
               * failure there is: no model configured.
               *
               * The two surfaces are not duplicates, and `transcriptModel`
               * says why: the committed turn keeps ONE MUTED LINE because it
               * "still has to be readable a week later", and "the strip is for
               * the failure that just happened". The record was there; the
               * thing you can act on was not.
               */
              if (event.type === 'error') {
                dispatch({
                  type: 'net/failed',
                  failure: {
                    status: event.httpStatus ?? null,
                    /* The server's own sentence, never one composed here. */
                    message: event.error,
                    route: `POST ${ASK_STREAM_ROUTE}`,
                    at: Date.now(),
                  },
                });
              }
            },
          },
        )
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.outcome !== 'ok') {
            /* Each outcome says a different true thing, and the strip prints
             * what it was told. A single "request failed" would be the caption
             * sheet 08.3 refuses: a measurement offered and then withheld. */
            dispatch({
              type: 'net/failed',
              failure: {
                status: result.outcome === 'unreachable' ? null : result.status,
                message:
                  result.outcome === 'unreachable'
                    ? result.message
                    : result.outcome === 'not-json'
                      ? `the engine answered ${result.status} and the answer was not a stream`
                      : `the engine answered ${result.status}`,
                route: `POST ${ASK_STREAM_ROUTE}`,
                at: Date.now(),
              },
            });
          }
          /* A turn always ends in a state, never in silence — CANON's third
           * non-negotiable. `turn/stopped` is the reducer's terminal for both a
           * finished stream and a refused one. */
          dispatch({ type: 'turn/stopped', at: Date.now() });
        })
        .finally(() => {
          if (liveTurn === controller) liveTurn = null;
        });
    },
    onStop: () => {
      dispatch({ type: 'turn/stopping', at: Date.now() });
      liveTurn?.abort();
      liveTurn = null;
      dispatch({ type: 'turn/stopped', at: Date.now() });
    },
    onRemoveChip: (id: string) => dispatch({ type: 'composer/chip-remove', id }),
    /*
     * STORE FIRST, THEN SHOW A CHIP.
     *
     * The chip appears only once the server has the bytes and has answered an
     * id. Showing it optimistically would put a chip on screen for content the
     * next turn cannot name - the turn sends ids, so a chip without one is a
     * chip that silently contributes nothing.
     */
    onAttach: (name: string, text: string) => {
      void fetch('/api/attachment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, text }),
      })
        .then(async (res) => {
          if (!res.ok) {
            /* The server's own sentence, never one composed here - the same
               rule the rest of this file follows, and it goes through the ONE
               failure channel the strip already reads rather than a second
               one nothing is subscribed to. */
            dispatch({
              type: 'net/failed',
              failure: {
                status: res.status,
                message: (await res.text()).trim() || 'the engine refused the attachment',
                route: 'POST /api/attachment',
                at: Date.now(),
              },
            });
            return;
          }
          const body = (await res.json()) as { attachment?: ComposerAttachment };
          if (body.attachment) dispatch({ type: 'composer/attachment-add', attachment: body.attachment });
        })
        .catch(() => {
          dispatch({
            type: 'net/failed',
            failure: { status: null, message: 'the engine did not answer', route: 'POST /api/attachment', at: Date.now() },
          });
        });
    },
    onRemoveAttachment: (id: string) => dispatch({ type: 'composer/attachment-remove', id }),
    /*
     * A REFUSED FILE IS SAID OUT LOUD. A file that vanishes on drop with no
     * sentence is indistinguishable from a broken drop target, and the reader
     * has no way to learn that images are the thing not supported.
     */
    onAttachRefused: (message: string) =>
      dispatch({
        type: 'net/failed',
        failure: { status: null, message, route: 'drop', at: Date.now() },
      }),
    onToggleToolbelt: () =>
      dispatch({ type: 'composer/toolbelt', open: !state.composer.toolbeltOpen }),
    onCloseToolbelt: () => dispatch({ type: 'composer/toolbelt', open: false }),
    onToolbeltPick: (id: ToolbeltId) => {
      /*
       * Closing the menu first — a menu that stays open after a click reads as
       * a click that did not land. Then each id does real work (P1):
       * break-down / what-breaks seed + send an ask; start-workflow opens
       * Activity; models opens Settings → provider.
       */
      dispatch({ type: 'composer/toolbelt', open: false });
      if (id === 'models') {
        dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'provider' } });
        return;
      }
      if (id === 'start-workflow') {
        /*
         * P4 — open Activity with the author form prefilled from the composer
         * so Start reaches POST /api/program/run in one confirm, not a blank
         * viewer that looked like the feature was missing.
         */
        const chipBits = state.composer.chips.map((c) => c.label).filter(Boolean);
        const draft = state.composer.draft.trim();
        const instruction =
          draft ||
          (chipBits.length > 0
            ? `Run a grounded workflow for: ${chipBits.join(', ')}`
            : 'Review the attached repository and propose the highest-value next change.');
        setActivityLaunch({
          name: chipBits[0] ? `Workflow · ${chipBits[0]}` : 'Workflow from chat',
          instruction,
        });
        dispatch({ type: 'shell/overlay', overlay: { kind: 'activity' } });
        return;
      }
      const chips = state.composer.chips.map((c) => c.label);
      const text = toolbeltAskText(id, chips);
      dispatch({ type: 'composer/draft', text });
      composerPropsFrom(
        { ...state, composer: { ...state.composer, draft: text, toolbeltOpen: false } },
        store,
        transport,
      ).onSend();
    },
    onPermissionChange: (mode: PermissionMode) => dispatch({ type: 'composer/permission', mode }),
    onTeachToggle: (on: boolean) => dispatch({ type: 'composer/teach', on }),
    onTeachKnownChange: (known: 'new' | 'used-it' | 'ship-it') =>
      dispatch({ type: 'composer/teach-known', known }),
  };
}

/**
 * The live turn's abort handle.
 *
 * Module-scoped rather than React state on purpose: Stop must reach the fetch
 * that `onSend` opened, and both handlers are rebuilt on every render by
 * `chatColumnPropsFrom`. Putting it in state would give Stop a controller from a
 * previous render and abort nothing. One turn is in flight at a time — the store
 * refuses a second `turn/send` while `inFlight` — so one handle is the right
 * number.
 */
let liveTurn: AbortController | null = null;

export function chatColumnPropsFrom(state: AppState, store: Store): ChatColumnProps {
  const { dispatch } = store;
  return {
    turns: state.session.turns,
    inFlight: state.session.inFlight,
    proposals: state.session.proposals,
    contextWindow: state.composer.contextWindow,
    /*
     * Rewrite removed — owner seat-walk (2026-08-25): no edit affordance on
     * sent questions; the white left rule on bubbles is gone too.
     */
    onEdit: undefined,
    reasoningProvider:
      state.composer.model.origin === 'unconfigured' || state.composer.model.model === ''
        ? null
        : state.composer.model.model,
    onOpen: (target: 'canvas' | 'ai-canvas' | 'rail' | 'review' | 'browser' | 'terminal', turnId: TurnId) => {
      if (target === 'canvas') {
        requestHostCommand('canvas.board');
        return;
      }
      if (target === 'ai-canvas') {
        requestHostCommand('canvas.ai');
        return;
      }
      if (target === 'rail') {
        requestHostCommand('rail.focus');
        return;
      }
      if (target === 'browser') {
        requestHostCommand('browser.open');
        return;
      }
      if (target === 'terminal') {
        requestHostCommand('terminal.open');
        return;
      }
      /* Prefer the live store — chatColumnPropsFrom closes over a render's
         state, and a click after commit must see the committed effect. */
      const live = store.getState();
      const turn = live.session.turns
        .filter((t): t is Extract<typeof t, { role: 'assistant' }> => t.role === 'assistant')
        .find((t) => t.id === turnId);
      if (turn === undefined) return;
      let proposalId: ProposalId | null = null;
      if (turn.effect.kind === 'propose') {
        proposalId = turn.effect.proposalId;
      } else {
        /* Evidence is the authoritative list when effect lagged (should not,
           but Prefer the proposal over a silent no-op on the opens row). */
        const fromEvidence = turn.evidence.proposals[turn.evidence.proposals.length - 1];
        proposalId = fromEvidence ?? null;
      }
      if (proposalId === null) return;
      dispatch({
        type: 'shell/overlay',
        overlay: { kind: 'review', proposalId },
      });
    },
    onAttach:
      state.repo.phase === 'attached' || state.repo.phase === 'stale'
        ? undefined
        : () => dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }),
    /* Starter chips fill the DRAFT — the same door review comments use, and
       for the same reason: a stray click must never run an agent. */
    onStarter: (text: string) => dispatch({ type: 'composer/draft', text }),
    composer: composerPropsFrom(state, store),
  };
}

/**
 * The boot surface's props.
 *
 * `onOpenAttach` is supplied, which is what tells `BootSurface` to hand the
 * overlay to the shell instead of hosting the dialog itself — its own doc
 * comment describes both modes and this is the connected one.
 *
 * `onSettled` IS THE WIRE THAT WAS MISSING, and its absence is what the Wave 3
 * gate measured as a board drawing zero nodes. `store.ts` has carried the
 * `boot/settled` case and `bootSettled`'s seven-way switch since item 2.2; no
 * file in the tree dispatched that action, so the ladder's answer — including
 * a successfully hydrated repository — reached the screen as a sentence and
 * reached the STORE not at all. `onRepoLoaded` did not cover it: that fires
 * only when the attach dialog succeeds.
 */
export function bootSurfacePropsFrom(transport: BootTransport, store: Store): BootSurfaceProps {
  const { dispatch } = store;
  return {
    transport,
    onSettled: (outcome) => dispatch({ type: 'boot/settled', outcome }),
    onRepoLoaded: (draft) => dispatch({ type: 'repo/loaded', draft, at: Date.now() }),
    onOpenAttach: () => dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }),
  };
}

/**
 * The frame's props — the three slots, the whole shell slice, and one callback
 * per gesture.
 *
 * WIDTHS AND BREAKPOINTS ARE HERE NOW, AND THAT IS THE POINT. The comment that
 * stood here said they were not: "`Shell.tsx` still owns its own layout state,
 * and handing it a second set of numbers from the store would create the
 * disagreement this store exists to remove." The reasoning was right and the
 * conclusion was upside down — the second set of numbers was the one inside
 * `Shell.tsx`, and while it existed the store's `shell` slice was written by
 * reducers nothing read. The board's "Open a repository" dispatched
 * `shell/overlay` into that slice and a real browser got no dialog.
 *
 * `theme` USED TO BE PASSED SEPARATELY, beside a `shell.theme` the component
 * also had. Two names for one value in one props object is the same defect at
 * one-eighth scale; the shell reads `shell.theme` and there is no override.
 */
export type ShellSlots = Pick<
  ShellProps,
  | 'chat'
  | 'canvas'
  | 'sessions'
  | 'rail'
  | 'railHeader'
  | 'railTitle'
  | 'boardMounted'
  | 'boardDocked'
  | 'onMinimizeBoard'
  | 'onRestoreBoard'
  | 'appbar'
  | 'workspaceChrome'
  | 'tabLayout'
  | 'tabWorkspace'
  | 'renderOverlay'
  | 'onCommand'
>;

export function shellPropsFrom(state: AppState, store: Store, slots: ShellSlots): ShellProps {
  const { dispatch } = store;
  return {
    ...slots,
    shell: state.shell,
    onFrame: (frame) => dispatch({ type: 'shell/frame', frame }),
    onTogglePane: (pane) => dispatch({ type: 'shell/pane-toggle', pane }),
    onResizePane: (pane, width) => dispatch({ type: 'shell/pane-width', pane, width }),
    onDragPane: (dragging) => dispatch({ type: 'shell/dragging', dragging }),
    onResetPanes: () => dispatch({ type: 'shell/pane-reset' }),
    onOverlay: (overlay) => dispatch({ type: 'shell/overlay', overlay }),
    /* The same selector the chat's `grounding` uses, and deliberately so: a
       stale graph is still the graph on screen, so it still names the repo.
       Two different answers to "which repository is this" in one frame would
       be a bug nobody could see. */
    repoName: groundedRepoName(state),
    /*
     * THE BOARD PANE EXISTS EXACTLY WHILE A REPOSITORY IS ATTACHED — Decision
     * 5's no-board boot, derived from the same selector as `repoName` rather
     * than from a second opinion about attachment. `stale` keeps the board:
     * it still carries a document to draw, and the staleness is said in words
     * elsewhere. A caller that supplied the fact explicitly wins — the shell
     * renders what it is handed.
     */
    boardMounted: slots.boardMounted ?? groundedRepoName(state) !== null,
    /*
     * ESCAPE STOPS A RUNNING TURN — but only after the shell has found nothing
     * to close, and only when something is actually running.
     *
     * Supplied as UNDEFINED when nothing is in flight rather than as a
     * no-op, because the shell's contract is that an absent handler means
     * there is nothing to interrupt. A function that did nothing would make
     * Escape look handled while doing nothing at all.
     *
     * Cancellation itself was already shipped end to end — the Stop button,
     * liveTurn.abort, requestAbort on connection close, the metered provider
     * call. It was mouse-only, and Escape is the reflex every terminal-agent
     * user brings with them.
     */
    onInterrupt: state.session.inFlight ? () => composerPropsFrom(state, store).onStop() : undefined,
    /*
     * `onCommand` IS THE CALLER'S AND IS NOT DEFAULTED HERE. The shell's own
     * command list marks commands outside the frame `owner: 'host'`.
     * `composer.focus` is one: focusing a textarea is a DOM act that no reducer
     * can perform. Shell.tsx's own contract says an absent `onCommand` means
     * "the surface those commands need is not mounted, and the rows say so
     * instead of lying"; supplying an empty function here would replace that
     * honest disabled row with a row that does nothing when clicked.
     */
  };
}

/* ========================================================================== *
 * THE CONNECTED SURFACES
 * ========================================================================== */

/**
 * The chat column, taking NOTHING from its caller.
 *
 * This is what "the surfaces get their props from the store" means as a
 * checkable fact rather than a claim: there is no prop to pass, so a test that
 * changes what is on screen can only have done it through a transition.
 */
export function ConnectedChatColumn() {
  const store = useStore();
  const state = useAppState();

  /*
   * THE QUEUED FOLLOW-UP GOES WHEN THE TURN DOES.
   *
   * Watched here rather than inside the reducer because sending is a
   * TRANSPORT act and the store performs none — the same division that keeps
   * `onSend` out of the reducer.
   *
   * Guarded on `inFlight === null` so it fires exactly once, at the moment the
   * previous turn settles. Without that it would re-fire on every render while
   * a queue sat there and send the same question repeatedly.
   */
  const queued = state.session.queued;
  const streaming = state.session.inFlight !== null;
  useEffect(() => {
    if (queued === null || streaming) return;
    store.dispatch({ type: 'turn/unqueue' });
    store.dispatch({ type: 'composer/draft', text: queued });
    composerPropsFrom(
      { ...store.getState(), composer: { ...store.getState().composer, draft: queued } },
      store,
    ).onSend();
  }, [queued, streaming, store]);

  /*
   * WHICH MODEL IS ANSWERING, ASKED ONCE.
   *
   * `composer.model` starts as EMPTY_MODEL and `composer/model` was dispatched
   * by nobody, so the label under the field was blank for every reader with a
   * key configured. The route has always served the answer.
   *
   * Fetched here rather than at boot because this is the component that
   * renders it — a boot-time fetch for a chat label would run on a surface
   * that has no chat, and fail silently for the whole session if it happened
   * to run before the server was ready.
   */
  /*
   * Fetch AI config whenever the chat column is up — blank workspace can ask
   * in design mode, so the model label still matters without a repo.
   *
   * boot.test allows `/api/ai-config` on the chat-only boot; it still forbids
   * unrelated boot fetches (fonts, etc.).
   */
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ai-config', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        const selection = modelFromConfig(body);
        store.dispatch({ type: 'composer/model', model: selection });
        /* The window comes back on the same answer, and is absent whenever the
           provider would not say - which the store records as null rather than
           inventing a ceiling. Prefer the provider's own number; fall back to
           the vendor-published window for the configured model id so the ring
           is not silently absent for Claude/GPT when only Ollama probes. */
        const win = (body as { contextWindow?: unknown } | null)?.contextWindow;
        const probed =
          typeof win === 'number' && Number.isInteger(win) && win > 0 ? win : null;
        store.dispatch({
          type: 'composer/context-window',
          tokens: probed ?? publishedContextWindow(selection.model),
        });
      })
      .catch(() => {
        /* Unreachable server, or aborted. The label already says "choose a
           model in Settings", which is the right thing to show when we cannot
           find out — and louder failures already have their own surface. */
      });
    return () => controller.abort();
  }, [store]);

  /*
   * GIT BRANCH FOR THE HOME CONTEXT ROW — only when a repo is attached.
   * Honest null until `/api/git/status` answers; never invented from repo name.
   */
  const repoAttached =
    state.repo.phase === 'attached' || state.repo.phase === 'stale';
  const repoRoot =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.root
      : null;
  useEffect(() => {
    if (!repoAttached) {
      store.dispatch({ type: 'session/git-branch', branch: null });
      return undefined;
    }
    const controller = new AbortController();
    void fetch('/api/git/status', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        const branch = typeof body.branch === 'string' ? body.branch : null;
        store.dispatch({ type: 'session/git-branch', branch });
      })
      .catch(() => {
        /* Unreachable or no repo — leave branch null rather than guessing. */
      });
    return () => controller.abort();
  }, [store, repoAttached, repoRoot]);

  /*
   * ── IS THIS REPOSITORY TRUSTED, AND WHAT IS IT ASKING FOR ──────────────
   *
   * Asked once per attached root. Until this answers, `trust.root` stays null
   * and the strip renders nothing — the third state, exactly as
   * `net.reachable` uses it: rendering "not trusted" before the probe returns
   * would accuse every repository for the length of a request, and a notice
   * that is sometimes wrong is a notice people learn to click past.
   *
   * THE INSTRUCTION TEXT THAT COMES BACK IS CONTENT, NOT INSTRUCTION. The
   * model's copy is built server-side and gated there
   * (`analyzer/src/explain/instructions.ts`); this route serves the same text
   * to the SURFACE so the person can read what the repo asked for before
   * deciding. Nothing on this path ever reaches a prompt.
   */
  useEffect(() => {
    if (!repoAttached) return undefined;
    const controller = new AbortController();
    void fetch('/api/repo-trust', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        store.dispatch({
          type: 'trust/loaded',
          root: typeof body.root === 'string' ? body.root : (repoRoot ?? ''),
          trusted: body.trusted === true,
          instructions: readInstructionsDisclosure(body.instructions),
        });
      })
      .catch(() => {
        /* Unreachable, or aborted. Leave `trust.root` null: the strip stays
           silent rather than accusing a repository because a fetch failed. */
      });
    return () => controller.abort();
  }, [store, repoAttached, repoRoot]);

  /*
   * THE TRANSCRIPT COMES BACK AFTER A RELOAD - rank 12, which was marked done
   * and was not reachable.
   *
   * Every piece existed: `/api/chat-memory` has always served the stored
   * transcript, `readChat`/`writeChat` are on the sessions client (whose own
   * comment says "no client ever asked for it - which is why a reload showed a
   * blank conversation that was sitting on disk the whole time"),
   * `fromChatMemory` parses it, and the store has a `session/hydrated` arm.
   * Nothing dispatched it. Twenty tests covered the pieces either side of the
   * call that was never made.
   *
   * ONLY INTO AN EMPTY TRANSCRIPT. Hydrating over a live conversation would
   * duplicate turns the reader is looking at; the restore is for the reload
   * case, which is exactly the case where there is nothing on screen yet.
   */
  const hydrated = useRef(false);
  const canvasHydrated = useRef(false);
  const indexHydrated = useRef(false);
  const transcriptEmpty = state.session.turns.length === 0;
  const canvasEmpty = state.session.canvasDoc.blocks.length === 0;

  /*
   * A REPO SWITCH RE-OPENS ALL THREE HYDRATION DOORS.
   *
   * The three refs above are one-shot by design — hydrating over a live
   * conversation would duplicate what the reader is looking at. But the
   * server keys sessions, chat memory and the canvas doc by the ATTACHED
   * REPOSITORY (`sessionsRoot()`), so after repo A → repo B the engine is
   * serving B's store while these refs still say "already fetched" about A's.
   * Measured 2026-08-29: repo A's transcript stood in repo B's workspace and
   * B's own saved sessions were never asked for. The reducer clears the slice
   * on a cross-repo `repo/loaded`; this clears the latches so the effects
   * below fetch again — against the repository the engine is now on.
   */
  const hydratedForRoot = useRef<string | null>(repoRoot);
  if (hydratedForRoot.current !== repoRoot) {
    hydratedForRoot.current = repoRoot;
    hydrated.current = false;
    canvasHydrated.current = false;
    indexHydrated.current = false;
  }
  /*
   * AND THE LATCH REOPENS FOR A DIFFERENT SESSION, not only a different repo.
   *
   * `canvasHydrated` was a once-per-repository latch, so the canvas was fetched
   * for whichever session happened to be active first and never again. Opening
   * a second lesson from the session list left its chart on disk unread — the
   * same symptom as the discard above, from a different cause, and it would
   * have survived that fix.
   */
  const canvasForSession = useRef<string | null>(null);
  const activeSessionId = state.session.activeId ?? null;
  if (canvasForSession.current !== activeSessionId) {
    canvasForSession.current = activeSessionId;
    canvasHydrated.current = false;
  }

  /*
   * ACTIVE SESSION ID FROM THE SERVER — scratch, chat-memory and canvas-doc
   * all key off whichever session the engine considers active. `activeId` in
   * the store stayed null forever, so `resolveScratchSessionId` always fell
   * back to `'workspace'` and every thread shared one Architecture board.
   */
  useEffect(() => {
    if (indexHydrated.current) return undefined;
    indexHydrated.current = true;
    const controller = new AbortController();
    void fetch('/api/sessions', { signal: controller.signal, headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        const index = (body as { index?: { activeId?: string; sessions?: unknown[] } }).index;
        if (!index || !Array.isArray(index.sessions)) return;
        const activeId = typeof index.activeId === 'string' && index.activeId ? index.activeId : null;
        store.dispatch({
          type: 'session/index',
          sessions: index.sessions as AppState['session']['sessions'],
          activeId,
        });
        const storage = scratchStorage();
        if (storage && activeId) migrateLegacyWorkspaceScratch(storage, activeId);
      })
      .catch(() => {
        /* Unreachable server — leave activeId null; scratch keeps the legacy
           workspace fallback until the index answers. */
      });
    return () => controller.abort();
  }, [store]);

  useEffect(() => {
    if (hydrated.current || !transcriptEmpty) return undefined;
    hydrated.current = true;
    /*
     * SAY THE FETCH STARTED, not only that it finished.
     *
     * `session/hydrating` had a reducer arm and no dispatcher: the flag was
     * only ever CLEARED, by `session/hydrated`, and never set. Harmless while
     * nothing renders a hydrating state - which is exactly why it went
     * unnoticed - and dishonest the moment something does, because the store
     * would be saying no hydrate is in flight while one is.
     */
    store.dispatch({ type: 'session/hydrating' });
    const controller = new AbortController();
    void fetch('/api/chat-memory', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        const turns = fromChatMemory(body);
        /* An empty stored transcript is the ordinary state of a new session.
           Dispatching for it would be a no-op that still marks the session
           hydrated, so it is simply skipped. */
        if (turns.length === 0) return;
        /* NO CAST. `fromChatMemory` returns real `Turn` values; it used to
           return a four-field shape that `as never` smuggled past the
           compiler, and the transcript crashed reading `turn.work`. */
        store.dispatch({ type: 'session/hydrated', turns });
      })
      .catch(() => {
        /* No stored transcript, or an unreachable server. A blank thread is
           what the reader had before this shipped; it is not worth a strip. */
      });
    return () => controller.abort();
  }, [store, transcriptEmpty]);

  useEffect(() => {
    if (canvasHydrated.current || !canvasEmpty || state.session.inFlight !== null) return undefined;
    canvasHydrated.current = true;
    const controller = new AbortController();
    void fetch('/api/canvas-doc', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (controller.signal.aborted || !body) return;
        const doc = fromCanvasMemory(body);
        /*
         * A CHART-ONLY CANVAS IS NOT AN EMPTY ONE.
         *
         * This tested `blocks` and `storyRoute` and threw away everything else,
         * so a session whose canvas holds one chart and no blocks was FETCHED
         * and DISCARDED: `canvas.json` had `charts: 1, blocks: 0`, the reopened
         * session showed the placeholder, and the file was right the whole time.
         *
         * Third leg of the same journey and the third separate defect: the live
         * path wiped the chart at turn end (`landCanvasBlocks`), the save path
         * never wrote it (`toCanvasMemory`), and the load path read it and
         * dropped it here. Each looked complete on its own.
         */
        if (doc.blocks.length === 0 && !doc.storyRoute && (doc.charts?.length ?? 0) === 0) return;
        store.dispatch({ type: 'session/canvas-hydrated', doc });
      })
      .catch(() => {
        /* No stored canvas — ordinary for a new session. */
      });
    return () => controller.abort();
  }, [store, canvasEmpty, state.session.inFlight]);

  /*
   * AND IT IS WRITTEN BACK when a turn settles — workspace or repo sessions.
   *
   * Guarded by `worthPersisting`, which exists for this and had no caller:
   * a thread with nothing but an unanswered question is not worth writing over
   * whatever is on disk. Keyed on the turn COUNT so an in-flight stream's
   * deltas do not put a request on the wire per frame.
   */
  const settledTurns = state.session.inFlight === null ? state.session.turns : null;
  const settledCount = settledTurns?.length ?? -1;
  useEffect(() => {
    if (settledTurns === null) return;
    if (!worthPersisting(settledTurns)) return;
    rememberChatForFlush(settledTurns);
    void fetch('/api/chat-memory', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      /* The server overwrites `sessionId` with whichever session is active, so
         the value sent here is a placeholder the route replaces rather than a
         claim this client is in a position to make. */
      body: JSON.stringify(toChatMemory('active', settledTurns)),
    }).catch(() => {
      /* Best effort. Losing the persisted copy is recoverable; failing the
         turn the reader just had is not. */
    });
  }, [settledCount, settledTurns]);

  /*
   * ALSO KEEP A FLUSH SNAPSHOT WHILE A TURN IS IN FLIGHT.
   *
   * Leaving mid-stream used to skip the settle PUT entirely (`settledTurns`
   * is null), then reload blanked the thread. Remember completed turns so
   * `flushAndReload` can still write them before the page tears down.
   */
  useEffect(() => {
    if (state.session.turns.length === 0) return;
    rememberChatForFlush(state.session.turns);
  }, [state.session.turns]);

  const settledCanvas =
    state.session.inFlight === null ? state.session.canvasDoc : null;
  const settledCanvasBlocks = settledCanvas?.blocks.length ?? -1;
  useEffect(() => {
    if (settledCanvas === null) return;
    if (!worthPersistingCanvas(settledCanvas)) return;
    rememberCanvasForFlush(settledCanvas);
    void fetch('/api/canvas-doc', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toCanvasMemory('active', settledCanvas)),
    }).catch(() => {
      /* Best effort — same contract as chat-memory. */
    });
  }, [settledCanvasBlocks, settledCanvas]);

  useEffect(() => {
    rememberCanvasForFlush(state.session.canvasDoc);
  }, [state.session.canvasDoc]);

  return <ChatColumn {...chatColumnPropsFrom(state, store)} />;
}

export function ConnectedBootSurface({ transport }: { transport: BootTransport }) {
  const store = useStore();
  return <BootSurface {...bootSurfacePropsFrom(transport, store)} />;
}

/**
 * HEADLESS BOOT HYDRATE — the wire OpenCode boot dropped.
 *
 * Seat-walk removed the third-region `BootSurface` so chat fills the frame
 * until attach. That also removed the ONLY dispatcher of `boot/settled`, so an
 * engine started with `--repo` answered `/api/status` + `/archgraph.json`
 * while the store stayed `unattached` and the board said "No graph yet".
 *
 * This component runs the same ladder and hands the outcome to the store. It
 * paints nothing — the empty board and the attach chip remain the visible door
 * when nothing is attached.
 */
export function ConnectedBootHydrate({ transport }: { transport: BootTransport }) {
  const store = useStore();
  const { state } = useBoot(transport);
  const settled = state.phase === 'settled' ? state.outcome : null;
  const handOn = useRef<(outcome: BootOutcome) => void>((outcome) => {
    store.dispatch({ type: 'boot/settled', outcome });
  });
  handOn.current = (outcome) => {
    store.dispatch({ type: 'boot/settled', outcome });
  };

  useEffect(() => {
    if (settled !== null) handOn.current(settled);
  }, [settled]);

  return null;
}

export function ConnectedShell(slots: ShellSlots) {
  const store = useStore();
  const state = useAppState();
  return <Shell {...shellPropsFrom(state, store, slots)} />;
}
