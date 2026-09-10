import { deriveSendState } from '../chat';
import { isAskProgressEvent, resolveAskRoundCap } from '../chat/askLiveStatus';
import { stripToolProse } from '../chat/stripToolProse';
import { canvasBlockTypeFromToolName } from '../app/aiCanvasBlockMeta';
import {
  DEFAULT_SHELL_TOKENS,
  layoutOf,
  resetPaneWidths,
  withDragging,
  withFrame,
  withOverlay,
  withPaneToggled,
  withPaneOpen,
  withPaneWidth,
  withTheme,
} from '../shell';
import type { PaneName, ShellState, ShellTokens } from '../shell';
import type { BootOutcome, ScannedRepoDraft } from '../boot';
import type { AskSurfaceContext } from '@sequence/api-types';
import { createInitialState, EMPTY_CANVAS, type InitialStateInput } from './initial';
import type {
  AppState,
  AskEvent,
  AssistantTurn,
  AttachFailure,
  MentionQuery,
  RepoPath,
  ScanProgress,
  StaleReason,
  ContextChip,
  FileEditProposal,
  InFlightTurn,
  ModelSelection,
  PermissionMode,
  ProposalId,
  RemoteFailure,
  ScannedRepo,
  SessionSlice,
  ShellOverlay,
  ThemePreference,
  Turn,
  TurnEffect,
  TurnFailure,
  TurnId,
  UserTurn,
  WorkGroup,
  WorkRow,
  ComposerAttachment,
  NodeId,
  TopologyProposal,
} from './types';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.2 — THE STORE.
   packages/web2/src/state/store.ts

   ─────────────────────────────────────────────────────────────────────────
   A STORE, NOT AN EVENT LOG — AND WHY, GIVEN THAT ML-HARNESS PROVES THE
   OPPOSITE WORKS.
   ─────────────────────────────────────────────────────────────────────────

   `docs/research/ml-harness-adoption.md` §1.1 is the strongest argument in that
   document: MLH's transcript is a fold over a durable, id-numbered SERVER-side
   event log, its client keeps events in a Map keyed by the row id, and §1.10
   records the consequence — grep for `createContext|useContext|zustand` in its
   frontend returns zero hits. It has no store because it has no second source
   of truth, which is why its replay is idempotent by construction.

   Sequence cannot have that today, and would not want all of it even when it
   can. Three findings, each checkable:

   1. THE LOG DOES NOT EXIST ON THE WIRE. §1.1 of the same document: Sequence's
      `writeSseEvent` emits `data:` only, with NO `id:` line, and `askBoardStream`
      is a one-shot POST-SSE reader whose answer arrives in the terminal
      `result` frame. There is nothing durable and nothing id-numbered to fold.
      Wave 1 items 1.1 and 1.2 add it. A client that folded an event log TODAY
      would be folding a log it invented and held in memory — a second source of
      truth with more ceremony, not less.

   2. THE CANVAS IS READER STATE, AND NO SERVER LOG CAN EVER PRODUCE IT. This
      is the difference the item names, and it is decisive. MLH draws a
      transcript: every pixel it shows is a consequence of an event the server
      recorded. Sequence draws a graph the reader manipulates — selection,
      viewport, scope trail, dimming, LOD rung, dragged node positions, which
      breakout is open, how wide the panes are. The server never learns any of
      it and therefore can never replay it. A fold cannot produce a fact nobody
      logged, so a log-only client would need a store for the canvas anyway, and
      then there really would be two mechanisms.

   3. THE FROZEN CONTRACT ALREADY DECIDED. `types.ts` is eight slices of STATE,
      not a list of events, and its `TurnEffect` union exists specifically so
      that "a turn resolves into exactly one effect the store applies". Item 2.1
      named the implementation lane as 2.2 and called the store the
      serialization point (risk R13). Re-litigating that here would be the
      fifth design of one thing in seventeen days, which is R11.

   SO: A STORE, WITH THE LOG'S DISCIPLINE WHERE IT APPLIES. Three properties are
   taken from MLH verbatim, and they are what stop this from becoming v1's
   2,387-line store with 92 actions:

     a. COMMITTED TURNS ARE APPEND-ONLY AND NEVER MUTATED IN PLACE. The
        streaming turn lives OUTSIDE `session.turns` — the frozen contract
        demands it — and is committed exactly once, whole. MLH's guarantee is
        that a reload reconstructs the turn character-for-character; ours is the
        narrower one the wire can actually support: a half-streamed answer never
        enters the record, so a cancelled stream cannot leave half a sentence
        behind that reloads as fact.

     b. ANYTHING A FOLD CAN PRODUCE IS NOT STORED. `composer.send` is the named
        case and it has its own funnel below. The transcript is likewise not
        stored: `foldTranscript(turns, inFlight)` is called by the renderer.

     c. ONE FUNNEL. There is exactly one way state changes — `dispatch` —
        and every path through it ends in `derive()`. v1's board reached the
        store through seventeen selectors plus two `getState`/`setState` pokes.
        There is no `setState` here to poke.

   WHAT THIS FILE DELIBERATELY DOES NOT DO: fetch. There is no transport in the
   store. Item 2.9 owns the ask transport and item 2.4 already owns the boot
   one; both hand results in as actions. A store that fetches is a store you
   cannot test without a server, and it is how `aiClient.ts` reached 48,210 B
   with thirty-odd bespoke `fetch('/api/…')` call sites.
   ══════════════════════════════════════════════════════════════════════════ */

/* ========================================================================== *
 * THE PROJECTION SEAM
 * ========================================================================== */

/**
 * `ScannedRepo` carries `doc` — the `SeqDiagramV1` the canvas actually paints,
 * made by `seqdFromGraph`. That module now lives at
 * `src/canvas/seqdFromGraph.ts`, lifted out of v1 verbatim by Wave 3's closing
 * lane, and `app/App.tsx` binds it as this store's `project`.
 *
 * IT IS STILL A SEAM AND NOT AN IMPORT. This file does not reach into the
 * canvas lane, and must not: the store is the serialization point for every
 * surface, and a store that depends on one of them is a store that cannot be
 * tested without it. The projector arrives as a function at construction.
 *
 * The type is read back off the frozen contract rather than deep-imported from
 * `@sequence/schema`, so this file adds no second path to those declarations.
 */
export type Projection = ScannedRepo['doc'];
export type ScannedGraph = ScannedRepo['graph'];
export type Projector = (graph: ScannedGraph) => Projection;

/* ========================================================================== *
 * THE ACTIONS
 * ========================================================================== */

/**
 * Every transition the store accepts. Twenty-odd, against v1's ninety-two.
 *
 * NOTE WHAT IS ABSENT: there is no action that sets `composer.send`, and there
 * cannot be one. That is not a convention — the union below is the complete
 * list of ways state may change, so an action that does not exist is a mutation
 * that cannot happen.
 *
 * NOTE WHAT IS NO LONGER ABSENT: pane widths, pane visibility and drag state.
 * The comment that stood here said they were missing because "`Shell.tsx` still
 * owns its own layout state, so a `shell/pane-width` action here would be a
 * SECOND place a width can change", and promised that "the remaining shell
 * actions land in the same commit that makes `Shell.tsx` becomes controlled,
 * and not before."
 *
 * THIS IS THAT COMMIT. `Shell.tsx` holds no state; the four actions below are
 * the only way a pane moves, and the shell renders whatever comes back. The
 * arithmetic did not move with them — every one of these delegates to the same
 * React-free reducer in `shellModel.ts` that the component used to call, so
 * there is still exactly one place a breakpoint, a clamp or a canvas width is
 * decided.
 */
