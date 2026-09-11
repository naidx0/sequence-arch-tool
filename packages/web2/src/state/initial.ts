/* ══════════════════════════════════════════════════════════════════════════
   THE EMPTY STATE — what the app holds before anything has happened.
   packages/web2/src/state/initial.ts

   Item 2.1 froze the state TYPES and deliberately shipped no implementation.
   That was right, but it left every Wave 2 surface taking props from a caller
   that did not exist, so nothing was mounted and the served app rendered the
   Wave 0 token specimen — whose own text reads "Nothing here is a product
   surface." Three lanes each noticed one edge of that; none owned the fix.

   This file is the value each slice holds before anything has happened. It is
   NOT the store: `store.ts` owns transitions, derivation and the wire, and it
   consumes `createInitialState()` as its starting value rather than declaring
   one of its own.

   WHY NOT `chat/fixtures.ts`: that module builds the same shapes, but
   `chat/index.ts` states plainly that the fixtures are not re-exported —
   "a surface that reaches past this file is a surface this lane cannot change."
   Shipping test fixtures into the app root would breach that on day one, and
   fixtures carry sample content, which would put invented turns on screen.

   NOTHING HERE IS FABRICATED CONTENT. Every field is the honest zero: no
   turns, no chips, an empty draft. Graphite law 4 — never invent a number —
   applies to state as much as to a sheet.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  DEFAULT_SHELL_TOKENS,
  createShellState,
  type ShellPersisted,
  type ShellTokens,
} from '../shell';
import type {
  AppState,
  AttachDialogState,
  CanvasSlice,
  ComposerSlice,
  ModelSelection,
  NetSlice,
  PermissionControl,
  RailSlice,
  RepoSlice,
  SessionSlice,
  ShellSlice,
  TrustSlice,
} from './types';

/**
 * `unconfigured` is the truthful origin before `/api/ai-config` has answered.
 * The composer renders the model name from this, and a default that claims a
 * model the user has not connected is the fabrication this field exists to
 * prevent — §3 of the plan records that the route returns ONE configured model
 * as a string, so there is no list to pick from and nothing to guess.
 */
export const EMPTY_MODEL: ModelSelection = {
  model: '',
  origin: 'unconfigured',
};

/**
 * `propose` is the floor, and the only mode enabled until the user turns
 * another on in Settings. It is the mode in which nothing reaches disk without
 * a human accepting it — the product stance recorded in
 * `docs/research/v2-architecture-and-gaps.md` P3, and the safe default for a
 * surface that has not yet been given a repo.
 */
export const EMPTY_PERMISSION: PermissionControl = {
  mode: 'propose',
  /*
   * PLAN IS ENABLED OUT OF THE BOX, and it is the only non-default mode that
   * is. The rule for the others is that a mode must not be offered until the
   * product can deliver it; plan clears that bar trivially because it asks for
   * LESS than the default already enforces — the tool boundary allows only
   * read, fetch, search and think whatever the mode says.
   *
   * It is not the DEFAULT mode, though. Landing a new reader in a mode that
   * cannot change anything would read as the product being broken.
   */
  enabled: ['plan', 'propose'],
};

/**
 * The composer before a single keystroke.
 *
 * `send` is `disabled` here and that is the ONLY place in the product a send
 * state is written by hand. Every value it takes afterwards comes out of
 * `deriveSendState`, applied by the store's one funnel — and `createStore`
 * runs that funnel over this value too, so even this literal is checked rather
 * than trusted. See the comment on `derive()` in store.ts.
 */
export const EMPTY_COMPOSER: ComposerSlice = {
  focusNonce: 0,
  draft: '',
  /* Unknown until /api/ai-config answers, and possibly unknown after. */
  contextWindow: null,
  chips: [],
  attachments: [],
  mention: null,
  model: EMPTY_MODEL,
  permission: EMPTY_PERMISSION,
  // Work mode is deferred by §2.1 of the plan — one persona, Code. The field
  // exists because the wire carries `jobMode` and sessions on disk record it.
  jobMode: 'code',
  send: 'disabled',
  toolbeltOpen: false,
  history: [],
  askSurface: null,
  teach: false,
  teachKnown: null,
};

/** Nothing attached. The canvas holds one invitation and nothing else. */
export const EMPTY_REPO: RepoSlice = { phase: 'unattached' };

/** The browser has not been opened, so it is not anywhere yet. */
export const EMPTY_ATTACH_DIALOG: AttachDialogState = {
  open: false,
  root: null,
  cursor: null,
  parent: null,
  entries: [],
  recents: [],
  browsing: false,
  loading: false,
  failure: null,
};

