import type {
  Breakpoint,
  PaneMode,
  PaneState,
  ProposalId,
  ShellOverlay,
  ShellSlice,
  ThemePreference,
} from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.3 — THE SHELL MODEL

   Every arrangement decision the three-region frame makes, as pure functions
   of a frame size and a handful of booleans. No React, no DOM, no CSS.

   DECISION 5 (docs/OWNER-PLAN-2026-08-24c.md) REWROTE THE ARRANGEMENT this
   model computes, and it overrides the substrate chassis it used to transcribe
   (_core.html's `.win`, chat LEFT / canvas CENTRE / rail RIGHT):

     sessions sidebar LEFT · chat CENTRE · board pane RIGHT,
     settings bottom-left, and no board pane at all until a repository is
     attached (the no-board boot is chat-only).

   WHAT MOVED AND WHAT DID NOT. The slice keys keep their historical names —
   'chat' carries the CENTRE column and 'rail' carries the LEFT sidebar — so
   the frozen contract in state/types.ts, the store's reducers and the
   persisted shape all survive unchanged; only what each key MEANS moved, and
   the board pane is not a slice pane at all: its existence is driven by
   attachment upstream (shellPropsFrom passes boardMounted), because "there is
   a document to draw" is repo state, not frame arithmetic.

   THE INVARIANT IS THE BOARD FLOOR. The old rule — the canvas keeps half the
   frame (`canvasFloor`) — is gone with the arrangement that justified it. The
   board, once mounted, never drops below `boardFloor` (max(--col-min, ⌊frame⌋⁄3))
   and the chat may grow against it until roughly half the frame at 1280.
   {@link boardFloor} below is the single definition.

   WHY THE MODEL EXISTS AT ALL, rather than a stack of media queries: risk R9
   in the v2 plan says it in one line — "Decide the rail's narrow-window
   behaviour in the model layer before any CSS (near-free early, expensive
   retrofit)." Here the arrangement is a value, the invariant is arithmetic,
   and Tier 1 proves both in milliseconds.

   THE LAYOUT NUMBERS ARE NOT DECLARED HERE. They are transcribed from
   tokens/graphite.css into DEFAULT_SHELL_TOKENS below, and shellTokens.ts
   reads the live ones off the cascade at run time so the token layer stays the
   single source. The transcription is a real duplication and it is guarded:
   Shell.test.tsx asserts the constants still equal what the cascade resolves.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── The closed set of layout numbers ─────────────────────────────────── */

export interface PaneLimits {
  /** The default, before the user has ever dragged. */
  readonly base: number;
  readonly min: number;
  readonly max: number;
}

export interface ShellTokens {
  readonly chat: PaneLimits;
  /**
   * `--pane-w-cap`: the hard ceiling the chat may never grow past, however wide
   * the frame. Distinct from `chat.max`, which is the ceiling on a NORMAL frame
   * — the chat may exceed `chat.max` as the frame grows (the morning ruling)
   * but never this (the afternoon one). See `chatMax`.
   */
  readonly chatCap: number;
  readonly rail: PaneLimits;
  /** --col-min: the substrate's own floor for the centre column. */
  readonly canvasMin: number;
  /** How much canvas an overlay pane must leave showing. --sp-56. */
  readonly overlayPeek: number;
}

/**
 * Mirrors tokens/graphite.css. Changing a value here changes nothing; change
 * the token and this follows, or Shell.test.tsx goes red on the mismatch.
 */
export const DEFAULT_SHELL_TOKENS: ShellTokens = {
  // Decision 5 raised the chat's ceiling 640 → 720 so it can reach roughly
  // half the frame at 1280; --col-max is already 720, which keeps the reading
  // measure of transcript and composer where the type layer set it.
  chat: { base: 392, min: 320, max: 720 }, // --pane-w / --pane-w-min / --pane-w-max
  chatCap: 1000, // --pane-w-cap — --col-max (960) + the transcript's --sp-20 each side
  rail: { base: 280, min: 216, max: 400 }, // --rail-w / --rail-w-min / --rail-w-max
  canvasMin: 420, // --col-min
  overlayPeek: 56, // --sp-56
};

/* ── Breakpoints ──────────────────────────────────────────────────────── */

/**
 * At and above this, both side panes are real grid columns.
 *
 * The number survived Decision 5 unchanged, and inspection says why — it is
 * still the smallest frame at which all three regions sit together with the
 * two columns at their MINIMUM widths and the board at its floor:
 *
 *     board floor at 1100 = max(420, ⌊1100/3⌋) = 420
 *     chat min 320 + sessions min 216          = 536
 *     536 + 420                                 = 956 <= 1100
 *
 * One hundred and forty-four pixels of headroom, so the sidebar leaves the row
 * before the arithmetic gets tight rather than at the moment it fails.
 */
export const WIDE_MIN = 1100;

/** Below this the chat becomes an overlay too and the board holds the frame. */
export const MEDIUM_MIN = 820;

export function breakpointFor(width: number): Breakpoint {
  if (width >= WIDE_MIN) return 'wide';
  if (width >= MEDIUM_MIN) return 'medium';
  return 'narrow';
}

export type PaneName = 'chat' | 'rail';

/**
 * Mode is DERIVED from the breakpoint and one boolean; it is never stored and
 * never set by hand.
 *
 * The 'column' / 'overlay' distinction is the whole point of the type: v1's
 * index rail was a `role="dialog"` collapsed by default, and above 1100px a
 * rail is a column of the page, not something you open and dismiss.
 */
export function paneModeFor(pane: PaneName, breakpoint: Breakpoint, open: boolean): PaneMode {
  if (!open) return 'hidden';
  if (pane === 'rail') return breakpoint === 'wide' ? 'column' : 'overlay';
  return breakpoint === 'narrow' ? 'overlay' : 'column';
}

/* ── The board floor, and what is left for the columns ────────────────── */

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * THE BOARD NEVER GOES BELOW THIS, once a repository has put it on screen.
 * Two floors, and the binding one is the higher:
 *
 *   - ⌊frame/3⌋ — Decision 5's replacement for the old half-frame rule. The
 *     chat is the primary surface now and may grow to roughly half the frame
 *     at 1280; a third of the frame is the smallest share the board can take
 *     while still reading as a place rather than a sliver.
 *   - --col-min, 420px — the substrate's own floor for a working column,
 *     which is the higher of the two below 1260px wide.
 *
 * This REPLACES `canvasFloor` (max(half frame, --col-min)), which encoded the
 * previous arrangement's "canvas ≥ 50%" invariant. Deleted in the same commit
 * that moved the panes — the shell is never half-moved.
 */
export function boardFloor(frameWidth: number, tokens: ShellTokens): number {
  return Math.max(Math.floor(frameWidth / 3), tokens.canvasMin);
}

/** Everything the board does not need, for the two columns to share. */
export function columnAllowance(frameWidth: number, tokens: ShellTokens): number {
  return Math.max(0, frameWidth - boardFloor(frameWidth, tokens));
}

/**
 * THE CHAT GROWS WITH THE FRAME, THEN STOPS.
 *
 * Two owner rulings on one day, and the second corrects the first's excess.
 *
 * Morning: "if you full-screen, the chat box should get bigger. I should be
 * able to actually see a wider output because the screen's bigger." A fixed
 * 720 left the transcript a narrow lane beside an empty board, so the ceiling
 * became `max(token, frame/2)`.
 *
 * Afternoon: "when you were in the chat, it made it too big. It should adapt
 * to the Claude/Codex rules, where it's centered first with an actual cap, and
 * it doesn't stretch the whole way. It just stretches a certain amount to
 * fulfil, and then it fills with the architecture boards on the side, the
 * canvases, etc., to fill that space." `frame/2` with no ceiling is 1280px of
 * chat on a 2560 monitor — half a wall of text beside a board that wanted the
 * room. So the growth is kept and a real ceiling is put on it.
 *
 * The ceiling is `--pane-w-cap`, derived rather than chosen: --col-max is the
 * widest CONTENT line (120 mono columns at --t-13) and the cap is that plus the
 * transcript's own padding. Past it, another pixel of chat is dead space beside
 * a line that has already hit its measure, and it is worth more to the board.
 *
 * What each frame does, and why the morning ruling does NOT regress:
 *   1280 → max(720, 640) = 720, under the cap  → 720, exactly as before
 *   1920 → max(720, 960) = 960, under the cap  → 960, the morning behaviour
 *   2560 → max(720, 1280) = 1280, over the cap → 1000, the afternoon fix
 * The board floor and the sidebar's minimum still bind above this in
 * `resolveWidths`; this only decides how far the chat may ASK to grow.
 */
export function chatMax(frameWidth: number, tokens: ShellTokens): number {
  return Math.min(tokens.chatCap, Math.max(tokens.chat.max, Math.floor(frameWidth / 2)));
}

function paneMax(pane_: PaneName, frameWidth: number, tokens: ShellTokens): number {
  return pane_ === 'chat' ? chatMax(frameWidth, tokens) : tokens.rail.max;
}

/* ── The layout ───────────────────────────────────────────────────────── */

export interface ShellLayout {
  /** The chat column's painted width. 0 unless its mode is 'column'. */
  readonly chatWidth: number;
  readonly railWidth: number;
  /** frame.width minus the two columns. Never below boardFloor(). */
  readonly canvasWidth: number;
  /** The width the pane takes when it floats over the canvas instead. */
  readonly chatOverlayWidth: number;
  readonly railOverlayWidth: number;
}

/**
 * Resolve two requested widths against a frame.
 *
 * THE PANE THE USER TOUCHED LAST WINS, AND THE OTHER ONE GIVES WAY. That is
 * `priority`, and it is the second design tried here. The first shared the
 * overflow between the two panes in proportion to their slack, which reads
 * well and is unusable: at 1280 the nominal widths already exceed the
 * allowance by 32px, so dragging the chat 50px to the right moved it 4px to
 * the LEFT once the rail had paid its share. A drag has to move the thing
 * under the cursor, so the drag is authoritative and the far pane absorbs
 * down to its own minimum — at which point the drag stops, visibly, against a
 * wall the user can feel.
 */
function resolveWidths(
  frameWidth: number,
  chatMode: PaneMode,
  railMode: PaneMode,
  chatWanted: number,
  railWanted: number,
  priority: PaneName,
  tokens: ShellTokens,
): { chatWidth: number; railWidth: number } {
  const chatIsColumn = chatMode === 'column';
  const railIsColumn = railMode === 'column';
  if (!chatIsColumn && !railIsColumn) return { chatWidth: 0, railWidth: 0 };

  const allowance = columnAllowance(frameWidth, tokens);

  // Only a column reserves space for itself. A hidden or floating pane costs
  // the row nothing, which is what lets a closed chat give its width away.
  const reserved = (name: PaneName) => {
    if (name === 'chat') return chatIsColumn ? tokens.chat.min : 0;
    return railIsColumn ? tokens.rail.min : 0;
  };

  const first: PaneName = priority;
  const second: PaneName = priority === 'chat' ? 'rail' : 'chat';
  const wanted = { chat: chatWanted, rail: railWanted };
  const limits = {
    chat: { ...tokens.chat, max: chatMax(frameWidth, tokens) },
    rail: tokens.rail,
  };
  const isColumn = { chat: chatIsColumn, rail: railIsColumn };

  const widths = { chat: 0, rail: 0 };

  widths[first] = isColumn[first]
    ? clamp(wanted[first], limits[first].min, Math.min(limits[first].max, allowance - reserved(second)))
    : 0;

  widths[second] = isColumn[second]
    ? clamp(
        Math.min(wanted[second], allowance - widths[first]),
        limits[second].min,
        limits[second].max,
      )
    : 0;

  return { chatWidth: widths.chat, railWidth: widths.rail };
}

/**
 * An overlay pane floats over the canvas, so it does not shrink it — but it
 * may not cover it either. A pane that fills the frame is a modal wearing a
 * pane's clothes, and the whole reason the mode is called 'overlay' rather
 * than 'dialog' is that the canvas stays visible behind it.
 */
function overlayWidth(frameWidth: number, limits: PaneLimits, tokens: ShellTokens): number {
  return clamp(limits.base, limits.min, Math.min(limits.max, frameWidth - tokens.overlayPeek));
}

export function computeLayout(
  frameWidth: number,
  chatMode: PaneMode,
  railMode: PaneMode,
  chatWanted: number,
  railWanted: number,
  priority: PaneName,
  tokens: ShellTokens,
): ShellLayout {
  const { chatWidth, railWidth } = resolveWidths(
    frameWidth,
    chatMode,
    railMode,
    chatWanted,
    railWanted,
    priority,
    tokens,
  );

  return {
    chatWidth,
    railWidth,
    canvasWidth: frameWidth - chatWidth - railWidth,
    chatOverlayWidth: overlayWidth(frameWidth, tokens.chat, tokens),
    railOverlayWidth: overlayWidth(frameWidth, tokens.rail, tokens),
  };
}

/* ── The state this shell holds until state/store.ts exists ───────────── */

/** The user's open/closed intent for COLUMN mode, which an overlay never sets. */
export interface PaneIntent {
  readonly chat: boolean;
  readonly rail: boolean;
}

/**
 * A slice, plus the arrangement it resolves to.
 *
 * THE HANDBACK WAS TAKEN. This used to carry two more members, `intent` and
 * `priority`, described here as "shell-local bookkeeping the contract has no
 * member for … recorded here as a handback for whoever writes state/store.ts,
 * because all three have to survive the move or the behaviour they carry does
 * not." `Shell.tsx` is controlled now and the store holds the state, so both
 * moved INTO `ShellSlice`, where their doc comments argue why each has to be
 * kept rather than reconstructed from the rest of the slice.
 *
 * `layout` did NOT move and must not: it is a pure function of the slice and
 * the tokens, so storing it would be a second answer to "how wide is the
 * canvas" — the exact duplication this file's arithmetic exists to have only
 * one of. It is computed on the way in and dropped on the way out.
 */
export interface ShellState {
  readonly shell: ShellSlice;
  readonly layout: ShellLayout;
}

/**
 * The arrangement a slice resolves to, and THE ONLY WAY to get a `ShellState` —
 * so that nobody assembles `computeLayout`'s seven arguments by hand at a call
 * site and gets the priority or a mode wrong where no test is looking.
 */
export function layoutOf(shell: ShellSlice, tokens: ShellTokens): ShellState {
  return {
    shell,
    layout: computeLayout(
      shell.frame.width,
      shell.chat.mode,
      shell.rail.mode,
      shell.chat.width,
      shell.rail.width,
      shell.priority,
      tokens,
    ),
  };
}

/** Exactly what goes to localStorage. Widths, not layout: the frame clamp is
 *  re-derived on every boot so a layout saved on a 2560px monitor cannot
 *  arrive on a 1280px one as a fact. */
export interface ShellPersisted {
  /**
   * VERSION 2 — finding F11. Decision 5 rearranged the frame, and the slice
   * keys changed MEANING with it: 'rail' stopped being the right-hand index
   * rail and became the LEFT sessions sidebar. A v1 record with
   * `railOpen:false` would boot the new shell with the sessions sidebar — and
   * the bottom-left settings gear, the only settings door before attach —
   * hidden. The mechanism shellStorage documents for exactly this is the
   * version field: an older shape is discarded whole, never field-wise.
   */
  readonly version: 2;
  readonly chatWidth: number;
  readonly railWidth: number;
  readonly chatOpen: boolean;
  readonly railOpen: boolean;
  readonly priority: PaneName;
  readonly theme: ThemePreference;
}

export const SHELL_PERSISTED_VERSION = 2;

function pane(mode: PaneMode, width: number, open: boolean): PaneState {
  return { mode, width, open };
}

function assemble(
  frame: { width: number; height: number },
  intent: PaneIntent,
  open: { chat: boolean; rail: boolean },
  widths: { chat: number; rail: number },
  priority: PaneName,
  theme: ThemePreference,
  overlay: ShellOverlay | null,
  dragging: PaneName | null,
  tokens: ShellTokens,
): ShellState {
  const breakpoint = breakpointFor(frame.width);
  const chatMode = paneModeFor('chat', breakpoint, open.chat);
  const railMode = paneModeFor('rail', breakpoint, open.rail);
  const layout = computeLayout(
    frame.width,
    chatMode,
    railMode,
    widths.chat,
    widths.rail,
    priority,
    tokens,
  );

  return {
    shell: {
      breakpoint,
      frame,
      chat: pane(chatMode, widths.chat, open.chat),
      rail: pane(railMode, widths.rail, open.rail),
      intent,
      priority,
      canvasWidth: layout.canvasWidth,
      dragging,
      theme,
      overlay,
    },
    layout,
  };
}

/** The open state a pane gets when the breakpoint changes under it: a column
 *  follows the user's remembered intent, an overlay always starts closed. An
 *  overlay that opened itself on a resize is a panel appearing over the work
 *  for no reason the user can name. */
function openAfterBreakpointChange(
  pane_: PaneName,
  breakpoint: Breakpoint,
  intent: PaneIntent,
): boolean {
  return paneModeFor(pane_, breakpoint, true) === 'column' ? intent[pane_] : false;
}

export function createShellState(
  frame: { width: number; height: number },
  tokens: ShellTokens,
  persisted: ShellPersisted | null,
): ShellState {
  const intent: PaneIntent = {
    chat: persisted?.chatOpen ?? true,
    rail: persisted?.railOpen ?? true, // §2.3: the rail is OPEN by default
  };
  const breakpoint = breakpointFor(frame.width);

  return assemble(
    frame,
    intent,
    {
      chat: openAfterBreakpointChange('chat', breakpoint, intent),
      rail: openAfterBreakpointChange('rail', breakpoint, intent),
    },
    {
      chat: clamp(persisted?.chatWidth ?? tokens.chat.base, tokens.chat.min, chatMax(frame.width, tokens)),
      rail: clamp(persisted?.railWidth ?? tokens.rail.base, tokens.rail.min, tokens.rail.max),
    },
    persisted?.priority ?? 'chat',
    persisted?.theme ?? 'dark',
    null,
    null,
    tokens,
  );
}

export function withFrame(
  state: ShellState,
  frame: { width: number; height: number },
  tokens: ShellTokens,
): ShellState {
  const next = breakpointFor(frame.width);
  const crossed = next !== state.shell.breakpoint;

  /*
   * THE CHAT KEEPS ITS SHARE OF THE FRAME. A width is stored in pixels, so a
   * chat dragged to 40% of a 1280 window arrived on the maximised 1920 window
   * as the same 512px — a quarter of the screen, beside a board that had
   * taken all the new room. Maximising is not a request for a smaller chat.
   * The wanted width is scaled by the frame's growth (and shrink), then
   * clamped like any other; the sidebar keeps its pixels because a sessions
   * list does not read better wider. A frame of 0 (first measurement) scales
   * nothing.
   */
  const before = state.shell.frame.width;
  const chatWanted =
    before > 0 && frame.width !== before
      ? Math.round((state.shell.chat.width * frame.width) / before)
      : state.shell.chat.width;

  return assemble(
    frame,
    state.shell.intent,
    crossed
      ? {
          chat: openAfterBreakpointChange('chat', next, state.shell.intent),
          rail: openAfterBreakpointChange('rail', next, state.shell.intent),
        }
      : { chat: state.shell.chat.open, rail: state.shell.rail.open },
    { chat: clamp(chatWanted, tokens.chat.min, chatMax(frame.width, tokens)), rail: state.shell.rail.width },
    state.shell.priority,
    state.shell.theme,
    state.shell.overlay,
    state.shell.dragging,
    tokens,
  );
}

export function withPaneWidth(
  state: ShellState,
  pane_: PaneName,
  width: number,
  tokens: ShellTokens,
): ShellState {
  const limits = tokens[pane_];
  const widths = {
    chat: state.shell.chat.width,
    rail: state.shell.rail.width,
    [pane_]: clamp(width, limits.min, paneMax(pane_, state.shell.frame.width, tokens)),
  } as { chat: number; rail: number };

  return assemble(
    state.shell.frame,
    state.shell.intent,
    { chat: state.shell.chat.open, rail: state.shell.rail.open },
    widths,
    pane_,
    state.shell.theme,
    state.shell.overlay,
    state.shell.dragging,
    tokens,
  );
}

export function withDragging(state: ShellState, dragging: PaneName | null): ShellState {
  return { ...state, shell: { ...state.shell, dragging } };
}

export function withPaneToggled(
  state: ShellState,
  pane_: PaneName,
  tokens: ShellTokens,
): ShellState {
  const open = !state.shell[pane_].open;
  // Only a column-mode toggle is a statement about the column. Opening the
  // rail as an overlay at 900px says nothing about what should happen the next
  // time the window is wide.
  const isColumn = paneModeFor(pane_, state.shell.breakpoint, true) === 'column';
  const intent: PaneIntent = isColumn ? { ...state.shell.intent, [pane_]: open } : state.shell.intent;

  return assemble(
    state.shell.frame,
    intent,
    { chat: state.shell.chat.open, rail: state.shell.rail.open, [pane_]: open },
    { chat: state.shell.chat.width, rail: state.shell.rail.width },
    state.shell.priority,
    state.shell.theme,
    state.shell.overlay,
    state.shell.dragging,
    tokens,
  );
}

/**
 * Force a pane open or closed without flipping.
 *
 * Seat-walk: unattached / detach must reopen chat even when `sequence.shell.v1`
 * remembered `chatOpen: false`. A toggle would close an already-open chat.
 */
export function withPaneOpen(
  state: ShellState,
  pane_: PaneName,
  open: boolean,
  tokens: ShellTokens,
): ShellState {
  if (state.shell[pane_].open === open && state.shell.intent[pane_] === open) return state;
  const isColumn = paneModeFor(pane_, state.shell.breakpoint, true) === 'column';
  const intent: PaneIntent = isColumn ? { ...state.shell.intent, [pane_]: open } : state.shell.intent;

  return assemble(
    state.shell.frame,
    intent,
    { chat: state.shell.chat.open, rail: state.shell.rail.open, [pane_]: open },
    { chat: state.shell.chat.width, rail: state.shell.rail.width },
    state.shell.priority,
    state.shell.theme,
    state.shell.overlay,
    state.shell.dragging,
    tokens,
  );
}

export function withOverlay(state: ShellState, overlay: ShellOverlay | null): ShellState {
  return { ...state, shell: { ...state.shell, overlay } };
}

export function withTheme(state: ShellState, theme: ThemePreference): ShellState {
  return { ...state, shell: { ...state.shell, theme } };
}

/**
 * THE SLICE, NOT THE `ShellState`. What goes to disk is a fact about the user's
 * arrangement, and `layout` is a fact about the window they happened to have
 * open — the doc comment on {@link ShellPersisted} already refuses to write it
 * ("a layout saved on a 2560px monitor cannot arrive on a 1280px one as a
 * fact"), so taking the whole state here only offered a caller something it
 * must not use.
 */
export function toPersisted(shell: ShellSlice): ShellPersisted {
  return {
    version: SHELL_PERSISTED_VERSION,
    chatWidth: shell.chat.width,
    railWidth: shell.rail.width,
    chatOpen: shell.intent.chat,
    railOpen: shell.intent.rail,
    priority: shell.priority,
    theme: shell.theme,
  };
}

/* ── The command surface ──────────────────────────────────────────────── */

export type ShellCommandId =
  | 'composer.focus'
  | 'canvas.whiteboard'
  | 'canvas.board'
  | 'pane.chat'
  | 'pane.rail'
  | 'pane.reset'
  | 'overlay.attach'
  | 'repo.detach'
  | 'overlay.activity'
  | 'overlay.review'
  | 'overlay.rewind'
  | 'overlay.help'
  | 'overlay.search'
  | 'overlay.sessions'
  | 'overlay.settings';

/**
 * THE REVIEW OVERLAY OPENED FROM HERE NAMES NO PROPOSAL, AND SAYS SO.
 *
 * `ShellOverlay` declares review as `{ kind: 'review'; proposalId: ProposalId }`
 * because the OTHER way in — the chat's own "review what this turn proposed" —
 * opens review ON a proposal and has one to name. The command surface has no
 * such subject: a user pressing Ctrl-K is asking to see the working tree, which
 * is the surface's `unstaged` scope and is what `ConnectedReview` loads by
 * itself. It finds the last turn's proposal by walking `session.turns`
 * backwards and never reads this field.
 *
 * So the honest value is the EMPTY id — the absence of a proposal, spelled out
 * — and not an id that no proposal has. `ProposalId` is a bare `string` and has
 * no empty member of its own; this constant is that member, declared once, so
 * "which proposal is this" has one answer instead of a literal `''` appearing
 * at a call site where the next reader has to guess whether it was meant.
 *
 * WHEN THE FIELD BECOMES `ProposalId | null` in `state/types.ts` — which is the
 * shape it wants — this constant is deleted and the command carries `null`.
 * That file belongs to the state lane; this does not pre-empt it.
 */
export const NO_PROPOSAL: ProposalId = '';

export interface ShellCommand {
  readonly id: ShellCommandId;
  /** Verb first, sentence case. The row IS the label; there is no glyph. */
  readonly label: string;
  /** Words a person would type when the row's visible label uses different
   *  language. Kept on the command so every generated command surface shares
   *  the same vocabulary. */
  readonly searchTerms?: readonly string[];
  /** 'shell' runs here. 'host' needs a surface the shell does not own, and is
   *  rendered disabled rather than hidden when that surface is absent. */
  readonly owner: 'shell' | 'host';
  /** Set when the command needs an overlay renderer to have anywhere to go. */
  readonly overlay?: ShellOverlay;
}

/**
 * The commands the frame can surface. Commands owned by a mounted product
 * surface are declared here as `host`; the frame renders and ranks their rows,
 * while the lane that owns the surface performs the action.
 *
 * Order is the ranking, and 'composer.focus' is first because §6 of the plan
 * specifies Cmd/Ctrl-K as reaching the composer. Opening this surface and
 * pressing Enter does exactly that; everything else is a row below it.
 */
export const SHELL_COMMANDS: readonly ShellCommand[] = [
  { id: 'composer.focus', label: 'Focus the composer', owner: 'host' },
  { id: 'canvas.whiteboard', label: 'Open the whiteboard', owner: 'host' },
  { id: 'canvas.board', label: 'Open the architecture board', owner: 'host' },
  { id: 'pane.chat', label: 'Show or hide the chat', owner: 'shell' },
  /* FINDING F13 — the pane IS the sessions sidebar now (Decision 5); "index
     rail" is the slice key's history and names nothing on screen. */
  { id: 'pane.rail', label: 'Show or hide the sessions sidebar', owner: 'shell' },
  { id: 'pane.reset', label: 'Reset the pane widths', owner: 'shell' },
  { id: 'overlay.attach', label: 'Attach a repository', owner: 'shell', overlay: { kind: 'attach' } },
  /* The way OUT, which did not exist. Worded as the reader asked for it. */
  { id: 'repo.detach', label: 'Leave this repository', owner: 'host' },
  /*
   * P9 — AND IT SITS SECOND, ABOVE REVIEW.
   *
   * §5.2 of docs/research/v2-architecture-and-gaps.md gives the reason in one
   * sentence: "multi-agent work is unusable without 'which of my N threads
   * needs me' answerable from outside the app." Codex answers it on
   * Cmd+Opt+U — its own dedicated key — and Cursor 3 gives it a permanent
   * sidebar. Sequence has one command surface and no spare chord, so the
   * ranking IS the answer to how reachable it is: a run that is blocked
   * outranks a diff you have not read, because the diff is still there in ten
   * minutes and the blocked run is burning a wall clock.
   *
   * The row is above Attach's neighbours and below Attach itself for the same
   * reason review is: with nothing attached there are no runs to list, so the
   * command that makes this one useful has to come first.
   */
  { id: 'overlay.activity', label: 'Show the activity view', owner: 'shell', overlay: { kind: 'activity' } },
  /*
   * REVIEW'S ONLY DOOR, AND THAT IS WHY IT IS IN THE FRAME'S OWN LIST.
   *
   * The paragraph above this array says a review command "belongs to the lane
   * that owns that surface" — and that is still the rule for a review command
   * that reviews SOMETHING: the chat's proposal card will open review on its
   * own proposal and that row is the chat lane's. This one is different in kind.
   * It opens the surface with no subject, from the frame's own palette, and it
   * exists because CANON §2 names diff review as the primary surface of the one
   * interface reference this project has and Wave 5 shipped it reachable by
   * nothing at all. A surface a user cannot reach is the Wave 2 defect.
   *
   * It sits directly under Attach because both are "put something in front of
   * me", and above the session list because a diff you have not read outranks a
   * session you have.
   */
  {
    id: 'overlay.review',
    label: 'Review the working tree',
    owner: 'shell',
    overlay: { kind: 'review', proposalId: NO_PROPOSAL },
  },
  /*
   * SEARCH, AND IT SITS HERE RATHER THAN LOWER.
   *
   * `GET /api/search` shipped correct, security-gated and fetched by nothing;
   * an independent classification of all seventy routes put it first among the
   * twenty-one serving surfaces that were never built, because repo-wide search
   * is a basic navigation need and this one costs NO MODEL CALL. That is what
   * ranks it above the session list: a reader with no key configured can still
   * use it, and it is the only thing in this list of which that is true.
   */
  { id: 'overlay.search', label: 'Search this repository', owner: 'shell', overlay: { kind: 'search' } },
  /*
   * HELP SITS AFTER THE WORKING SURFACES, NOT FIRST.
   *
   * A reader who has found the palette has already solved the hard half of
   * discovery; putting help above the things they came to do would push those
   * things down for everyone, every time, to serve the one session in which
   * anybody needs it. It is in the list so it can be FOUND, ranked so it does
   * not get in the way.
   */
  {
    id: 'overlay.help',
    label: 'What can I do here?',
    searchTerms: ['help', 'whiteboard', 'keys', 'shortcuts', 'key'],
    owner: 'shell',
    overlay: { kind: 'help' },
  },
  { id: 'overlay.sessions', label: 'Open the session list', owner: 'shell', overlay: { kind: 'sessions' } },
  /*
   * REWIND, DIRECTLY UNDER THE SESSION LIST.
   *
   * The engine has been able to undo a turn's edits since checkpoints
   * shipped: it takes a pre-write baseline of every file it changes, and
   * /api/checkpoint/{plan,restore} puts the tree back. Nothing in the
   * product ever opened one of those routes, which made it the Wave 2
   * defect in its most expensive form - not a surface that was never
   * built, but a finished one that no door led to.
   *
   * Below sessions because a rewind is scoped to the sitting you are in,
   * so choosing the sitting is the earlier question.
   */
  { id: 'overlay.rewind', label: 'Rewind an edit', owner: 'shell', overlay: { kind: 'rewind' } },
  {
    id: 'overlay.settings',
    label: 'Open settings',
    owner: 'shell',
    overlay: { kind: 'settings', pane: 'provider' },
  },
];

/**
 * Score a command against a query, or null when it does not match.
 *
 * SUBSEQUENCE, NOT SUBSTRING. "osl" should find "Open the session list" —
 * every palette a developer has used works that way, and a substring filter
 * makes the reader type the words in the order the product happens to have
 * written them. It is the difference between a palette you aim and a palette
 * you spell.
 *
 * The score is what keeps that from being noise: a subsequence match can be
 * absurdly loose ("oe" matches almost everything), so ranking has to put the
 * good ones first or the feature is worse than the substring filter it
 * replaced.
 *
 * LOWER IS BETTER. Two things are rewarded, both of them what a reader
 * intends when they type an abbreviation:
 *
 *   · WORD STARTS. "osl" matching the O of Open, S of session and L of list is
 *     an initialism, and it is almost always what was meant.
 *   · ADJACENCY. Letters found next to each other are a fragment of a real
 *     word rather than three letters scattered across a sentence.
 */
export function scoreCommand(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === '') return 0;
  const hay = text.toLowerCase();

  let score = 0;
  let from = 0;
  let previous = -2;

  for (const ch of needle) {
    const at = hay.indexOf(ch, from);
    if (at === -1) return null;

    const wordStart = at === 0 || hay[at - 1] === ' ' || hay[at - 1] === '-';
    const adjacent = at === previous + 1;

    /* Distance from where we were looking is the base cost: letters found far
       apart are a looser match than letters found together. */
    if (!adjacent && !wordStart) score += at - from + 1;
    if (wordStart) score -= 1;

    previous = at;
    from = at + 1;
  }

  /* A shorter label matching the same letters is the tighter answer — "Chat"
     beats "Show or hide the chat" for "chat". */
  return score + hay.length / 100;
}

/**
 * The commands matching a query, best first.
 *
 * Ties keep DECLARATION ORDER, which is the ranking `SHELL_COMMANDS` argues
 * for at length — a blocked run outranks a diff you have not read. Re-sorting
 * equal scores alphabetically would throw that away.
 */
export function filterCommands(
  query: string,
  commands: readonly ShellCommand[] = SHELL_COMMANDS,
): ShellCommand[] {
  const needle = query.trim();
  if (!needle) return [...commands];

  const scored: { command: ShellCommand; score: number; order: number }[] = [];
  for (const [order, command] of commands.entries()) {
    const searchableText = [command.label, ...(command.searchTerms ?? [])].join(' ');
    const score = scoreCommand(needle, searchableText);
    if (score === null) continue;
    scored.push({ command, score, order });
  }

  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map((row) => row.command);
}

export function resetPaneWidths(state: ShellState, tokens: ShellTokens): ShellState {
  return assemble(
    state.shell.frame,
    state.shell.intent,
    { chat: state.shell.chat.open, rail: state.shell.rail.open },
    { chat: tokens.chat.base, rail: tokens.rail.base },
    'chat',
    state.shell.theme,
    state.shell.overlay,
    state.shell.dragging,
    tokens,
  );
}