export type Action =
  /* ── the composer ────────────────────────────────────────────────────── */
  | { type: 'composer/draft'; text: string }
  | { type: 'composer/chip-add'; chip: ContextChip }
  | { type: 'composer/chip-remove'; id: string }
  /** The server stored a pasted or dropped attachment and answered its id. */
  | { type: 'composer/attachment-add'; attachment: ComposerAttachment }
  | { type: 'composer/attachment-remove'; id: string }
  /** Every attachment is cleared once the turn that carried them is sent. */
  | { type: 'composer/attachments-clear' }
  /**
   * The `@` picker's whole state, set in one action.
   *
   * `ComposerSlice.mention` and `MentionQuery` have been declared since the
   * slice was written and nothing ever produced them — the same shape of gap as
   * the `stale` phase. The results are computed by the connected layer, which is
   * the only place that holds the graph and the function index, and handed over
   * whole so the reducer never has to know what a mention resolves against.
   */
  | { type: 'composer/mention'; mention: MentionQuery | null }
  /** Move the highlight. Wraps, because a list you cannot get back to the top
   *  of is a list you scroll past. */
  | { type: 'composer/mention-move'; delta: number }
  | { type: 'composer/toolbelt'; open: boolean }
  /** Ask the composer to take focus. See `ComposerSlice.focusNonce`. */
  | { type: 'composer/focus' }
  | { type: 'composer/teach'; on: boolean }
  | { type: 'composer/teach-known'; known: 'new' | 'used-it' | 'ship-it' | null }
  | { type: 'composer/permission'; mode: PermissionMode }
  | { type: 'composer/permission-enabled'; enabled: PermissionMode[] }
  | { type: 'composer/model'; model: ModelSelection }
  | { type: 'composer/context-window'; tokens: number | null }
  /** Workspace chrome → ask surface (Architecture / Whiteboard / chat-alone). */
  | { type: 'composer/ask-surface'; surface: AskSurfaceContext | null }
  /* ── the thread ──────────────────────────────────────────────────────── */
  | { type: 'turn/send'; at: number; memoryTrim?: { droppedTurns: number } | null }
  | { type: 'turn/event'; event: AskEvent; at: number }
  | { type: 'turn/stopping'; at: number }
  | { type: 'turn/stopped'; at: number }
  | { type: 'topology/clear' }
  /* ── the repo ────────────────────────────────────────────────────────── */
  | { type: 'repo/scanning'; root: string; repoName: string; at: number }
  | { type: 'repo/scan-progress'; progress: ScanProgress }
  | { type: 'repo/loaded'; draft: ScannedRepoDraft; at: number }
  | { type: 'repo/failed'; attempted: string | null; failure: AttachFailure }
  | { type: 'repo/detached' }
  /**
   * The graph is knowingly out of date.
   *
   * `PUT /api/file` clears the persisted graph cache WITHOUT re-scanning, so the
   * moment an accepted edit lands, every claim the board makes is grounded in a
   * file that may no longer say what the citation says. `RepoStale` and four
   * surfaces that branch on it have existed the whole time with nothing able to
   * produce the state.
   */
  | {
      type: 'repo/stale';
      reason: StaleReason;
      /** The paths the write landed on, when the cause named them. */
      changedPaths: RepoPath[];
      at: number;
    }
  | { type: 'boot/settled'; outcome: BootOutcome }
  /* ── the shell and the wire ──────────────────────────────────────────── */
  | { type: 'shell/frame'; frame: { width: number; height: number } }
  | { type: 'shell/theme'; theme: ThemePreference }
  | { type: 'shell/overlay'; overlay: ShellOverlay | null }
  | { type: 'shell/pane-toggle'; pane: PaneName }
  | { type: 'shell/pane-width'; pane: PaneName; width: number }
  | { type: 'shell/pane-reset' }
  | { type: 'shell/dragging'; dragging: PaneName | null }
  /* ── the trust boundary ──────────────────────────────────────────────── */
  /**
   * `GET /api/repo-trust` answered: whether this root is trusted, and what the
   * repository is ASKING FOR.
   *
   * The instruction text arrives as CONTENT for the reader, never as
   * instruction for the model — the model's copy is gated server-side
   * (`analyzer/src/explain/instructions.ts`) and never travels this way.
   */
  | {
      type: 'trust/loaded';
      root: string;
      trusted: boolean;
      instructions: { file: string; text: string; truncated: boolean } | null;
    }
  /** Open or close the disclosure that shows what the repo asked for. */
  | { type: 'trust/review'; open: boolean }
  | { type: 'net/failed'; failure: RemoteFailure }
  /**
   * Put the failure strip down.
   *
   * `net/failed` has existed since the strip did, with nothing to clear it — so
   * a failed ask left a permanent, undismissable error above the composer for
   * the rest of the session. The Dismiss button was rendered the whole time and
   * called an `onDismiss` nobody supplied.
   */
  | { type: 'net/clear' }
  /**
   * Reveal a path in the index rail.
   *
   * `RailSlice.selectedPath` and `selectedFunctionId` have existed in the type
   * and in the initial state since the rail was written, with NO reducer arm
   * able to set either. So clicking a card on the board moved nothing in the
   * rail: the two panes that are supposed to drive each other only ever talked
   * in one direction.
   */
  | { type: 'rail/reveal'; path: RepoPath | null }
  /**
   * EXPLAIN THIS NODE — the board asking the rail why a card is there.
   *
   * Clicking a card selected it and grounded the composer on it. It never
   * opened `NodeDetailPanel`, which is the surface that answers the question a
   * person clicks a node to ask: why is this here, and where was each of its
   * edges traced from. The panel was built, tested and reachable only by
   * clicking the same node a second time over in the rail.
   */
  | { type: 'rail/explain'; nodeId: NodeId | null }
  /**
   * Put a stored conversation back on screen.
   *
   * `SessionSlice.hydrating` has existed since the slice was written, with no
   * action able to set it and nothing able to fill the transcript from disk —
   * so a reload showed a blank thread while the conversation sat in
   * `.sequence/sessions/<id>/chat.json`.
   */
  /** Hold a follow-up typed while a turn is streaming. */
  /**
   * Rewrite a question and ask it again, dropping everything after it.
   *
   * `send` appends and never mutates, so a typo in a question was permanent:
   * the only remedy was to ask a corrected question underneath the wrong one
   * and leave both in the thread — and both then went to the model as history,
   * so it saw the mistake as well as the correction.
   */
  | { type: 'turn/edit'; id: TurnId; text: string }
  | { type: 'turn/queue'; text: string }
  /** Take back a queued follow-up before it is sent. */
  | { type: 'turn/unqueue' }
  | { type: 'session/hydrating' }
  | { type: 'session/hydrated'; turns: readonly Turn[] }
  | { type: 'session/canvas-hydrated'; doc: import('./types.js').CanvasDoc }
  | {
      type: 'session/index';
      sessions: SessionSlice['sessions'];
      activeId: SessionSlice['activeId'];
    }
  | { type: 'session/git-branch'; branch: string | null }
  /**
   * B4.2 — Accept/Deny on one file of a live `FileEditProposal`.
   *
   * Review's local reducer owns the pane gesture; this writes the same
   * decision into `session.proposals` so the ledger and a remount see it.
   */
  | {
      type: 'proposal/file-decide';
      proposalId: ProposalId;
      path: RepoPath;
      decision: 'pending' | 'accepted' | 'rejected';
    }
  /**
   * B4.2 — after Apply writes some accepted files, mark them and derive
   * `applied` / `partial` from what actually landed.
   */
  | {
      type: 'proposal/apply-finished';
      proposalId: ProposalId;
      writtenPaths: readonly RepoPath[];
    };

/* ========================================================================== *
 * THE ONE FUNNEL
 * ========================================================================== */

/**
 * EVERY DERIVED FIELD, RECOMPUTED, AFTER EVERY TRANSITION.
 *
 * `composer.send` is a member of the frozen `ComposerSlice`, so it is present
 * in the snapshot every renderer reads — one object, one read, no selector
 * ceremony. What makes it DERIVED rather than STORED is that it is never an
 * input: no action carries it, no branch of `reduce` assigns it, and this
 * function overwrites whatever is there with `deriveSendState`'s answer on the
 * way out. A stored copy that is recomputed unconditionally at the single exit
 * is a projection, not a second source of truth — and `store.test.tsx` asserts
 * exactly that, after every action, against the function rather than against a
 * literal.
 *
 * WHY IT MATTERS, CONCRETELY: `Composer.tsx:126` reads `composer.send ===
 * 'ready'` to decide what the Enter key does. If the button's state and the
 * keyboard's rule were computed in two places, the keyboard would be the thing
 * that found the disagreement, in the hands of a user, mid-sentence.
 *
 * `deriveSendState` is imported from the chat lane's barrel, which exports it
 * for this exact purpose (`chat/index.ts`: "the STORE must derive
 * composer.send, not the component").
 */
function derive(state: AppState): AppState {
  const send = deriveSendState(state.composer.draft, state.session.inFlight);
  if (send === state.composer.send) return state;
  return { ...state, composer: { ...state.composer, send } };
}

/* ========================================================================== *
 * THE STORE
 * ========================================================================== */

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  /** Returns the unsubscribe. Called by `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
}

export interface StoreConfig extends InitialStateInput {
  /**
   * `seqdFromGraph`. The application supplies it (`app/App.tsx`); a test may
   * leave it out to exercise the refusal itself.
   *
   * WHY IT IS STILL OPTIONAL NOW THAT THE APPLICATION ALWAYS PASSES ONE. The
   * `null` arm of `loadRepo` is the guard that keeps an ungrounded document
   * off the canvas, and a guard with no way to reach it is a guard nobody can
   * test. Making this required would delete the arm and with it the proof that
   * the store refuses rather than invents. What stops the application from
   * quietly losing its projector again is not this type — it is
   * `e2e/board-grounded.mjs`, which counts painted nodes in the shipped bundle
   * against a live scan, and which is RED the moment `createStore()` is called
   * bare.
   */
  project?: Projector | null;
  /**
   * A state to start from instead of the empty one. For hydration and for
   * tests. It is normalized through `derive` on the way in, so a persisted
   * snapshot cannot smuggle in a `send` that disagrees with its own draft.
   */
  hydrate?: AppState;
}

