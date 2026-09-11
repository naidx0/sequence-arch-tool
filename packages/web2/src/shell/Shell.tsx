import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { ShellOverlay, ShellSlice } from '../state/types';
import { Icon, type IconName } from '../chat/Icon';
import './shell.css';
import { CommandSurface } from './CommandSurface';
import { PaneResizer } from './PaneResizer';
import {
  SHELL_COMMANDS,
  layoutOf,
  toPersisted,
  type PaneName,
  type ShellCommand,
  type ShellCommandId,
} from './shellModel';
import { writeShellPersisted } from './shellStorage';
import { readShellTokens } from './shellTokens';
import { trapFocus } from './focusTrap';
import { paletteHint } from './shortcuts';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.3 — THE FRAME

   Sessions sidebar LEFT, chat CENTRE, board pane RIGHT, settings bottom-left
   of the sidebar. That sentence is Decision 5 (docs/OWNER-PLAN-2026-08-24c.md,
   2026-08-24), and it OVERRIDES the substrate chassis this frame used to
   transcribe — _core.html's `.win`, chat left / canvas centre / rail right.
   With no repository attached there is no board pane at all: the shell boots
   chat-only (sessions + chat filling the frame — no empty workspace card) and
   the attach flow opens the board.

   WHAT THIS COMPONENT OWNS: the three regions, the two resizers, the
   breakpoints, the remembered widths, the 44px top line, the command surface
   and the overlay host. WHAT IT DOES NOT: anything inside a region — and not
   the question "is there a board" either, which arrives as `boardMounted`
   because it is repo state, not frame arithmetic. The chat transcript is item
   2.5's, the board is Wave 3's, the sessions list is its own lane's, and each
   arrives as a ReactNode. A shell that reached into a region would be the
   coupling §4.2 measured and is trying to undo — v1's board alone read
   seventeen store selectors plus two imperative pokes.

   THE SLICE KEYS KEEP THEIR HISTORICAL NAMES: `shell.chat` is the centre
   column and `shell.rail` — a name inherited from the previous arrangement —
   drives the LEFT sessions sidebar (its mode, width and toggle word). The
   board pane is deliberately NOT a slice pane; see `boardMounted`.

   ─────────────────────────────────────────────────────────────────────────
   AND IT DOES NOT OWN ITS STATE. THE STORE DOES. THIS IS THE CHANGE.
   ─────────────────────────────────────────────────────────────────────────

   The version of this file that shipped through Wave 3 held its arrangement in
   `useState(createShellState(...))`, under a header that called that "a
   handback rather than a design" and promised the move once `state/store.ts`
   existed. The store landed in item 2.2 WITH a `shell` slice and a
   `shell/overlay` action — and this component kept its own copy anyway, so the
   slice was written by a reducer nothing read and the action changed a value
   nothing rendered. Two sources of truth for one thing.

   That is not a tidiness complaint; it was measured from the user's seat. Both
   "Open a repository" buttons in the product — `ConnectedBoard`'s empty state
   and `BootSurface`'s — dispatch `shell/overlay`, and a real browser clicking
   either one got ZERO DIALOGS. `Board.test.tsx:315` asserted
   `store.getState().shell.overlay` equalled `{kind:'attach'}` and was green the
   whole time, which is CANON §6's named failure mode: it asserted that a
   DISPATCH LANDED, not that anything happened.

   So: every value below arrives as a prop and every gesture leaves as a
   callback. There is no `setState` in this file. What did NOT move is the
   arithmetic — `shellModel.ts` is React-free and is still the only place a
   breakpoint, a clamp or a canvas width is decided; the store calls exactly the
   same reducers this component used to call.

   TWO THINGS ARE STILL HELD HERE, and both are deliberate:

     `paletteOpen` — the command surface is not in the frozen `ShellSlice` and
     no other surface can open, close or read it. State with exactly one reader
     is not a second source of truth; promoting it would be ceremony, and the
     contract would have to grow a member for a transient.

     the localStorage WRITE — a projection OUT of the state, not a copy of it.
     Nothing is ever read back from it while the app runs (`readShellPersisted`
     is called once, by whoever builds the store's initial value), so it cannot
     disagree with anything.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ShellProps {
  /** The chat column's body. Item 2.5. THE CENTRE column (Decision 5). */
  chat: ReactNode;
  /**
   * Unused by the product after the seat-walk OpenCode boot: unattached no
   * longer mounts a third-region BootSurface. Kept optional so older tests that
   * passed a canvas body still type-check; the frame ignores it when
   * `boardMounted` is false.
   */
  canvas?: ReactNode;
  /**
   * The SESSIONS SIDEBAR's body — the LEFT pane (Decision 5). Absent means the
   * host has nothing to put here and the pane does not exist at all.
   */
  sessions?: ReactNode;
  /** The BOARD PANE's body — the RIGHT region: the live boards and the index
   *  rail. */
  rail: ReactNode;
  /**
   * The board pane's own header control, beside the title.
   *
   * Decision 5 moved the boards into this pane, and their tab switcher moved
   * WITH them — onto the pane's 44px line rather than a second bar below it,
   * which would have spent forty pixels of the board's height on chrome. The
   * frame renders whatever the host supplies here instead of the plain title;
   * absent, the title stands alone.
   */
  railHeader?: ReactNode;
  /**
   * WHETHER THE BOARD PANE EXISTS.
   *
   * Decision 5's no-board boot: with no repository attached the shell renders
   * no board pane — no grid track of chrome, no orphaned resizer. "There is a
   * document to draw" is repo state, not frame arithmetic, so it arrives here
   * as a fact (`shellPropsFrom` derives it from the same selector that names
   * the repository) rather than being inferred from anything in the slice.
   */
  boardMounted?: boolean;
  /**
   * Board was minimised (shared minus) while Architecture/Whiteboard still
   * selected — show a dock icon to restore. Does NOT detach the repo.
   */
  boardDocked?: boolean;
  /** Minimise the board pane into the dock (Architecture/Whiteboard stay selected). */
  onMinimizeBoard?: () => void;
  /** Restore a docked board pane. */
  onRestoreBoard?: () => void;
  /** Dropped into the app bar, left of the shell's own controls: the
   *  repo crumb and Attach are item 2.4's, not the frame's. */
  appbar?: ReactNode;
  /**
   * OpenCode-style workspace tabs (Chat / Architecture / Whiteboard / +).
   * Renders in the appbar between the title and the chord/More cluster.
   * Absent = no workspace strip (tests that only mount the frame).
   */
  workspaceChrome?: ReactNode;
  /**
   * Chrome tab workspace — one central surface; tabs live in the appbar strip.
   * When true, the three-pane grid and floating dock icons are not rendered.
   */
  tabLayout?: boolean;
  /** Body for tab layout — the active tab's content fills the frame. */
  tabWorkspace?: ReactNode;
  /**
   * The attached repository's name, or null when nothing is attached.
   *
   * The frame can point at more than one repository, so "which one is this"
   * is a fact the frame owes the reader — and the control that answers it is
   * also the control that changes it.
   */
  repoName?: string | null;
  /**
   * Escape, when it found nothing to close.
   *
   * Absent means there is nothing running to interrupt. The shell does not
   * know about turns and must not learn: it knows only that Escape reached the
   * end of its own list without being used.
   */
  onInterrupt?: () => void;
  chatTitle?: string;
  /** The LEFT pane's title — the sessions sidebar (Decision 5). */
  sessionsTitle?: string;
  /** The RIGHT pane's title — the board region. */
  railTitle?: string;

  /**
   * THE STATE. The whole of it, from the store, every render.
   *
   * There is no second copy and no local override — including for `theme`,
   * which used to be a prop of its own beside `shell.theme` and was therefore
   * the same defect in miniature. Light is DEFERRED by owner ruling
   * (GRAPHITE-DECISIONS.md Decision 1) and no light values are tuned; the
   * three-state shape is carried from day 0 so finishing it is a fill-in.
   */
  shell: ShellSlice;

  /* ── Every gesture, on its way out ────────────────────────────────────
   *
   * SIX NAMED CALLBACKS AND NOT ONE `dispatch`. A `dispatch` prop would put the
   * store's action union in this component's type and make the frame
   * un-renderable without the store — the split `connect.tsx` describes
   * ("`store.ts` has no React in it and this file has no rules in it") only
   * holds while the surfaces take props. Each of these is one line in
   * `shellPropsFrom`.
   */

  /** The window was measured. The shell does not decide what a frame means. */
  onFrame: (frame: { width: number; height: number }) => void;
  onTogglePane: (pane: PaneName) => void;
  onResizePane: (pane: PaneName, width: number) => void;
  /** A drag started (the pane) or ended (null). Widths mid-drag are not
   *  decisions, and this is what tells the persistence layer so. */
  onDragPane: (pane: PaneName | null) => void;
  onResetPanes: () => void;
  onOverlay: (overlay: ShellOverlay | null) => void;

  /** Commands the frame cannot execute itself. Absent means the surface those
   *  commands need is not mounted, and the rows say so instead of lying. */
  onCommand?: (id: ShellCommandId) => void;
  /** Attach, settings, sessions and review are other lanes' surfaces. The shell
   *  owns WHETHER one is open; this renders WHICH. */
  renderOverlay?: (overlay: ShellOverlay, close: () => void) => ReactNode;
}

function measureFrame() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The panels the app bar offers, in the order the palette ranks them.
 *
 * Deliberately the SAME overlays `SHELL_COMMANDS` declares, and deliberately
 * not a second list of routes: a menu that opened its own dialog would drift
 * from the palette the first time either changed.
 */
const SHELL_PANELS = [
  {
    id: 'activity',
    label: 'Runs',
    title: 'Which run needs you — running, waiting, blocked',
    overlay: { kind: 'activity' } as const,
  },
  {
    id: 'rewind',
    label: 'Rewind',
    title: 'Put files back the way a checkpoint had them',
    overlay: { kind: 'rewind' } as const,
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Provider, notifications, hooks and this workspace',
    overlay: { kind: 'settings', pane: 'provider' } as const,
  },
] as const;

/**
 * DECISION 5 RE-HOMED THE PANELS, AND THE BAR SLIMMED TO MATCH.
 *
 * Sessions is a PANE now — the left sidebar — and Settings lives at the
 * bottom of that sidebar behind its own gear. What remains on the bar is the
 * repo control, the palette hint and this one visible door: Runs, Rewind, the
 * session-list dialog (the narrow-breakpoint form of the sidebar) and Settings
 * all sit one press behind `More`, which is itself on the bar. A door you can
 * see is not a chord you have to guess; the palette still reaches everything,
 * and that remains a second route rather than the only one.
 */

export function Shell({
  chat,
  canvas: _canvas,
  sessions,
  rail,
  railHeader,
  boardMounted = false,
  boardDocked = false,
  onMinimizeBoard,
  onRestoreBoard,
  appbar,
  workspaceChrome,
  tabLayout = false,
  tabWorkspace,
  chatTitle = 'Chat',
  sessionsTitle = 'Sessions',
  railTitle = 'Board',
  shell,
  onFrame,
  onTogglePane,
  onResizePane,
  onDragPane,
  onResetPanes,
  onOverlay,
  repoName = null,
  onInterrupt,
  onCommand,
  renderOverlay,
}: ShellProps) {
  /*
   * READ OFF THE ROOT, NOT OFF THE SHELL ELEMENT. Shell writes --pane-w and
   * --rail-w as inline custom properties on its own box; reading the tokens
   * back from that box would return the value this component just wrote and
   * the defaults would drift one frame at a time into whatever the user last
   * dragged. documentElement is where tokens/graphite.css declares them and it
   * is the only honest place to ask.
   *
   * The store reads the same declarations (whoever builds it passes
   * `readShellTokens(document.documentElement)`), so this is two readers of one
   * source rather than two sources — and Shell.test.tsx's last assertion is
   * what keeps that source and DEFAULT_SHELL_TOKENS from drifting apart.
   */
  const tokens = useMemo(() => readShellTokens(document.documentElement), []);

  /*
   * DERIVED, NEVER STORED. `layoutOf` is a pure function of the slice and the
   * tokens, so the arrangement is recomputed from the state on every render
   * instead of being carried beside it — a stored layout is the second answer
   * to "how wide is the canvas" that shellModel.ts exists to prevent.
   */
  const { layout } = useMemo(() => layoutOf(shell, tokens), [shell, tokens]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  /* The collapsed panel group. Local, like the palette beside it: which chrome
     is expanded is where the reader is looking, not something the store or a
     reload needs to agree about. */
  const [moreOpen, setMoreOpen] = useState(false);
  /* Workspace chip menu — Leave / Open another — only while a repo is named. */
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);

  /*
   * THE TWO CALLBACKS THAT LIVE IN A DEPENDENCY ARRAY ARE HELD IN A REF.
   *
   * `shellPropsFrom` builds a fresh closure for every one of these on every
   * render — it is a pure function of (state, dispatch), which is the whole
   * design — so a dependency array containing `onFrame` would tear the resize
   * listener down and rebuild it on every render AND call it once each time.
   * `onFrame` dispatches, a dispatch re-renders, and that is an infinite loop
   * through the store, not a slow render. `BootSurface.tsx` carries the same
   * ref for the same reason and states it in the same words: "the ref is what
   * lets the effect always call the CURRENT callback while depending only on
   * the value that actually changed."
   *
   * `reduce` also refuses a `shell/frame` that does not move the frame, so the
   * loop is closed at both ends rather than at whichever one is remembered.
   */
  const emitFrame = useRef(onFrame);
  emitFrame.current = onFrame;
  const emitOverlay = useRef(onOverlay);
  emitOverlay.current = onOverlay;

  /* ── The window is the frame ─────────────────────────────────────────── */
  useEffect(() => {
    const onResize = () => emitFrame.current(measureFrame());
    // Once immediately: the window can change size between the store's initial
    // value and this effect, and a shell that is one resize behind on first
    // paint is the same defect as one that never listens. It is also what makes
    // a store built with the zero frame (`initial.ts`: "the caller is expected
    // to dispatch shell/frame the moment it has a real measurement") correct on
    // first paint rather than narrow.
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ── The width is the user's, and it survives ────────────────────────── */
  useEffect(() => {
    // Not while dragging: a mousemove fires dozens of times a second and none
    // of those intermediate widths is a decision. The mouseup that ends the
    // drag clears `dragging`, which re-runs this and writes the one that is.
    if (shell.dragging) return;
    writeShellPersisted(toPersisted(shell));
  }, [shell]);

  /* ── Theme reaches the document, not a wrapper ───────────────────────── */
  useEffect(() => {
    const root = document.documentElement;
    // 'system' removes the attribute rather than setting one: the token layer's
    // three-state form resolves the media query only on a root with NO
    // [data-theme], so stamping "system" would defeat the default it names.
    if (shell.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', shell.theme);
  }, [shell.theme]);

  /* ── The command surface, and the one key that opens it ──────────────── */
  const unavailableReason = useCallback(
    (command: ShellCommand): string | null => {
      if (command.owner === 'host' && !onCommand) return 'not mounted';
      if (command.overlay && !renderOverlay) return 'not built';
      if (command.id === 'repo.detach' && !repoName) return 'no repository attached';
      return null;
    },
    [onCommand, renderOverlay, repoName],
  );

  const runCommand = useCallback(
    (command: ShellCommand) => {
      setPaletteOpen(false);
      if (unavailableReason(command)) return;
      if (command.overlay) {
        onOverlay(command.overlay);
        return;
      }
      if (command.id === 'pane.chat' || command.id === 'pane.rail') {
        onTogglePane(command.id === 'pane.chat' ? 'chat' : 'rail');
        return;
      }
      if (command.id === 'pane.reset') {
        onResetPanes();
        return;
      }
      onCommand?.(command.id);
    },
    [onCommand, onOverlay, onResetPanes, onTogglePane, unavailableReason],
  );

  /*
   * FOCUS IS TRAPPED WHILE AN OVERLAY IS OPEN, and restored when it closes.
   *
   * Keyed on the overlay KIND as well as its presence, so moving from one
   * dialog to another re-runs the trap against the new content rather than
   * leaving it pointed at markup that has been replaced.
   */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const overlayKind = shell.overlay?.kind ?? null;

  useEffect(() => {
    if (overlayKind === null) return undefined;
    const root = dialogRef.current;
    if (!root) return undefined;
    return trapFocus(root);
  }, [overlayKind]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key !== 'Escape') return;
      /*
       * ALREADY HANDLED BY SOMETHING NEARER THE KEYBOARD.
       *
       * The composer's mention picker closes on Escape and calls
       * preventDefault without stopPropagation, so this window listener still
       * runs. Without this guard, dismissing the `@` picker would also kill a
       * running turn — one keystroke, two consequences, and the second one
       * invisible until the answer stopped arriving.
       *
       * `defaultPrevented` is the right signal rather than a list of known
       * components: anything that claims Escape marks it, including whatever
       * claims it next.
       */
      if (event.defaultPrevented) return;

      // One Escape closes one thing, innermost first. Closing both at once is
      // how a user loses a dialog they had not finished with.
      if (paletteOpen) setPaletteOpen(false);
      else if (moreOpen) setMoreOpen(false);
      else if (repoMenuOpen) setRepoMenuOpen(false);
      else if (shell.overlay) emitOverlay.current(null);
      /* LAST, because a dialog over a running turn is the nearer thing. Only
         when Escape has found nothing to close does it mean "stop". */
      else onInterrupt?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, moreOpen, repoMenuOpen, shell.overlay, onInterrupt]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  const frameStyle = {
    // React owns three numbers; CSS owns the layout. These carry the COLUMN
    // contribution only, so a hidden or floating pane contributes nothing and
    // the board region takes the space back. --side-w is the sessions
    // sidebar's track; --pane-w is the chat's.
    '--side-w': shell.rail.mode === 'column' ? `${layout.railWidth}px` : '0',
    '--pane-w': shell.chat.mode === 'column' ? `${layout.chatWidth}px` : '0',
    '--shell-chat-over': `${layout.chatOverlayWidth}px`,
    '--shell-rail-over': `${layout.railOverlayWidth}px`,
  } as CSSProperties;

  /*
   * THE CHAT TOGGLES; IT DOES NOT CLOSE. Max, 2026-08-24:
   *
   *   "chat should be toggleable. Chat should be there always, by the way. You
   *    just minimize chat. Chat shouldn't be able to close chat."
   *
   * Seat-chrome: minimise lives ONLY on the pane card. Collapsed panes become
   * dock icons in the frame (not a second row of toggles on the appbar).
   *
   * Owner 2026-08-26: each section keeps its OWN identity glyph + worded
   * title; every minimise control shares the SAME `minus` glyph. Icon-only
   * sessions title made Sessions disappear and share the chat thread mark.
   */
  const paneMark = (id: string): IconName => {
    switch (id) {
      case 'sessions':
        return 'newthread';
      case 'chat':
        return 'topic';
      case 'board':
        return 'board';
      default:
        return 'panel';
    }
  };

  /* Whiteboard pane/dock must not reuse Architecture's board glyph (P2.5). */
  const boardIdentityMark: IconName = railTitle === 'Whiteboard' ? 'frame' : 'board';

  const paneHeader = (
    id: string,
    title: string,
    actions: { hideLabel: string; onToggle: () => void },
  ) => (
    <header className="shell-pane-hd" data-testid={`shell-${id}-head`}>
      <span className="shell-pane-title" data-testid={`shell-${id}-title`}>
        <Icon name={paneMark(id)} size={14} />
        <span className="shell-pane-title-text">{title}</span>
      </span>
      <span className="shell-acts">
        <button
          type="button"
          className="shell-btn shell-ghost shell-icon-btn"
          data-testid={`shell-${id}-close`}
          aria-label={actions.hideLabel}
          title={actions.hideLabel}
          onClick={actions.onToggle}
        >
          <Icon name="minus" size={14} />
        </button>
      </span>
    </header>
  );

  /* Click-away for More / repo menus — same rule as Propose and +. */
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const repoWrapRef = useRef<HTMLSpanElement | null>(null);
  const repoMenuRef = useRef<HTMLDivElement | null>(null);
  const [repoMenuPos, setRepoMenuPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!repoMenuOpen || !repoWrapRef.current) {
      setRepoMenuPos(null);
      return;
    }
    const rect = repoWrapRef.current.getBoundingClientRect();
    setRepoMenuPos({ top: rect.bottom + 4, left: rect.left });
  }, [repoMenuOpen]);

  useEffect(() => {
    if (!moreOpen && !repoMenuOpen) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreOpen && moreRef.current && !moreRef.current.contains(target)) {
        setMoreOpen(false);
      }
      if (
        repoMenuOpen &&
        repoWrapRef.current &&
        !repoWrapRef.current.contains(target) &&
        repoMenuRef.current &&
        !repoMenuRef.current.contains(target)
      ) {
        setRepoMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moreOpen, repoMenuOpen]);

  return (
    <div
      className={['shell', tabLayout ? 'shell-tab-layout' : ''].filter(Boolean).join(' ')}
      data-testid="shell"
      data-breakpoint={shell.breakpoint}
      data-dragging={shell.dragging ?? 'none'}
      data-board={boardMounted ? 'on' : 'off'}
      data-tab-layout={tabLayout ? 'true' : undefined}
      /* The width the STATE claims, beside the width the browser painted.
         e2e/shell-boot.mjs compares the two and names a drift between them as
         the defect — which is only a real check while this attribute comes
         from the same place the panes do. It is the BOARD region's width now:
         the flexible remainder after the two columns (Decision 5). */
      data-canvas-w={shell.canvasWidth}
      style={frameStyle}
    >
      {/*
        THE APPBAR IS THE FRAME'S TOP LINE, full width. Decision 5 moved the
        chat into the middle of the window; a bar over one column of three is
        not a bar, it is a header on the wrong pane. One row across all three
        regions, on sheet 10's 44px rung like every header in the frame.
      */}
      <header className="shell-appbar" data-testid="shell-appbar">
        {appbar ?? (
          <span className="shell-title">
            Sequence
            {/*
              * THE REPOSITORY, NAMED AND CHANGEABLE — owner walk A1.
              *
              * "Attach a repository" has always been in the Cmd/Ctrl-K
              * palette and the chord has always been bound. What did not
              * exist was anything on screen saying so. This dispatches the
              * SAME overlay the palette command dispatches, so there is one
              * attach flow with two doors rather than two flows that drift
              * apart — and at the no-board boot it is the door that matters,
              * because there is no board empty-state to offer it yet.
              */}
            <span className="shell-repo-wrap" ref={repoWrapRef}>
              <button
                type="button"
                className="shell-repo"
                data-testid="shell-repo"
                aria-haspopup={repoName ? 'menu' : undefined}
                aria-expanded={repoName ? repoMenuOpen : undefined}
                title={
                  repoName
                    ? `${repoName} — Leave or open another`
                    : 'Attach a repository'
                }
                onClick={() => {
                  if (!repoName) {
                    onOverlay({ kind: 'attach' });
                    return;
                  }
                  setRepoMenuOpen((open) => !open);
                }}
              >
                {repoName ?? 'Open a repository'}
              </button>
              {repoName && repoMenuOpen && repoMenuPos
                ? createPortal(
                    <div
                      ref={repoMenuRef}
                      className="shell-repo-menu shell-repo-menu-portal"
                      role="menu"
                      data-testid="shell-repo-menu"
                      style={{ top: repoMenuPos.top, left: repoMenuPos.left }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="shell-repo-item"
                        data-testid="shell-repo-leave"
                        onClick={() => {
                          setRepoMenuOpen(false);
                          onCommand?.('repo.detach');
                        }}
                      >
                        Leave project
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="shell-repo-item"
                        data-testid="shell-repo-open-another"
                        onClick={() => {
                          setRepoMenuOpen(false);
                          onOverlay({ kind: 'attach' });
                        }}
                      >
                        Open another repository
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </span>
          </span>
        )}
        {workspaceChrome}
        <span className="shell-acts" ref={moreRef}>
          {/* ══ THE CHORD, SAID OUT LOUD ══════════════════════════════════

              Cmd/Ctrl-K opens the only command surface in the product. The
              hint keeps its place on the slimmed bar: repo, the chord, More.
              Pane minimise lives on the pane cards; dock icons re-expand. */}
          <button
            type="button"
            className="shell-hint"
            data-testid="shell-palette-hint"
            title="Open the command palette"
            onClick={() => setPaletteOpen(true)}
          >
            {paletteHint()}
          </button>

          {/*
            * THE VISIBLE DOOR the collapsed panels sit behind. Sessions is a
            * sidebar pane now — not also a More overlay that doubles it.
            */}
          <button
            type="button"
            className="shell-btn"
            data-testid="shell-more"
            aria-expanded={moreOpen}
            aria-controls="shell-more-panels"
            title="Runs, rewind and settings"
            onClick={() => setMoreOpen((open) => !open)}
          >
            More
          </button>

          {moreOpen ? (
            <span className="shell-more-panels" id="shell-more-panels" data-testid="shell-more-panels">
              {SHELL_PANELS.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className="shell-btn"
                  data-testid={`shell-open-${panel.id}`}
                  title={panel.title}
                  /* Closing on open: leaving the group expanded behind an
                     overlay would put stale chrome under the thing the
                     reader just asked for. */
                  onClick={() => {
                    setMoreOpen(false);
                    onOverlay(panel.overlay);
                  }}
                >
                  {panel.label}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      </header>

      {tabLayout ? (
        <main className="shell-workspace" data-testid="shell-workspace">
          {tabWorkspace}
        </main>
      ) : null}

      {/* ── LEFT: the sessions sidebar ────────────────────────────────────
          A persistent pane at wide breakpoints, an overlay behind its toggle
          word below that — the existing mode machinery, unchanged. Absent
          entirely when the host supplies nothing for it. Minimised → dock
          icon (not vanished, not an appbar twin). */}
      {!tabLayout && sessions !== undefined && shell.rail.mode !== 'hidden' ? (
        <aside
          className="shell-pane shell-sessions"
          data-testid="shell-sessions"
          data-mode={shell.rail.mode}
          aria-label={sessionsTitle}
        >
          {paneHeader('sessions', sessionsTitle, {
            hideLabel: `Hide ${sessionsTitle.toLowerCase()}`,
            onToggle: () => onTogglePane('rail'),
          })}
          <div className="shell-pane-body">{sessions}</div>
        </aside>
      ) : null}
      {!tabLayout && sessions !== undefined && shell.rail.mode === 'hidden' ? (
        <button
          type="button"
          className="shell-pane-dock shell-pane-dock-sessions"
          data-testid="shell-dock-sessions"
          aria-label={`Show ${sessionsTitle.toLowerCase()}`}
          title={`Show ${sessionsTitle.toLowerCase()}`}
          onClick={() => onTogglePane('rail')}
        >
          <Icon name="newthread" size={14} />
        </button>
      ) : null}

      {/* ── CENTRE: the chat (beside the board when the workspace is open) */}
      {!tabLayout && shell.chat.mode !== 'hidden' ? (
        <aside
          className="shell-pane shell-chat"
          data-testid="shell-chat"
          data-mode={shell.chat.mode}
          data-fill={!boardMounted ? 'frame' : undefined}
          aria-label={chatTitle}
        >
          {paneHeader('chat', chatTitle, {
            hideLabel: `Hide ${chatTitle.toLowerCase()}`,
            onToggle: () => onTogglePane('chat'),
          })}
          <div className="shell-pane-body">{chat}</div>
        </aside>
      ) : !tabLayout ? (
        <button
          type="button"
          className="shell-pane-dock shell-pane-dock-chat"
          data-testid="shell-dock-chat"
          aria-label={`Show ${chatTitle.toLowerCase()}`}
          title={`Show ${chatTitle.toLowerCase()}`}
          onClick={() => onTogglePane('chat')}
        >
          <Icon name="topic" size={14} />
        </button>
      ) : null}

      {/* ── RIGHT: the board pane when Architecture/Whiteboard is open.
           Minimise (shared minus) docks it without detaching the repo —
           owner P2.5: minimise any pane. */}
      {!tabLayout && boardMounted ? (
        <aside
          className="shell-pane shell-rail"
          data-testid="shell-rail"
          aria-label={railTitle}
        >
          <header className="shell-pane-hd" data-testid="shell-rail-head">
            {railHeader ?? (
              <span className="shell-pane-title" data-testid="shell-rail-title">
                <Icon name={boardIdentityMark} size={14} />
                <span className="shell-pane-title-text">{railTitle}</span>
              </span>
            )}
            {onMinimizeBoard ? (
              <span className="shell-acts">
                <button
                  type="button"
                  className="shell-btn shell-ghost shell-icon-btn"
                  data-testid="shell-rail-close"
                  aria-label={`Hide ${railTitle.toLowerCase()}`}
                  title={`Hide ${railTitle.toLowerCase()}`}
                  onClick={onMinimizeBoard}
                >
                  <Icon name="minus" size={14} />
                </button>
              </span>
            ) : null}
          </header>
          <div className="shell-pane-body">{rail}</div>
        </aside>
      ) : null}
      {!tabLayout && boardDocked && onRestoreBoard ? (
        <button
          type="button"
          className="shell-pane-dock shell-pane-dock-board"
          data-testid="shell-dock-board"
          aria-label={`Show ${railTitle.toLowerCase()}`}
          title={`Show ${railTitle.toLowerCase()}`}
          onClick={onRestoreBoard}
        >
          <Icon name={boardIdentityMark} size={14} />
        </button>
      ) : null}

      {/* A resizer exists only where there is a border to move. An overlay
          pane floats over the workspace: it has no column edge, so it has no
          drag handle. The sessions handle sits on the sidebar|chat border;
          the chat handle sits on the chat|board border. */}
      {!tabLayout && shell.rail.mode === 'column' && sessions !== undefined ? (
        <PaneResizer
          pane="rail"
          width={layout.railWidth}
          min={tokens.rail.min}
          max={tokens.rail.max}
          dragging={shell.dragging === 'rail'}
          label={`Resize the ${sessionsTitle.toLowerCase()} column`}
          onResize={(width) => onResizePane('rail', width)}
          onDragStart={() => onDragPane('rail')}
          onDragEnd={() => onDragPane(null)}
        />
      ) : null}

      {!tabLayout && shell.chat.mode === 'column' && boardMounted ? (
        <PaneResizer
          pane="chat"
          width={layout.chatWidth}
          min={tokens.chat.min}
          max={tokens.chat.max}
          dragging={shell.dragging === 'chat'}
          label={`Resize the ${chatTitle.toLowerCase()} column`}
          onResize={(width) => onResizePane('chat', width)}
          onDragStart={() => onDragPane('chat')}
          onDragEnd={() => onDragPane(null)}
        />
      ) : null}

      {paletteOpen ? (
        <CommandSurface
          commands={SHELL_COMMANDS}
          unavailableReason={unavailableReason}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {/*
        THE ONE OVERLAY HOST. `ShellSlice.overlay` is a single nullable member
        rather than a boolean per surface because "two open at once is not a
        state the shell has a layout for", and this is where that becomes a
        fact on screen: every overlay in the product — the attach dialog the
        board and the boot surface both ask for, settings, sessions, review —
        arrives through this one element. `e2e/shell-overlay.mjs` asserts the
        attach dialog is INSIDE it, which is what separates "a dialog appeared"
        from "the shell is the thing that opened it".

        THE HOST CARRIES NO role="dialog", AND THAT IS THE FIX RATHER THAN A
        REGRESSION. It used to, back when `renderOverlay` was supplied by
        nobody and the branch could not run. It runs now, and every overlay the
        product actually has declares its own role on its own root —
        `AttachDialog.tsx` renders `role="dialog" aria-label="Open a
        repository"`. A wrapper repeating it would put a nameless dialog around
        a named one, and a screen reader would meet the same surface twice. The
        host positions and scrims; the content says what it is.
      */}
      {shell.overlay && renderOverlay ? (
        <div
          className="shell-scrim"
          data-testid="shell-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onOverlay(null);
          }}
        >
          {/* THE `role="dialog"` PROMISE, KEPT. Four of five overlays declared
              that role and none managed focus, so Tab walked out of the dialog
              into the board behind the scrim and Escape left the next Tab
              starting from the top of the page.

              `tabindex={-1}` is required by `focusFirst`'s fallback: a dialog
              whose content holds nothing focusable still has to take focus, or
              the reader stays behind the scrim. */}
          <div className="shell-dialog" ref={dialogRef} tabIndex={-1}>
            {renderOverlay(shell.overlay, () => onOverlay(null))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