/**
 * The canvas before a repo.
 *
 * TWO FIELDS HERE ARE ZEROS THAT DO NOT MEAN ZERO, and both are forced by the
 * frozen contract rather than chosen:
 *
 *   `scope.depth` — `roots: []` means the whole system, and a depth from no
 *   root is not a distance. 0 is the absence, not a one-hop scope.
 *
 *   `frame` — the canvas has not measured itself, so its width, height and
 *   therefore its detail budget are unmeasured, not "nothing fits". Sheet 08's
 *   rule is that the budget is the frame; `CanvasFrame` has no nullable member
 *   to say "unmeasured", so the guard is `view.state === 'S0'`: nothing is
 *   drawn, so nothing reads the budget. The canvas lane sets the frame before
 *   it leaves S0.
 */
export const EMPTY_CANVAS: CanvasSlice = {
  view: { state: 'S0' },
  scope: { roots: [], depth: 0, trail: [] },
  selection: { nodeIds: [], edgeIds: [], anchor: null },
  dim: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  frame: { width: 0, height: 0, budget: 0 },
  rung: 1,
  positions: {},
  layout: 'idle',
  annotations: {},
  breakout: null,
};

/** No index, because there is no repo to index. */
export const EMPTY_RAIL: RailSlice = {
  rows: [],
  expanded: [],
  filter: '',
  selectedFunctionId: null,
  selectedPath: null,
  selectedNodeId: null,
  coverageByPath: {},
  loading: false,
};

/** An empty thread, and a git state that claims no branch it has not read. */
export const EMPTY_SESSION: SessionSlice = {
  sessions: [],
  activeId: null,
  turns: [],
  inFlight: null,
  proposals: {},
  /* No agent has proposed a shape. The board enters its S4 ghost state only
     when one arrives, so the absence is what keeps it out of it. */
  topology: null,
  canvasDoc: { blocks: [] },
  git: { branch: null, changed: [], scope: 'unstaged', diffs: {} },
  queued: null,
  hydrating: false,
};

/**
 * `reachable: null` is the third state and the reason the field is not a
 * boolean: the boot probe has not answered, which is a different fact from "the
 * engine is not there". A surface that renders `false` before the probe returns
 * tells the user their engine is down for as long as the request takes.
 */
export const EMPTY_NET: NetSlice = {
  inflight: [],
  lastFailure: null,
  reachable: null,
};

/**
 * `root: null` is the third state, for the same reason `reachable: null` is:
 * the trust probe has not answered yet. Rendering "this repository is not
 * trusted" before it does would accuse every repository for the length of a
 * request, and a warning that is sometimes wrong is a warning people learn to
 * click past.
 */
export const EMPTY_TRUST: TrustSlice = {
  root: null,
  trusted: false,
  instructions: null,
  reviewing: false,
};

/** What `createInitialState` needs from the outside world. All optional. */
export interface InitialStateInput {
  /** The window, measured. Omitted means "measure it, or admit there is none". */
  frame?: { width: number; height: number };
  tokens?: ShellTokens;
  persisted?: ShellPersisted | null;
}

/**
 * MEASURED, NOT ASSUMED. `breakpointFor(0)` is `narrow`, so defaulting the
 * frame to zero would hand every headless caller a phone layout as a fact. The
 * window is read where there is one; where there is not, the zero frame is the
 * honest answer and the caller is expected to dispatch `shell/frame` the moment
 * it has a real measurement.
 */
function measuredFrame(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The shell slice, built by the shell lane's own model rather than by a literal
 * here. `shellModel.ts` is React-free and produces the frozen `ShellSlice`
 * unchanged — `shell/index.ts` says it is exported alongside the component
 * precisely so the store can use it. A second hand-written arrangement in this
 * file would be a second answer to "how wide is the canvas".
 */
export function emptyShell(input: InitialStateInput = {}): ShellSlice {
  const tokens = input.tokens ?? DEFAULT_SHELL_TOKENS;
  return createShellState(input.frame ?? measuredFrame(), tokens, input.persisted ?? null).shell;
}

/** The whole application, before anything has happened. */
export function createInitialState(input: InitialStateInput = {}): AppState {
  return {
    shell: emptyShell(input),
    repo: EMPTY_REPO,
    attachDialog: EMPTY_ATTACH_DIALOG,
    canvas: EMPTY_CANVAS,
    rail: EMPTY_RAIL,
    session: EMPTY_SESSION,
    composer: EMPTY_COMPOSER,
    net: EMPTY_NET,
    trust: EMPTY_TRUST,
  };
}