export function createStore(config: StoreConfig = {}): Store {
  const tokens = config.tokens ?? DEFAULT_SHELL_TOKENS;
  const project = config.project ?? null;

  let state = derive(config.hydrate ?? createInitialState(config));
  const listeners = new Set<() => void>();

  return {
    getState: () => state,

    dispatch(action) {
      const next = derive(reduce(state, action, { project, tokens }));
      /*
       * IDENTITY, NOT DEEP EQUALITY. Every branch of `reduce` either returns
       * the same object or builds a new one, so identity is the exact question
       * "did anything change". Notifying regardless would re-render three
       * panes on every keystroke that produced no change, and a deep compare
       * would cost more than the render it saves.
       */
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface ReduceDeps {
  project: Projector | null;
  tokens: ShellTokens;
}

/* ========================================================================== *
 * THE REDUCER
 * ========================================================================== */

export function reduce(state: AppState, action: Action, deps: ReduceDeps): AppState {
  switch (action.type) {
    /* ── the composer ──────────────────────────────────────────────────── */

    case 'composer/draft':
      if (action.text === state.composer.draft) return state;
      return { ...state, composer: { ...state.composer, draft: action.text } };

    case 'composer/chip-add': {
      // A chip is a reference to one thing, so the same reference twice is one
      // chip. Sheet 12.4's picker resolves against the graph; the graph has one
      // node per id.
      if (state.composer.chips.some((c) => c.ref === action.chip.ref)) return state;
      return {
        ...state,
        composer: { ...state.composer, chips: [...state.composer.chips, action.chip] },
      };
    }

    case 'composer/mention':
      /* Identity when nothing changes: closing a picker that is already closed
         is what a keystroke outside a token does on every character. */
      if (state.composer.mention === null && action.mention === null) return state;
      return { ...state, composer: { ...state.composer, mention: action.mention } };

    case 'composer/mention-move': {
      const m = state.composer.mention;
      if (m === null || m.results.length === 0) return state;
      const count = m.results.length;
      const next = (((m.activeIndex + action.delta) % count) + count) % count;
      if (next === m.activeIndex) return state;
      return { ...state, composer: { ...state.composer, mention: { ...m, activeIndex: next } } };
    }

    case 'composer/chip-remove': {
      const chips = state.composer.chips.filter((c) => c.id !== action.id);
      if (chips.length === state.composer.chips.length) return state;
      return { ...state, composer: { ...state.composer, chips } };
    }

    case 'composer/attachment-add': {
      /* CONTENT-ADDRESSED, so pasting the same log twice answers the same id.
         Adding it twice would put two identical chips on screen with one
         remove button each that both appear to do nothing. */
      if (state.composer.attachments.some((a) => a.id === action.attachment.id)) return state;
      return {
        ...state,
        composer: {
          ...state.composer,
          attachments: [...state.composer.attachments, action.attachment],
        },
      };
    }

    case 'composer/attachment-remove': {
      const attachments = state.composer.attachments.filter((a) => a.id !== action.id);
      if (attachments.length === state.composer.attachments.length) return state;
      return { ...state, composer: { ...state.composer, attachments } };
    }

    case 'composer/attachments-clear': {
      /* The blob stays on disk - a later turn can name the same id, and the
         store sweeps its own old entries. This clears the COMPOSER only. */
      if (state.composer.attachments.length === 0) return state;
      return { ...state, composer: { ...state.composer, attachments: [] } };
    }

    case 'composer/focus':
      return {
        ...state,
        composer: { ...state.composer, focusNonce: state.composer.focusNonce + 1 },
      };

    case 'composer/toolbelt':
      if (action.open === state.composer.toolbeltOpen) return state;
      return { ...state, composer: { ...state.composer, toolbeltOpen: action.open } };

    case 'composer/teach': {
      if (state.composer.teach === action.on) return state;
      return { ...state, composer: { ...state.composer, teach: action.on } };
    }
    case 'composer/teach-known': {
      /* Clicking the selected card CLEARS it back to "not stated". A one-click
         control the user cannot un-click is a trap: they told us something they
         cannot take back, and the belt would keep skipping material they now
         want. Same value in, null out. */
      const next = state.composer.teachKnown === action.known ? null : action.known;
      if (state.composer.teachKnown === next) return state;
      return { ...state, composer: { ...state.composer, teachKnown: next } };
    }
    case 'composer/permission': {
      /*
       * A MODE THE USER HAS NOT ENABLED IS NOT A MODE. Auto-edit / Full stay
       * gated until Settings turns them on (`composer/permission-enabled`).
       */
      if (!state.composer.permission.enabled.includes(action.mode)) return state;
      if (action.mode === state.composer.permission.mode) return state;
      return {
        ...state,
        composer: {
          ...state.composer,
          permission: { ...state.composer.permission, mode: action.mode },
        },
      };
    }

    case 'composer/permission-enabled': {
      const enabled = action.enabled.includes('propose')
        ? action.enabled
        : (['propose', ...action.enabled] as PermissionMode[]);
      const unique = [...new Set(enabled)];
      const mode = unique.includes(state.composer.permission.mode)
        ? state.composer.permission.mode
        : 'propose';
      return {
        ...state,
        composer: {
          ...state.composer,
          permission: { mode, enabled: unique },
        },
      };
    }

    case 'composer/model':
      return { ...state, composer: { ...state.composer, model: action.model } };

    /* How big the configured model's window is, when the provider will say.
       NULL IS A REAL ANSWER here - it means "we asked and were not told", and
       the transcript draws nothing rather than a default (CANON law 4). */
    case 'composer/context-window':
      return { ...state, composer: { ...state.composer, contextWindow: action.tokens } };

    case 'composer/ask-surface': {
      const prev = state.composer.askSurface;
      const next = action.surface;
      if (prev === next) return state;
      if (
        prev &&
        next &&
        prev.id === next.id &&
        prev.title === next.title &&
        prev.focus === next.focus
      ) {
        return state;
      }
      return { ...state, composer: { ...state.composer, askSurface: next } };
    }

    /* ── the thread ────────────────────────────────────────────────────── */

    case 'turn/send':
      return send(state, action.at, action.memoryTrim ?? null);

    case 'turn/event':
      return streamEvent(state, action.event, action.at);

    case 'turn/stopping': {
      /*
       * The user asked. Whether the ASK can actually be aborted is
       * `inFlight.abortable` — true on ask routes where Stop reaches the server
       * provider signal and tool loop (G3).
       */
      const inFlight = state.session.inFlight;
      if (inFlight === null || isSettled(inFlight.phase)) return state;
      return withInFlight(state, { ...inFlight, phase: 'stopping' });
    }

    case 'turn/stopped':
      return commit(state, action.at, { kind: 'stopped', at: action.at });

    case 'topology/clear': {
      if (state.session.topology === null) return state;
      return {
        ...state,
        session: { ...state.session, topology: null },
      };
    }

    /* ── the repo ──────────────────────────────────────────────────────── */

    case 'repo/scanning': {
      // A rescan keeps the old graph on screen: `RepoScanning.previous` exists
      // so the canvas does not blank out for the duration of a scan.
      const previous =
        state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo : null;
      return {
        ...state,
        repo: {
          phase: 'scanning',
          root: action.root,
          repoName: action.repoName,
          startedAt: action.at,
          progress: null,
          previous,
        },
      };
    }

    case 'repo/scan-progress': {
      if (state.repo.phase !== 'scanning') return state;
      return {
        ...state,
        repo: { ...state.repo, progress: action.progress },
      };
    }

    case 'repo/loaded':
      return loadRepo(state, action.draft, action.at, deps.project);

    case 'repo/detached': {
      /*
       * LEAVING A REPOSITORY. Reported as a trap: "how do I exit the project?
       * That's a very simple one." It was not simple, because there was no way
       * out at all - a new session opened in the same repo, and POST /api/detach
       * had been sitting on the server, tested and uncalled, since it was written.
       *
       * The DOCUMENT and the BOARD go with it. Leaving a repository while its
       * graph stayed on screen would be the same lie the stale-client defect told
       * this morning, in the other direction: a board describing a repo the
       * engine is no longer attached to.
       *
       * Seat-walk: chat must reopen — a remembered `chatOpen: false` must not
       * leave the OpenCode boot as a blank frame with no conversation surface.
       */
      const cleared: AppState = {
        ...state,
        repo: { phase: 'unattached' },
        canvas: createInitialState().canvas,
        session: createInitialState().session,
      };
      return withShell(cleared, deps.tokens, (shell) =>
        withPaneOpen(shell, 'chat', true, deps.tokens),
      );
    }

    case 'repo/stale': {
      /*
       * ONLY FROM ATTACHED OR STALE. `RepoStale` carries a `ScannedRepo`, so
       * there is no honest stale state without one — minting an empty repo to
       * hang the phase on would be the store describing a scan that never
       * happened.
       *
       * The scanned repo comes across by REFERENCE. The board, the rail, the
       * shell and the app all branch on `attached || stale` and keep painting;
       * dropping the graph here would blank the board on every accepted edit,
       * which is a worse answer than a stale one.
       */
      if (state.repo.phase !== 'attached' && state.repo.phase !== 'stale') return state;
      return {
        ...state,
        repo: {
          phase: 'stale',
          repo: state.repo.repo,
          since: action.at,
          reason: action.reason,
          changedPaths: action.changedPaths,
        },
      };
    }

    case 'repo/failed':
      return {
        ...state,
        repo: { phase: 'failed', attempted: action.attempted, failure: action.failure },
      };

    case 'boot/settled':
      return bootSettled(state, action.outcome, deps.project, deps.tokens);

    /* ── the shell and the wire ────────────────────────────────────────── */

    case 'shell/frame': {
      /*
       * A FRAME THAT DID NOT MOVE IS NOT A TRANSITION.
       *
       * `withFrame` re-assembles unconditionally, so it returns a fresh object
       * for an identical measurement — and `dispatch` treats a fresh object as
       * a change and notifies every subscriber. `Shell.tsx` measures the window
       * once on mount as well as on every `resize`, so without this the mount
       * measurement would re-render the shell, which would measure again. The
       * ref in `Shell.tsx` closes the same loop from the other side; this is
       * the half that belongs to the store, and it is right on its own terms:
       * identity here means "did anything change", and nothing did.
       */
      const { frame } = state.shell;
      if (frame.width === action.frame.width && frame.height === action.frame.height) return state;
      return withShell(state, deps.tokens, (shell) => withFrame(shell, action.frame, deps.tokens));
    }

    case 'shell/theme':
      return withShell(state, deps.tokens, (shell) => withTheme(shell, action.theme));

    case 'shell/overlay':
      return withShell(state, deps.tokens, (shell) => withOverlay(shell, action.overlay));

    case 'shell/pane-toggle':
      return withShell(state, deps.tokens, (shell) =>
        withPaneToggled(shell, action.pane, deps.tokens),
      );

    case 'shell/pane-width':
      return withShell(state, deps.tokens, (shell) =>
        withPaneWidth(shell, action.pane, action.width, deps.tokens),
      );

    case 'shell/pane-reset':
      return withShell(state, deps.tokens, (shell) => resetPaneWidths(shell, deps.tokens));

    case 'shell/dragging':
      return withShell(state, deps.tokens, (shell) => withDragging(shell, action.dragging));

    case 'net/failed':
      return { ...state, net: { ...state.net, lastFailure: action.failure } };

    case 'turn/edit': {
      const text = action.text.trim();
      if (text === '') return state;
      /* Never mid-stream. Rewriting the question a turn is currently answering
         would leave an answer on screen to a question that is no longer
         there. */
      if (state.session.inFlight !== null) return state;

      const index = state.session.turns.findIndex((t) => t.id === action.id);
      if (index === -1) return state;
      const turn = state.session.turns[index]!;
      if (turn.role !== 'user') return state;
      if (turn.text === text) return state;

      /*
       * EVERYTHING AFTER IT GOES. The answers below a rewritten question were
       * answers to the OLD question — keeping them would leave a thread where
       * the replies do not follow from what is above them, and every one of
       * them would be sent to the model as history for the new ask.
       */
      return {
        ...state,
        session: {
          ...state.session,
          turns: state.session.turns.slice(0, index),
          queued: null,
        },
        /* Put the words back in the composer. The caller sends them, which
           keeps this reducer free of transport exactly like `send`. */
        composer: { ...state.composer, draft: text },
      };
    }

    case 'turn/queue': {
      const text = action.text.trim();
      /* Only while something is actually running. Queueing when the composer
         could simply send is a second path to the same act, and the two would
         disagree the first time either changed. */
      if (text === '' || state.session.inFlight === null) return state;
      return {
        ...state,
        session: { ...state.session, queued: text },
        /* The draft is cleared, because the words moved — leaving them in the
           field would show the same question twice and invite a second send. */
        composer: { ...state.composer, draft: '' },
      };
    }

    case 'turn/unqueue':
      return state.session.queued === null
        ? state
        : { ...state, session: { ...state.session, queued: null } };

    case 'session/hydrating':
      return { ...state, session: { ...state.session, hydrating: true } };

    case 'session/hydrated': {
      /*
       * REFUSES TO OVERWRITE A LIVE THREAD. If the reader has already asked
       * something while the fetch was in flight, the answer that arrives from
       * disk is older than what is on screen, and replacing it would delete a
       * question they just watched being answered.
       */
      if (state.session.turns.length > 0) {
        return { ...state, session: { ...state.session, hydrating: false } };
      }
      return {
        ...state,
        session: { ...state.session, hydrating: false, turns: [...action.turns] },
      };
    }

    case 'session/canvas-hydrated': {
      if (state.session.inFlight !== null) return state;
      /* "Already has content" means blocks OR charts. Testing blocks alone let a
         doc holding a live chart be replaced by one loaded from disk. */
      if (
        state.session.canvasDoc.blocks.length > 0 ||
        (state.session.canvasDoc.charts?.length ?? 0) > 0
      ) {
        return state;
      }
      return {
        ...state,
        session: { ...state.session, canvasDoc: action.doc },
      };
    }

    case 'session/index': {
      const prev = state.session;
      if (prev.activeId === action.activeId && prev.sessions === action.sessions) return state;
      const sameList =
        prev.sessions.length === action.sessions.length &&
        prev.sessions.every((entry, i) => entry.id === action.sessions[i]?.id);
      if (prev.activeId === action.activeId && sameList) return state;
      return {
        ...state,
        session: {
          ...prev,
          sessions: [...action.sessions],
          activeId: action.activeId,
        },
      };
    }

    case 'session/git-branch':
      return state.session.git.branch === action.branch
        ? state
        : {
            ...state,
            session: {
              ...state.session,
              git: { ...state.session.git, branch: action.branch },
            },
          };

    case 'proposal/file-decide': {
      const existing = state.session.proposals[action.proposalId];
      if (!existing) return state;
      const fileIdx = existing.files.findIndex((f) => f.path === action.path);
      if (fileIdx < 0) return state;
      const prev = existing.files[fileIdx]!;
      if (prev.decision === action.decision) return state;
      const files = existing.files.slice();
      files[fileIdx] = { ...prev, decision: action.decision };
      const status = deriveProposalStatusFromFiles(files, existing.status);
      return {
        ...state,
        session: {
          ...state.session,
          proposals: {
            ...state.session.proposals,
            [action.proposalId]: { ...existing, files, status },
          },
        },
      };
    }

    case 'proposal/apply-finished': {
      const existing = state.session.proposals[action.proposalId];
      if (!existing) return state;
      const written = new Set(action.writtenPaths);
      if (written.size === 0) return state;
      const files = existing.files.map((f) =>
        written.has(f.path) ? { ...f, decision: 'accepted' as const } : f,
      );
      const status = deriveProposalStatusAfterApply(files, written);
      return {
        ...state,
        session: {
          ...state.session,
          proposals: {
            ...state.session.proposals,
            [action.proposalId]: { ...existing, files, status },
          },
        },
      };
    }

    case 'rail/explain': {
      if (state.rail.selectedNodeId === action.nodeId) return state;
      return { ...state, rail: { ...state.rail, selectedNodeId: action.nodeId } };
    }

    case 'rail/reveal': {
      if (state.rail.selectedPath === action.path) return state;
      return {
        ...state,
        rail: {
          ...state.rail,
          selectedPath: action.path,
          /* Revealing a FILE clears any function selection under it: the two
             are different grains of the same answer, and leaving a stale
             function lit under a newly revealed file would point at something
             the reader did not choose. */
          selectedFunctionId: null,
          /* Opened, so the row it reveals is actually on screen rather than
             collapsed inside its file. */
          expanded:
            action.path && !state.rail.expanded.includes(action.path)
              ? [...state.rail.expanded, action.path]
              : state.rail.expanded,
        },
      };
    }

    case 'net/clear':
      /* Identity when there is nothing to clear, so a stray dismiss does not
         churn every subscriber for no reason. */
      return state.net.lastFailure === null
        ? state
        : { ...state, net: { ...state.net, lastFailure: null } };

    case 'trust/loaded':
      return {
        ...state,
        trust: {
          root: action.root,
          trusted: action.trusted,
          instructions: action.instructions,
          /* The disclosure closes on a fresh answer. Leaving it open after the
             user trusted the repo would leave the question on screen next to
             its own answer. */
          reviewing: false,
        },
      };

    case 'trust/review':
      return { ...state, trust: { ...state.trust, reviewing: action.open } };
  }
}

/* ========================================================================== *
 * THE SHELL BRIDGE
 * ========================================================================== */

/**
 * THE RECONSTRUCTION IS GONE. THIS IS NOW A CALL, NOT A BRIDGE.
 *
 * What stood here rebuilt two facts the slice did not carry before handing the
 * state to the shell's reducers — `intent` as `{chat: chat.open, rail:
 * rail.open}` and `priority` as the literal `'chat'` — and said so in its own
 * comment: "this reconstruction is exact only for the three actions the store
 * currently accepts, none of which changes a pane", and "THIS BRIDGE IS DELETED
 * when `Shell.tsx` becomes controlled".
 *
 * `Shell.tsx` is controlled and the pane actions have landed, so both guesses
 * would now be wrong at the moment they matter most: toggling the rail open as
 * an OVERLAY at 900px would be recorded as a decision about the wide column,
 * and every rail drag would lose its priority to the chat on the next action.
 * Both facts are members of `ShellSlice` now, so there is nothing left to
 * infer — the slice IS the shell's state.
 *
 * `layout` is still computed rather than stored, by the shell's own
 * `layoutOf`, so there remains no second arithmetic for canvas width anywhere
 * in the product; it is built for the reducer and dropped again on the way out.
 */
function withShell(
  state: AppState,
  tokens: ShellTokens,
  step: (shell: ShellState) => ShellState,
): AppState {
  const before = state.shell;
  const next = step(layoutOf(before, tokens)).shell;
  if (next === before) return state;
  return { ...state, shell: next };
}

/* ========================================================================== *
 * SENDING, STREAMING, COMMITTING
 * ========================================================================== */

const settled = new Set(['done', 'error']);
const isSettled = (phase: InFlightTurn['phase']) => settled.has(phase);

/**
 * STEP IDS THAT ARE A FACT ABOUT THE TURN, NOT PIPELINE BOOKKEEPING.
 *
 * `step:start` normally lands "Worked a step · <slug>", which is fine for
 * `intents` / `file-research` because nobody is meant to read them. `teach-mode`
 * is different: it is the turn telling the user it treated their question as a
 * lesson when they never touched the Teach control (askPipeline's
 * TEACH_MODE_STEP_ID — owner's screen, 2026-09-02, where the mode engaged
 * invisibly and the answer interrogated him about chart formats). A mode the
 * user did not choose has to be legible, so this row gets English and drops the
 * slug rather than printing a machine name at a learner.
 *
 * `announce` is what keeps it legible. English alone was not enough: the row
 * settles immediately (step:start and step:done arrive back to back), and every
 * settled reason row was rendered inside the "Reasoning" disclosure, which
 * starts closed. The announcement existed in the store and appeared on screen
 * only if the user happened to open an unrelated-sounding fold.
 */
const NAMED_STEP_ROW: Record<string, { verb: string; announce: true }> = {
  /*
   * THE VERB NAMES THE MODE, NOT AN OUTCOME — the same rule the `auto-approve`
   * entry below states, applied to the row above it.
   *
   * It read "Taught this as a lesson", which asserts that a lesson happened.
   * The row is emitted whenever the teach contract is engaged, INCLUDING on a
   * turn that taught nothing — the pipeline engages it on the question alone —
   * so on those turns the surface was claiming an outcome the engine never
   * supplied. That is CANON's own defect, and the entry below names it in the
   * same words for approvals: "a verb claiming approvals that did not happen
   * would be the surface asserting something the engine never supplied."
   *
   * The step event carries two claims and only one of them could be false.
   * "This turn ran in teach mode" is TRUE on every emission and must stay
   * visible — an invisible mode switch is the thing this row exists to prevent.
   * "A lesson was taught" is the false half, and it lived in the verb, which is
   * why the fix is one string and needs no new data: a verb about the mode
   * needs nothing but the mode.
   *
   * Measured by the teach lane before this changed: gating the ROW on a
   * fabrication signal would have refused 12 of 13 real lessons, and gating on
   * concept-absence still scores 4 of 13 — because both gate the announcement,
   * which is the true half. Correcting the verb removes the false claim without
   * suppressing the true one.
   */
  'teach-mode': { verb: 'Ran in Teach mode', announce: true },
  /*
   * `auto-approve` is the SAME rule as the row above, for the same reason. The
   * unattended autonomy mode converts an `ask` verdict into `allow` for the
   * session (analyzer `server/autoApprove.ts`, AUTO_APPROVE_STEP_ID), so a turn
   * under it can run tools the user would otherwise have been asked about —
   * and they did not choose that for THIS turn. It must not act invisibly, so
   * it announces itself in English, out of the closed Reasoning disclosure.
   *
   * The verb describes the MODE, not a count. The row is emitted whenever the
   * mode is active, including on a turn where nothing needed converting, and a
   * verb claiming approvals that did not happen would be the surface asserting
   * something the engine never supplied.
   */
  'auto-approve': { verb: 'Ran unattended — auto-approve is on', announce: true },
};

/**
 * Mint an id that no turn in this thread already carries.
 *
 * Not a counter and not a random string: a counter is state living outside the
 * store, and a random id makes two runs of the same test produce two different
 * transcripts. Hydrated turns carry SERVER ids, which is why this checks the
 * list rather than trusting its length.
 */
function mint(turns: Turn[], prefix: string): TurnId {
  let n = turns.length + 1;
  const taken = new Set(turns.map((t) => t.id));
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/**
 * THE SEND GUARD LIVES HERE, NOT IN THE BUTTON.
 *
 * `deriveSendState` is asked again at the moment of the send, against the state
 * as it is now. The composer asks it too — through `composer.send`, which this
 * store derived — but the composer is a renderer and a renderer can be a frame
 * behind. This is the check that decides, and it is the same function, so the
 * two cannot disagree about the answer even when they disagree about the
 * moment.
 */
function send(
  state: AppState,
  at: number,
  memoryTrim: { droppedTurns: number } | null = null,
): AppState {
  if (deriveSendState(state.composer.draft, state.session.inFlight) !== 'ready') return state;

  const userId = mint(state.session.turns, 'u');
  const assistantId = mint([...state.session.turns, { id: userId } as Turn], 'a');

  const turn: UserTurn = {
    id: userId,
    role: 'user',
    text: state.composer.draft,
    /*
     * `intents` and `contextLines` are EMPTY and that is a fact, not a stub.
     * Nothing in web2 compiles a grounded scope yet — the `@` picker resolves
     * against a graph the store cannot yet paint, and intent parsing is the
     * ask pipeline's. Recording a guess as "the compiled scope, as sent" would
     * make a replayed turn replay something that was never sent.
     */
    intents: [],
    chips: state.composer.chips,
    contextLines: [],
    surface: state.composer.askSurface,
    memoryTrim:
      memoryTrim && memoryTrim.droppedTurns > 0
        ? { droppedTurns: Math.floor(memoryTrim.droppedTurns) }
        : null,
    at,
  };

  const unattached = state.repo.phase !== 'attached' && state.repo.phase !== 'stale';

  const inFlight: InFlightTurn = {
    turnId: assistantId,
    replyTo: userId,
    runId: null,
    phase: 'queued',
    startedAt: at,
    firstTokenAt: null,
    text: '',
    work: [],
    evidence: { tools: [], filesRead: [], proposals: [] },
    usage: null,
    providerRound: 0,
    roundCap: resolveAskRoundCap({
      question: state.composer.draft,
      designMode: unattached,
    }),
    lastActivityAt: at,
    /*
     * TRUE — G3 wired. Client Stop aborts the browser fetch; the server's
     * `requestAbort` hands the same signal to the provider `fetch` and the ask
     * pipeline tool loop; `raceAbort` in the metered wrapper ensures an aborted
     * turn is not charged before `recordUse`.
     */
    abortable: true,
  };

  return {
    ...state,
    session: { ...state.session, turns: [...state.session.turns, turn], inFlight, topology: null },
    composer: { ...state.composer, draft: '', chips: [] },
  };
}

function withInFlight(state: AppState, inFlight: InFlightTurn | null): AppState {
  return { ...state, session: { ...state.session, inFlight } };
}

/**
 * Land the live blocks at the end of a turn — and KEEP THE REST OF THE DOC.
 *
 * This returned a fresh `{ blocks }`, so every other field of the canvas doc
 * was destroyed when a turn ended: `charts`, `storyRoute`, `teachStep`. Its
 * neighbour `withoutPendingCanvasBlocks` spreads `...doc` and always did; this
 * one did not, and a function named for what it does to BLOCKS quietly decided
 * what happened to everything else.
 *
 * MEASURED ON THE REAL PRODUCT: a teach turn proposed a derived chart,
 * `chat.json` recorded the work row, and opening the AI Canvas seconds later —
 * same browser session, no reload — showed the empty placeholder. The chart was
 * on screen DURING the turn and gone the instant it landed, which also left
 * persistence nothing to write and made the surface look broken rather than
 * empty.
 *
 * Spreading `...doc` is the whole fix, and the reason it is worth a comment is
 * that the bug is invisible at the call site: `canvasDoc: landCanvasBlocks(doc)`
 * reads like it only touches blocks.
 */
function landCanvasBlocks(doc: import('./types.js').CanvasDoc): import('./types.js').CanvasDoc {
  return {
    ...doc,
    blocks: doc.blocks
      .filter((b) => b.status !== 'pending')
      .map((b) => (b.status === 'live' ? { ...b, status: 'landed' as const } : b)),
  };
}

function withoutPendingCanvasBlocks(doc: import('./types.js').CanvasDoc): import('./types.js').CanvasDoc {
  return {
    ...doc,
    blocks: doc.blocks.filter((b) => b.status !== 'pending'),
  };
}

function applyCanvasBlock(
  state: AppState,
  event: Extract<AskEvent, { type: 'canvas:block' }>,
  inFlight: InFlightTurn,
): AppState {
  const landed = landCanvasBlocks(withoutPendingCanvasBlocks(state.session.canvasDoc));
  const block = {
    id: event.id,
    type: event.blockType,
    ...(event.title ? { title: event.title } : {}),
    payload: event.payload,
    status: event.status,
  };
  return {
    ...state,
    session: {
      ...state.session,
      canvasDoc: { ...state.session.canvasDoc, blocks: [...landed.blocks, block] },
      inFlight: {
        ...inFlight,
        work: [
          ...inFlight.work,
          {
            id: `canvas:${event.id}`,
            group: 'change',
            verb: `Wrote ${event.blockType} block`,
            identifier: event.title ?? null,
            outcome: null,
            provenance: null,
            status: 'done',
            from: 'canvas:block',
            opens: 'ai-canvas',
          },
        ],
      },
    },
  };
}

/**
 * Fold one stream frame into the in-flight turn.
 *
 * The sixteen wire variants plus the `delta` item 1.2 adds. EVERY ONE IS
 * HANDLED — MLH's rule at `transcript.ts:196-203` is that an unrecognised event
 * renders as a named row and never vanishes, and the defect it records is a
 * `thread.created` frame that nothing had a row for, so the first line of every
 * conversation in the product read as a complaint. Here the equivalent
 * guarantee is structural: the switch is exhaustive over `AskEvent`, so a
 * variant added to the wire type fails the build rather than being dropped by a
 * default branch.
 */
function streamEvent(state: AppState, event: AskEvent, at: number): AppState {
  return touchAskActivity(streamEventCore(state, event, at), event, at);
}

function touchAskActivity(state: AppState, event: AskEvent, at: number): AppState {
  if (event.type === 'result' || event.type === 'error') return state;
  if (!isAskProgressEvent(event.type)) return state;
  const live = state.session.inFlight;
  if (!live) return state;
  const patch: Partial<InFlightTurn> = { lastActivityAt: at };
  if (event.type === 'provider:start') {
    patch.providerRound = live.providerRound + 1;
  }
  return withInFlight(state, { ...live, ...patch });
}

function streamEventCore(state: AppState, event: AskEvent, at: number): AppState {
  const inFlight = state.session.inFlight;
  if (inFlight === null || isSettled(inFlight.phase)) return state;

  switch (event.type) {
    case 'result':
      return commit(
        {
          ...state,
          session: {
            ...state.session,
            inFlight: {
              ...inFlight,
              /* The whole answer arrives here today — there is no delta variant
                 on the wire yet, so this REPLACES rather than appends. When 1.2
                 lands, `result.text` is still the authoritative whole and this
                 line does not change. */
              text: stripToolProse(event.text).stripped,
              streamRaw: undefined,
              usage: event.usage ?? inFlight.usage,
            },
          },
        },
        at,
        null,
        event,
      );

    case 'error':
      return commit(state, at, {
        kind: 'error',
        message: event.error,
        providerResponse: event.providerResponse ?? null,
        status: event.httpStatus ?? null,
        /* Straight through from the server, which is the only layer that knows
           whether this failure has a route out. */
        fix: event.fix ?? null,
      });

    case 'delta': {
      const raw = (inFlight.streamRaw ?? '') + event.text;
      const { stripped } = stripToolProse(raw, { trimEnd: false });
      return withInFlight(state, {
        ...inFlight,
        phase: 'streaming',
        firstTokenAt: inFlight.firstTokenAt ?? at,
        streamRaw: raw,
        text: stripped,
      });
    }

    case 'usage':
      return withInFlight(state, {
        ...inFlight,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          estimated: event.estimated,
        },
      });

    case 'trajectory:start':
      return withInFlight(state, { ...inFlight, runId: event.runId, phase: 'streaming' });

    case 'file:read':
      return withInFlight(state, {
        ...inFlight,
        phase: 'streaming',
        work: openRow(inFlight.work, `file:${event.path}`, {
          group: 'read',
          verb: 'Read a file',
          identifier: event.path,
          provenance: 'measured',
          from: 'file:read',
          opens: 'rail',
        }),
        evidence: {
          ...inFlight.evidence,
          filesRead: inFlight.evidence.filesRead.includes(event.path)
            ? inFlight.evidence.filesRead
            : [...inFlight.evidence.filesRead, event.path],
        },
      });

    case 'file:done':
      return withInFlight(state, {
        ...inFlight,
        work: closeRow(inFlight.work, `file:${event.path}`),
      });

    case 'tool:start': {
      const canvasType =
        event.name !== undefined ? canvasBlockTypeFromToolName(event.name) : null;
      const canvasDoc =
        canvasType === null
          ? state.session.canvasDoc
          : {
              ...state.session.canvasDoc,
              blocks: [
                ...withoutPendingCanvasBlocks(state.session.canvasDoc).blocks,
                {
                  id: `pending:${event.id}`,
                  type: canvasType,
                  payload: '',
                  status: 'pending' as const,
                },
              ],
            };
      return withInFlight(
        canvasType === null ? state : { ...state, session: { ...state.session, canvasDoc } },
        {
          ...inFlight,
          phase: 'streaming',
          work: openRow(inFlight.work, `tool:${event.id}`, {
            group: 'read',
            /* The tool's own name, or nothing. "Called a tool" says less than a
               name would and does not pretend to know which. */
            verb: event.name === undefined ? 'Called a tool' : `Called ${event.name}`,
            identifier: event.evidence ?? null,
            provenance: event.evidence === undefined ? null : 'measured',
            from: 'tool:start',
            opens:
              canvasType !== null
                ? 'ai-canvas'
                : event.name === 'fetch_url'
                  ? 'browser'
                  : null,
          }),
        },
      );
    }

    case 'tool:done': {
      const pendingId = `pending:${event.id}`;
      const trimmedBlocks = state.session.canvasDoc.blocks.filter((b) => b.id !== pendingId);
      const nextState =
        trimmedBlocks.length === state.session.canvasDoc.blocks.length
          ? state
          : {
              ...state,
              session: {
                ...state.session,
                canvasDoc: { ...state.session.canvasDoc, blocks: trimmedBlocks },
              },
            };
      return withInFlight(nextState, {
        ...inFlight,
        work: closeRow(inFlight.work, `tool:${event.id}`, {
          identifier: event.evidence ?? null,
          provenance: event.evidence === undefined ? null : 'measured',
        }),
      });
    }

    case 'intent:start':
      return withInFlight(state, {
        ...inFlight,
        phase: 'streaming',
        work: openRow(inFlight.work, `intent:${event.id}`, {
          group: 'reason',
          verb: 'Worked an intent',
          identifier: event.id,
          provenance: null,
          from: 'intent:start',
          opens: null,
        }),
      });

    case 'intent:done':
      return withInFlight(state, {
        ...inFlight,
        work: closeRow(inFlight.work, `intent:${event.id}`),
      });

    case 'step:start': {
      /* `provider` is bookkeeping around provider:start — opening a row for it
         used to paint "Thinking provider…" beside the real Reasoning line. */
      if (event.id === 'provider') {
        return withInFlight(state, { ...inFlight, phase: 'streaming' });
      }
      const named = NAMED_STEP_ROW[event.id];
      return withInFlight(state, {
        ...inFlight,
        phase: 'streaming',
        work: openRow(inFlight.work, `step:${event.id}`, {
          group: 'reason',
          verb: named?.verb ?? 'Worked a step',
          identifier: named ? null : event.id,
          provenance: null,
          from: 'step:start',
          opens: null,
          ...(named?.announce === true ? { announce: true as const } : {}),
        }),
      });
    }

    case 'step:done':
      if (event.id === 'provider') return state;
      return withInFlight(state, { ...inFlight, work: closeRow(inFlight.work, `step:${event.id}`) });

    case 'provider:start':
      return withInFlight(state, {
        ...inFlight,
        phase: 'streaming',
        work: openRow(inFlight.work, 'provider', {
          group: 'reason',
          verb: 'Reasoned',
          identifier: null,
          provenance: null,
          from: 'provider:start',
          opens: null,
        }),
      });

    case 'provider:done':
      return withInFlight(state, { ...inFlight, work: closeRow(inFlight.work, 'provider') });

    case 'advisor':
      return withInFlight(state, {
        ...inFlight,
        work: [
          ...inFlight.work,
          {
            id: `advisor:${inFlight.work.length}`,
            group: 'reason',
            verb: 'Flagged a concern',
            identifier: null,
            outcome: { kind: 'note', text: event.note },
            provenance: null,
            status: 'done',
            from: 'advisor',
            opens: null,
          },
        ],
      });

    case 'command:log':
      return withInFlight(state, {
        ...inFlight,
        work: [
          ...inFlight.work,
          {
            id: `command:${inFlight.work.length}`,
            group: 'run',
            verb: 'Ran a command',
            identifier: event.cmd,
            outcome: {
              kind: 'exit',
              code: event.exitCode,
              ...(typeof event.output === 'string' && event.output.length > 0
                ? { output: event.output }
                : {}),
            },
            provenance: 'measured',
            status: event.ok ? 'done' : 'error',
            from: 'command:log',
            opens: 'terminal',
          },
        ],
      });

    case 'topology:proposal': {
      /*
       * THE KEYSTONE ARM. Everything downstream of here already existed and
       * could not be reached: `canvasReduce`'s `canvas/proposal` case, the
       * dashed rendering, the Accept path through `docEdit`, the Deny that
       * drops the layer.
       */
      const nth = inFlight.work.filter((w) => w.from === 'topology:proposal').length + 1;
      const id: ProposalId = `${inFlight.turnId}:t${nth}`;
      const topology: TopologyProposal = {
        id,
        turnId: inFlight.turnId,
        title: event.title ?? null,
        rationale: event.rationale ?? null,
        nodes: event.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind as TopologyProposal['nodes'][number]['kind'],
        })),
        edges: event.edges.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          family: e.family as TopologyProposal['edges'][number]['family'],
          ...(e.label ? { label: e.label } : {}),
        })),
        status: 'pending',
        verify: null,
      };

      return {
        ...state,
        session: {
          ...state.session,
          topology,
          inFlight: {
            ...inFlight,
            work: [
              ...inFlight.work,
              {
                id: `topology:${id}`,
                group: 'change',
                verb: 'Proposed architecture',
                identifier: event.title ?? null,
                outcome: { kind: 'count', n: event.nodes.length, unit: 'nodes' },
                provenance: null,
                status: 'done',
                from: 'topology:proposal',
                opens: 'canvas',
              },
            ],
          },
        },
      };
    }

    case 'chart:proposal':
      /*
       * A drawn chart lands on the canvas doc and opens a work row. The spec is
       * already validated server-side (every nodeId real), so the client stores
       * it verbatim and `packages/web2/src/charts/SeqChartView` renders it.
       */
      return {
        ...state,
        session: {
          ...state.session,
          canvasDoc: {
            ...state.session.canvasDoc,
            charts: [...(state.session.canvasDoc.charts ?? []), event.chart],
          },
          inFlight: {
            ...inFlight,
            work: [
              ...inFlight.work,
              {
                id: `chart:${inFlight.turnId}:${(state.session.canvasDoc.charts ?? []).length + 1}`,
                group: 'change',
                verb: 'Drew a chart',
                identifier: null,
                outcome: null,
                provenance: null,
                status: 'done',
                from: 'chart:proposal',
                /* AI CANVAS, NOT THE ARCHITECTURE BOARD. This row said
                   `'canvas'`, which Transcript routes to the Architecture
                   board — a surface that has never rendered a chart. A learner
                   clicking "Drew a chart" arrived at the wrong picture. The
                   `canvas:block` rows next door have always opened
                   `'ai-canvas'`, which is where charts actually paint. */
                opens: 'ai-canvas',
              },
            ],
          },
        },
      };

    case 'canvas:block':
      return applyCanvasBlock(state, event, inFlight);

    case 'canvas:story':
      return {
        ...state,
        session: {
          ...state.session,
          canvasDoc: {
            ...state.session.canvasDoc,
            storyRoute: { title: event.title, steps: event.steps },
          },
        },
      };

    case 'teach:step':
      /*
       * One field, replaced wholesale, exactly as `canvas:story` above — and NO
       * new work row. The chart this step rides already added "Drew a chart";
       * a second row saying the same thing in other words is the owner's
       * standing dislike ("a row that repeats its own name"). The board reads
       * this and resolves the lit set against what it draws.
       */
      return {
        ...state,
        session: {
          ...state.session,
          canvasDoc: {
            ...state.session.canvasDoc,
            teachStep: {
              caption: event.caption,
              ...(event.litNodeIds ? { litNodeIds: [...event.litNodeIds] } : {}),
            },
          },
        },
      };

    case 'lookup:located':
      /*
       * ON `session`, NOT ON `session.canvasDoc` — the one decision in this
       * case that is not mechanical. `canvasDoc` is what the session AUTHORED
       * and keeps; a lookup result is a pointer that was true for one question.
       * Persisted, it would relight a stale answer on next open with nothing on
       * screen to explain why that part of the board is lit.
       *
       * And NO work row. The tool call already drew its own; a second row
       * saying the same thing in other words is the owner's standing dislike,
       * "a row that repeats its own name" — the same reason `teach:step` adds
       * none above.
       */
      return {
        ...state,
        session: { ...state.session, lookupLocated: [...event.nodeIds] },
      };

    case 'edit:proposal': {
      const id: ProposalId = `${inFlight.turnId}:p${inFlight.evidence.proposals.length + 1}`;
      const applied = event.applied === true;
      const proposal: FileEditProposal = {
        id,
        turnId: inFlight.turnId,
        title: event.title ?? null,
        /* WHY, from the model. Null draws nothing rather than an empty row. */
        rationale: event.rationale ?? null,
        files: event.files.map((f) => ({
          path: f.path,
          content: f.content,
          decision: applied ? 'accepted' : 'pending',
          /* The unified diff is fetched against what is on disk. Nothing here
             has read the disk, so there is no diff and `null` says so. */
          diff: null,
          comments: [],
        })),
        status: applied ? 'applied' : 'pending',
        verify: null,
      };

      return {
        ...state,
        session: {
          ...state.session,
          proposals: { ...state.session.proposals, [id]: proposal },
          inFlight: {
            ...inFlight,
            evidence: {
              ...inFlight.evidence,
              proposals: [...inFlight.evidence.proposals, id],
            },
            work: [
              ...inFlight.work,
              {
                id: `proposal:${id}`,
                group: 'change',
                verb: applied ? 'Wrote edits' : 'Proposed edits',
                identifier: event.title ?? null,
                outcome: { kind: 'count', n: event.files.length, unit: 'files' },
                provenance: null,
                status: 'done',
                from: 'edit:proposal',
                opens: 'review',
              },
            ],
          },
        },
      };
    }
  }
}

/** One row's fields, minus the two the opener and closer own. */
type RowSpec = Omit<WorkRow, 'id' | 'status' | 'outcome'> & { group: WorkGroup };

/**
 * Open a row, or leave the existing one alone.
 *
 * The verb is written ONCE, in the past tense, when the row is created —
 * types.ts on `WorkRow`: a row that says "Searching the repo…" has to be
 * rewritten a second later, and a transcript that rewrites itself is not a
 * record of anything. `status: 'running'` exists for the pulse, not for a
 * present-tense verb.
 */
function openRow(rows: WorkRow[], id: string, spec: RowSpec): WorkRow[] {
  if (rows.some((r) => r.id === id)) return rows;
  return [...rows, { id, status: 'running', outcome: null, ...spec }];
}

function closeRow(rows: WorkRow[], id: string, patch: Partial<WorkRow> = {}): WorkRow[] {
  let touched = false;
  const next = rows.map((row) => {
    if (row.id !== id || row.status !== 'running') return row;
    touched = true;
    return { ...row, ...patch, status: 'done' as const };
  });
  return touched ? next : rows;
}

/**
 * COMMIT THE TURN, ONCE, WHOLE.
 *
 * A row still `running` when the stream ends is resolved from the TERMINAL
 * EVENT, which is real evidence and not a guess: a `result` frame means the
 * model answered, so the work it was doing finished; a stop or an error means
 * it did not. Leaving the row `running` would pulse forever in a record that is
 * no longer moving, and marking every row done would claim a completion the
 * stream never reported.
 */
function commit(
  state: AppState,
  at: number,
  failure: TurnFailure | null,
  result?: Extract<AskEvent, { type: 'result' }>,
): AppState {
  const inFlight = state.session.inFlight;
  if (inFlight === null) return state;

  const resolved: WorkRow[] = inFlight.work.map((row) =>
    row.status === 'running' ? { ...row, status: failure === null ? 'done' : 'error' } : row,
  );

  const proposalId = inFlight.evidence.proposals[inFlight.evidence.proposals.length - 1];
  /*
   * EXACTLY ONE EFFECT, and `answer` is a real member rather than the absence
   * of one — types.ts on `TurnEffect`: an optional effect would make "the
   * canvas did not move" and "we forgot to set an effect" the same value.
   *
   * `focus` and `act` are not reachable from this wire. The stream carries no
   * frame that names nodes to focus (`AskDiagram` carries `scopeNodeIds`, but
   * nothing yet resolves them against a graph this store can paint), and `act`
   * is applied by the accept path, which is Wave 5. Emitting `focus` from a
   * diagram hint would move the canvas out from under the reader on a guess —
   * the legibility defect item 2.1 names by line number.
   */
  const effect: TurnEffect =
    proposalId === undefined ? { kind: 'answer' } : { kind: 'propose', proposalId };

  const userTurn = state.session.turns.find(
    (t): t is UserTurn => t.id === inFlight.replyTo && t.role === 'user',
  );
  const durationMs =
    userTurn !== undefined && typeof userTurn.at === 'number' ? at - userTurn.at : undefined;

  const assistant: AssistantTurn = {
    id: inFlight.turnId,
    role: 'assistant',
    replyTo: inFlight.replyTo,
    text: inFlight.text,
    work: resolved,
    effect,
    /*
     * CARRIED WHEN MEASURED, ABSENT WHEN NOT — AND NEVER ZEROED.
     *
     * The engine has always computed this and always put it on the `result`
     * event; the shape simply was not in `@sequence/api-types`, so this line
     * used to be an unconditional `null` and the rail rendered a field nothing
     * could fill. CANON calls coverage "the single strongest thing we have" —
     * the one claim Codex and Claude Code structurally cannot make — and it was
     * arriving on the wire and being dropped here.
     *
     * A zero denominator would read as "saw nothing" instead of "nothing
     * measured it", so an answer that carried no coverage stays null.
     */
    coverage: result?.coverage ?? null,
    evidence: inFlight.evidence,
    usage: inFlight.usage,
    metrics: result?.metrics ?? null,
    contextBreakdown: result?.contextBreakdown ?? null,
    advisor: result?.advisor ?? null,
    diagram: result?.diagram ?? null,
    source: result?.source ?? null,
    runId: inFlight.runId,
    failure,
    ...(durationMs !== undefined && durationMs >= 0 ? { durationMs } : {}),
    at,
  };

  const session: SessionSlice = {
    ...state.session,
    turns: [...state.session.turns, assistant],
    inFlight: null,
    canvasDoc: landCanvasBlocks(state.session.canvasDoc),
  };

  return { ...state, session };
}

/* ========================================================================== *
 * THE REPO
 * ========================================================================== */

/**
 * Compose the `ScannedRepo` the canvas paints, or refuse.
 *
 * The boot lane yields a `ScannedRepoDraft`: everything one scan produced
 * EXCEPT `doc`. `boot/index.ts` names the missing step `withDoc` and hands it
 * to this file, which applies the projector the application bound.
 *
 * WITH NO PROJECTOR THE STORE DOES NOT REPORT ATTACHED. The frozen contract
 * requires `doc` on `ScannedRepo`, and that requirement is the invariant
 * talking: an empty `SeqDiagramV1` here would be a diagram this store invented,
 * painted on the one surface whose whole claim is that it is grounded. So the
 * repo stays unattached and the reason is written down where a surface can read
 * it, rather than left as a screen that silently does nothing.
 *
 * THE REFUSAL STAYS. An earlier draft of this comment said the `null` arm would
 * be deleted once a projector was always supplied. It is not, and the reason is
 * worth recording: the Wave 3 gate found the shipped application calling
 * `createStore()` bare and this branch firing on every boot, which is the ONLY
 * reason the board's emptiness was explicable at all rather than mysterious.
 * A guard that is deleted as soon as it stops firing is a guard that was only
 * ever documentation. `store.test.tsx` reaches it deliberately.
 */
function loadRepo(
  state: AppState,
  draft: ScannedRepoDraft,
  at: number,
  project: Projector | null,
): AppState {
  if (project === null) {
    return {
      ...state,
      repo: { phase: 'unattached' },
      net: {
        ...state.net,
        lastFailure: {
          status: null,
          route: 'GET /archgraph.json',
          message:
            `the graph for ${draft.repoName} loaded, but this store was built with no ` +
            'canvas projection to paint it with, so there is nothing grounded to draw',
          at,
        },
      },
    };
  }

  const repo: ScannedRepo = {
    root: draft.root,
    repoName: draft.repoName,
    graph: draft.graph,
    doc: project(draft.graph),
    summary: draft.summary,
    scannedAt: draft.scannedAt,
    /* Both fetched lazily by the rail, which has not mounted. `null` is the
       contract's word for "not asked for yet", and it is not `{}`. */
    functions: null,
    tree: null,
  };

  /*
   * A DIFFERENT REPOSITORY IS A DIFFERENT CONVERSATION.
   *
   * `repo/detached` resets the session slice; attaching repo B DIRECTLY over
   * repo A did not, so repo A's transcript stood in repo B's workspace —
   * measured 2026-08-29: questions asked about the sequence monorepo, under a
   * hoppscotch attach, beneath a "reloaded from the saved session" banner.
   * The server's session store is per-repo (`sessionsRoot()` = the attached
   * root), so the engine had already moved on; only this store kept talking.
   *
   * Gated on the ROOT CHANGING, never on the action alone: `repo/loaded` also
   * lands on every RESCAN of the same repository (stale → rebase), and wiping
   * the conversation because the user accepted an edit would be a worse bug
   * than the one this fixes.
   */
  const previousRoot =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo.root
      : null;
  const crossedRepos = previousRoot !== null && previousRoot !== draft.root;

  return {
    ...state,
    repo: { phase: 'attached', repo },
    /* FINDING F1 — A NEW SCAN LANDS ON A CLEAN CANVAS SLICE. Only
       `repo/detached` used to reset it, so annotations (and any other canvas
       fact) from the previous scan survived a rescan or a repo swap onto
       cards whose ids happened to match. The live slice re-seeds through
       `canvas/reset` in `canvasChannel`; this resets the seed it starts
       from, so the two cannot disagree about what "nothing yet" is. */
    canvas: EMPTY_CANVAS,
    ...(crossedRepos ? { session: createInitialState().session } : {}),
    net: { ...state.net, lastFailure: null },
  };
}

/**
 * The boot outcome, mapped onto the frozen `RepoSlice` — one switch, exactly as
 * `boot/index.ts` writes it in its handback.
 *
 * `foreign-repo` and `sign-in-required` land on `unattached` on purpose. Both
 * mean "there is a platform and it will not show you this repo", and neither
 * has a surface yet (§5.6 lists sign-in among the eleven unsheeted). Rendering
 * them as `failed` would put an error wall in front of a working engine.
 */
function bootSettled(
  state: AppState,
  outcome: BootOutcome,
  project: Projector | null,
  tokens: ShellTokens,
): AppState {
  const net = { ...state.net, reachable: outcome.platform.reachable };
  const settledState: AppState = { ...state, net };

  switch (outcome.kind) {
    case 'attached':
    case 'static-graph':
      return loadRepo(settledState, outcome.repo, outcome.platform.at, project);

    case 'unattached':
    case 'foreign-repo':
    case 'sign-in-required':
    case 'no-engine': {
      /*
       * DO NOT DEMOTE AN ALREADY-ATTACHED CLIENT. Headless hydrate fills an
       * empty store (engine `--repo`); it must not yank a graph the reader (or
       * a test) already loaded when the ladder reports no-engine / unattached
       * on a transport that never saw that attach. Net reachability still
       * updates above.
       */
      if (state.repo.phase === 'attached' || state.repo.phase === 'stale') {
        return settledState;
      }
      /* Seat-walk OpenCode boot: chat must stand even if persistence remembered
         it closed. */
      const unattached: AppState = { ...settledState, repo: { phase: 'unattached' } };
      return withShell(unattached, tokens, (shell) => withPaneOpen(shell, 'chat', true, tokens));
    }

    case 'hydrate-failed':
      return {
        ...settledState,
        repo: { phase: 'failed', attempted: null, failure: outcome.failure },
      };
  }
}

/** B4.2 — derive proposal status from per-file Accept/Deny decisions. */
function deriveProposalStatusFromFiles(
  files: FileEditProposal['files'],
  previous: FileEditProposal['status'],
): FileEditProposal['status'] {
  if (files.length === 0) return previous;
  const decisions = files.map((f) => f.decision);
  if (decisions.every((d) => d === 'pending')) return 'pending';
  if (decisions.every((d) => d === 'rejected')) return 'denied';
  if (decisions.every((d) => d === 'accepted')) {
    return previous === 'applied' ? 'applied' : 'pending';
  }
  return 'partial';
}

/** B4.2 — after Apply, status reflects what landed vs what was rejected. */
function deriveProposalStatusAfterApply(
  files: FileEditProposal['files'],
  written: ReadonlySet<string>,
): FileEditProposal['status'] {
  const accepted = files.filter((f) => f.decision === 'accepted');
  const rejected = files.filter((f) => f.decision === 'rejected');
  const pending = files.filter((f) => f.decision === 'pending');
  const allAcceptedLanded =
    accepted.length > 0 && accepted.every((f) => written.has(f.path));
  if (allAcceptedLanded && pending.length === 0 && rejected.length === 0) return 'applied';
  if (allAcceptedLanded && pending.length === 0 && rejected.length > 0) return 'partial';
  return 'partial';
}
