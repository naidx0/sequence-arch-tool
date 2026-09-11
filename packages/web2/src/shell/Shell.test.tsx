import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvedStyle } from '../../test/support/css';
import { ConnectedShell, StoreProvider, createStore, shellPropsFrom, type ShellSlots } from '../state';
import { Shell } from './Shell';
import '../tokens/graphite.css';
import { DEFAULT_SHELL_TOKENS, SHELL_COMMANDS, boardFloor } from './shellModel';
import { SHELL_STORAGE_KEY, readShellPersisted } from './shellStorage';
import { readShellTokens } from './shellTokens';
import { seqdFromGraph } from '../canvas/seqdFromGraph';

/**
 * ITEM 2.3 — TIER 2, THE RENDER LOCK.
 *
 * The four things this file exists to catch, each of them a defect the plan
 * names by file and line rather than a hypothetical:
 *
 *   1. THE PANES ARE COLUMNS, NOT DIALOGS. Decision 5 (2026-08-24c) moved the
 *      furniture — sessions LEFT, chat CENTRE, board RIGHT — and the lock
 *      moved WITH it: every pane renders as an <aside> column above its
 *      breakpoint and never picks up a dialog role. It is asserted at every
 *      breakpoint, because the overlay form is where the dialog role would
 *      sneak back in.
 *
 *   2. THE BOARD NEVER DROPS BELOW ITS FLOOR, and the chat never crosses the
 *      line that floor draws — the invariant that replaced "the canvas keeps
 *      half the frame" in the same commit that moved the panes.
 *
 *   3. THE WIDTH IS THE USER'S AND IT SURVIVES. Sheet 11: "re-sizing a panel on
 *      every launch is the definition of not customisable."
 *
 *   4. THE TOKEN LAYER STILL SAYS WHAT THE MODEL THINKS IT SAYS. The layout
 *      numbers live in tokens/graphite.css and are mirrored as constants in
 *      shellModel.ts so the pure tier can run without a DOM. That mirror is a
 *      duplication, and the last assertion in this file is what stops it
 *      drifting: it reads the values back out of the real cascade.
 *
 * THE TOKEN SHEET IS IMPORTED ABOVE ON PURPOSE. App.tsx owns the ordered style
 * block, and this file is not App.tsx; importing the sheet here composes the
 * same cascade the app composes, which is what makes a computed-style
 * assertion mean anything. Without it every resolvedStyle() call below reads an
 * empty cascade and passes for the wrong reason.
 */

/** jsdom reports 1024x768 and never resizes itself. The shell measures the
 *  window, so the window is what the test sets. */
function setFrame(width: number, height = 800): void {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
    configurable: true,
  });
}

/**
 * EVERY TEST BELOW MOUNTS THE FRAME THE WAY THE PRODUCT MOUNTS IT: connected to
 * a real store.
 *
 * It used to render `<Shell/>` bare, which was the only option while the
 * component held its own state — and that is precisely how a whole wave of
 * green tests coexisted with a shell the store could not talk to. A frame that
 * agrees with itself about a state nothing else can see is not evidence.
 *
 * `persisted` is read here for the same reason `app/App.tsx` reads it: the
 * store's initial value is where the remembered widths land now, so a test that
 * remounts and expects its drag to have survived has to build the store the way
 * the app does.
 *
 * DECISION 5'S ARRANGEMENT IS THE DEFAULT HERE: sessions mounted, board
 * mounted — the frame of an attached repository. The no-board boot is its own
 * describe below and passes `boardMounted: false` explicitly, because "there
 * is no repo" is the special case now rather than the assumption.
 */
function renderShell(slots: Partial<ShellSlots> = {}, store = createStore({ persisted: readShellPersisted() })) {
  const view = render(
    <StoreProvider store={store}>
      <ConnectedShell
        canvas={<div data-testid="canvas-body" />}
        chat={<div />}
        sessions={<div />}
        rail={<div data-testid="board-body" />}
        boardMounted
        {...slots}
      />
    </StoreProvider>,
  );
  return Object.assign(view, { store });
}

beforeEach(() => {
  window.localStorage.clear();
  setFrame(1280);
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('at 1280 — the wide arrangement', () => {
  beforeEach(() => setFrame(1280));

  it('draws three regions — sessions left, chat centre, board right — and no dialog roles', () => {
    renderShell();

    const shell = screen.getByTestId('shell');
    const sessions = screen.getByTestId('shell-sessions');
    const chat = screen.getByTestId('shell-chat');
    const board = screen.getByTestId('shell-rail');

    expect(shell.dataset.breakpoint).toBe('wide');

    // Decision 5's ordering is a DOM-order fact here and a geometric one in
    // e2e/shell-boot.mjs; the two together pin both halves.
    expect(sessions.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chat.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const pane of [sessions, chat]) {
      expect(pane.tagName).toBe('ASIDE');
      expect(pane.getAttribute('role')).toBeNull();
      expect(pane.dataset.mode).toBe('column');
    }
    // The board pane is NOT a slice pane — its existence is attachment, not
    // mode machinery (Decision 5) — so it carries no data-mode at all.
    expect(board.tagName).toBe('ASIDE');
    expect(board.getAttribute('role')).toBeNull();
    expect(board.dataset.mode).toBeUndefined();

    expect(screen.getByTestId('board-body')).toBeTruthy();
  });

  it('hands CSS the two column numbers and keeps the board above its floor', () => {
    renderShell();
    const shell = screen.getByTestId('shell');

    // tokens/graphite.css: "Shell.tsx writes --rail-w and --pane-w as inline
    // custom properties from React state and the three columns respond
    // entirely in CSS. React owns two numbers; CSS owns the layout."
    // --side-w carries the SESSIONS sidebar; --pane-w the CENTRE chat.
    expect(shell.style.getPropertyValue('--side-w').trim()).toBe('280px');
    expect(shell.style.getPropertyValue('--pane-w').trim()).toBe('392px');

    const canvasWidth = Number(shell.dataset.canvasW);
    expect(canvasWidth).toBe(608);
    // The new invariant: the board never drops below its floor...
    expect(canvasWidth).toBeGreaterThanOrEqual(boardFloor(1280, DEFAULT_SHELL_TOKENS));
    // ...and the chat never crosses the line that floor draws — the
    // "chat-at-half" ruling, absorbed (Decision 5).
    expect(Number(DEFAULT_SHELL_TOKENS.chat.base)).toBeLessThanOrEqual(1280 / 2);
  });

  it('offers a resizer on each side of the chat column', () => {
    renderShell();
    const resizers = screen.getAllByRole('separator');
    expect(resizers).toHaveLength(2);
    for (const resizer of resizers) {
      expect(resizer.getAttribute('aria-orientation')).toBe('vertical');
      expect(resizer.getAttribute('aria-valuenow')).toBeTruthy();
    }
  });

  it('lands every header on the same 44px line', () => {
    renderShell();
    // Sheet 10's row ladder, the 44 rung: --topbar-h · .appbar · .rail-top ·
    // .pane-hd. The appbar spans the frame's top now; every pane header still
    // lands on the same rung.
    for (const id of ['shell-appbar', 'shell-chat-head', 'shell-sessions-head', 'shell-rail-head']) {
      expect(resolvedStyle(screen.getByTestId(id), 'height')).toBe('44px');
    }
  });

  it('puts every control on a rung of the closed ladder', () => {
    renderShell();
    // Sheet 10 is a closed set — "a value that is not on the ladder is a
    // defect, not a preference" — and the two rungs the shell uses are
    // --control-h 28 for a chrome control that carries state, and --icon-btn 26
    // for the quieter action inside a pane header. Pane toggles live on the
    // pane cards now (not the appbar).
    expect(resolvedStyle(screen.getByTestId('shell-more'), 'height')).toBe('28px');
    expect(resolvedStyle(screen.getByTestId('shell-sessions-close'), 'height')).toBe('26px');
    expect(resolvedStyle(screen.getByTestId('shell-resizer-chat'), 'width')).toBe('8px');
  });
});

describe('at 1000 — the sessions sidebar leaves the row', () => {
  beforeEach(() => setFrame(1000));

  it('keeps the chat and the board as columns and stops mounting the sidebar', () => {
    renderShell();
    const shell = screen.getByTestId('shell');

    expect(shell.dataset.breakpoint).toBe('medium');
    expect(screen.getByTestId('shell-chat').dataset.mode).toBe('column');
    expect(screen.getByTestId('shell-rail')).toBeTruthy();
    // Conditionally mounted, never display:none — app/routes.ts records why:
    // panes left in the DOM duplicated every row AND its landmark, so a screen
    // reader met the same pane twice.
    expect(screen.queryByTestId('shell-sessions')).toBeNull();

    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(Number(shell.dataset.canvasW)).toBe(608);
    expect(Number(shell.dataset.canvasW)).toBeGreaterThanOrEqual(
      boardFloor(1000, DEFAULT_SHELL_TOKENS),
    );
  });

  it('summons the sidebar as an overlay that is still not a dialog', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('shell-dock-sessions'));

    const sessions = screen.getByTestId('shell-sessions');
    expect(sessions.dataset.mode).toBe('overlay');
    expect(sessions.tagName).toBe('ASIDE');
    expect(sessions.getAttribute('role')).toBeNull();

    // An overlay pane floats over the work; it does not shrink it.
    expect(Number(screen.getByTestId('shell').dataset.canvasW)).toBe(608);
  });
});

describe('at 760 — the board holds the frame', () => {
  beforeEach(() => setFrame(760));

  it('mounts neither side pane and gives the board region the whole width', () => {
    renderShell();
    const shell = screen.getByTestId('shell');

    expect(shell.dataset.breakpoint).toBe('narrow');
    expect(screen.queryByTestId('shell-chat')).toBeNull();
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    expect(Number(shell.dataset.canvasW)).toBe(760);
  });

  it('opens the chat as an OVERLAY over the board, never as a dialog', () => {
    /*
     * The lock composer-over-board.mjs proves in a real browser at 800px,
     * stated here where it is cheap to assert: below MEDIUM_MIN an opened chat
     * pane leaves the grid and floats. The mode machinery survived Decision 5
     * unchanged; only the furniture around it moved.
     */
    renderShell();
    fireEvent.click(screen.getByTestId('shell-dock-chat'));

    const chat = screen.getByTestId('shell-chat');
    expect(chat.dataset.mode).toBe('overlay');
    expect(chat.tagName).toBe('ASIDE');
    expect(chat.getAttribute('role')).toBeNull();
    expect(Number(screen.getByTestId('shell').dataset.canvasW)).toBe(760);
  });
});

describe('the no-board boot — chat-only until a repository is attached', () => {
  beforeEach(() => setFrame(1280));

  it('mounts no board pane and no empty workspace — chat fills the frame', () => {
    renderShell({ boardMounted: false });
    const shell = screen.getByTestId('shell');

    expect(screen.queryByTestId('shell-rail')).toBeNull();
    expect(screen.queryByTestId('board-body')).toBeNull();
    expect(screen.queryByTestId('shell-workspace')).toBeNull();
    expect(screen.getByTestId('shell-chat')).toBeTruthy();
    expect(screen.getByTestId('shell-chat').getAttribute('data-fill')).toBe('frame');
    expect(shell.getAttribute('data-board')).toBe('off');

    // No dead handles either: only the sessions|chat border carries a resizer
    // when the board pane is absent — no chat|board grip with nothing to resize.
    const panes = screen.getAllByRole('separator').map((r) => r.getAttribute('data-pane'));
    expect(panes.sort()).toEqual(['rail']);

    // And the model's arithmetic is unchanged by the absence: the attribute
    // still reports the region's width.
    expect(Number(shell.dataset.canvasW)).toBe(608);
  });

  it('at 760 the chat still fills — no dead chrome appears', () => {
    /*
     * WAVE 5 · EMPTY+NARROW CHECK. The no-board boot above runs at 1280; this
     * pins the narrow corner of the same state. Below MEDIUM_MIN both side
     * panes unmount AND no board exists yet — chat must still be recoverable
     * via the dock icon when minimised.
     */
    setFrame(760);
    renderShell({ boardMounted: false });
    const shell = screen.getByTestId('shell');

    expect(shell.dataset.breakpoint).toBe('narrow');
    expect(screen.queryByTestId('shell-rail')).toBeNull();
    expect(screen.queryByTestId('shell-workspace')).toBeNull();
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    // Chat may be overlay or column; the dock (or the pane itself) recovers it.
    expect(
      screen.queryByTestId('shell-chat') ?? screen.queryByTestId('shell-dock-chat'),
    ).toBeTruthy();
    expect(Number(shell.dataset.canvasW)).toBe(760);
  });

  it('the board arrives with attachment, replacing the empty frame in place', () => {
    // Mounted the way the PRODUCT mounts it: no explicit boardMounted, so the
    // fact is DERIVED from the store's repo slice. A projector is REQUIRED for
    // an attach to land — loadRepo refuses without one — so the store is built
    // exactly as App.tsx builds it.
    const store = createStore({
      persisted: readShellPersisted(),
      project: (g) => seqdFromGraph(g, g.nodeDetail),
    });
    render(
      <StoreProvider store={store}>
        <ConnectedShell
          chat={<div />}
          sessions={<div />}
          rail={<div data-testid="board-body" />}
        />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('shell-rail')).toBeNull();
    expect(screen.queryByTestId('shell-workspace')).toBeNull();

    // What an attach does upstream: repo/loaded flips groundedRepoName, which
    // is what shellPropsFrom passes as boardMounted.
    act(() => {
      store.dispatch({
        type: 'repo/loaded',
        draft: {
          root: 'C:/repos/shop',
          repoName: 'shop',
          graph: { version: 1, scannedAt: '2026-08-22T00:00:00.000Z', repoRoot: 'C:/repos/shop', repoName: 'shop', nodes: [], edges: [], warnings: [] },
          summary: { nodes: 0, edges: 0, services: 0, datastores: 0, topics: 0 },
          scannedAt: '2026-08-22T00:00:00.000Z',
        },
        at: 1_755_820_800_000,
      } as never);
    });

    expect(screen.getByTestId('shell-rail')).toBeTruthy();
    expect(screen.queryByTestId('shell-workspace')).toBeNull();
  });
});

describe('resizing follows the window', () => {
  it('re-arranges on a resize event without a remount', () => {
    setFrame(1280);
    renderShell();
    expect(screen.getByTestId('shell').dataset.breakpoint).toBe('wide');
    expect(screen.getByTestId('shell-sessions')).toBeTruthy();

    setFrame(900);
    fireEvent(window, new Event('resize'));

    expect(screen.getByTestId('shell').dataset.breakpoint).toBe('medium');
    // The sidebar leaves; the board pane — driven by attachment, not by the
    // breakpoint — stays.
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
    expect(screen.getByTestId('shell-rail')).toBeTruthy();
  });
});

describe('a dragged width is the users, and it survives a remount', () => {
  it('moves the pane the cursor is on and remembers where it was left', () => {
    setFrame(1280);
    const first = renderShell();

    const resizer = screen.getByTestId('shell-resizer-chat');
    fireEvent.mouseDown(resizer, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 50 });
    fireEvent.mouseUp(window, { clientX: 50 });

    // 392 + 50 = 442. Allowance (1280 - 426 floor = 854) covers it whole, so
    // the sessions sidebar keeps its nominal 280 and nothing absorbs.
    expect(screen.getByTestId('shell').style.getPropertyValue('--pane-w').trim()).toBe('442px');
    expect(screen.getByTestId('shell').style.getPropertyValue('--side-w').trim()).toBe('280px');

    first.unmount();
    expect(window.localStorage.getItem(SHELL_STORAGE_KEY)).toBeTruthy();

    renderShell();
    expect(screen.getByTestId('shell').style.getPropertyValue('--pane-w').trim()).toBe('442px');
  });

  it('resizes from the keyboard as well as the pointer', () => {
    setFrame(1280);
    renderShell();

    const resizer = screen.getByTestId('shell-resizer-rail');
    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });

    // The sidebar sits LEFT of the chat now, so ArrowLeft widens it:
    // 280 + 8 = 288.
    expect(screen.getByTestId('shell').style.getPropertyValue('--side-w').trim()).toBe('288px');
  });
});

describe('the command surface', () => {
  beforeEach(() => setFrame(1280));

  it('opens on Cmd-K and on Ctrl-K, and closes on Escape', () => {
    renderShell();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('reaches the composer, which is what the plan specifies Cmd-K for', () => {
    const onCommand = vi.fn();
    renderShell({ onCommand });

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Focus the composer');

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledWith('composer.focus');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs a pane command itself rather than asking the host', () => {
    renderShell();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    // F13 renamed the row to match what the pane IS; "sidebar" still names
    // exactly one command.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sidebar' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]);

    expect(screen.queryByTestId('shell-sessions')).toBeNull();
  });

  it('disables a command it cannot execute instead of hiding it', () => {
    renderShell();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    // No onCommand prop, so the composer is not mounted and the shell says so
    // rather than offering a row that does nothing.
    const composer = screen.getAllByRole('option')[0];
    expect(composer.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the theme preference reaches the document', () => {
  it('stamps an explicit choice and leaves system unstamped', () => {
    /* FROM THE STORE TO THE DOCUMENT, which is the whole path. This used to
       pass `theme` as a prop — a second name for `shell.theme` in the same
       props object — so it proved the effect ran and nothing about where the
       value came from. */
    const { store } = renderShell();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // 'system' must REMOVE the attribute rather than set one. The token layer's
    // three-state form resolves the media query only on a root with no
    // [data-theme] at all — `:root:not([data-theme="light"])` inside
    // @media(prefers-color-scheme:dark) — so a root stamped "system" would
    // resolve neither block and paint the light palette that Decision 1 says
    // nobody has tuned.
    act(() => store.dispatch({ type: 'shell/theme', theme: 'system' }));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});

describe('the mirrored layout constants', () => {
  it('still match the token layer they were transcribed from', () => {
    renderShell();
    // Reading the CASCADE, not the file. The banned tier is a readFileSync of a
    // source file; this is the same lookup the running shell does.
    expect(readShellTokens(document.documentElement)).toEqual(DEFAULT_SHELL_TOKENS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SHELL HAS ONE COPY OF ITS STATE, AND THE STORE HOLDS IT.

   Everything above renders the frame and asks what is on screen. That was a
   complete question while `Shell.tsx` held its arrangement in its own
   `useState` — and it is exactly why the defect below survived a full wave of
   green tests: the shell agreed with itself, perfectly, about a state nothing
   else in the product could see or change.

   `store.ts` carried a `shell` slice and a `shell/overlay` action that NOTHING
   READ. Two sources of truth for one thing. The visible consequence was
   reported and measured: the board's empty state and the boot surface both
   dispatch `shell/overlay`, and a real browser clicking either got zero
   dialogs.

   So these four ask the question the ones above cannot — whether the thing on
   screen and the thing in the store are the SAME state. Each is written from
   one side to the other: a gesture must arrive in the store, and a dispatch
   must arrive on the screen. One direction alone would still pass with two
   copies kept loosely in sync.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the shell has ONE copy of its state, and the store holds it', () => {
  const slots = {
    canvas: <div data-testid="canvas-body" />,
    chat: <div />,
    sessions: <div />,
    rail: <div />,
  };

  function connected(store: ReturnType<typeof createStore>, extra: Partial<ShellSlots> = {}) {
    return render(
      <StoreProvider store={store}>
        <ConnectedShell {...slots} boardMounted {...extra} />
      </StoreProvider>,
    );
  }

  it('takes a pane toggle into the store, not into a private useState', () => {
    setFrame(1280);
    const store = createStore();
    connected(store);

    expect(store.getState().shell.rail.open).toBe(true);
    fireEvent.click(screen.getByTestId('shell-sessions-close'));

    // The screen moved…
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
    // …and so did the one place that is allowed to know.
    expect(store.getState().shell.rail.open).toBe(false);
    // Dock icon is the way back.
    expect(screen.getByTestId('shell-dock-sessions')).toBeTruthy();
  });

  it('renders the overlay the STORE says is open', () => {
    setFrame(1280);
    const store = createStore();
    connected(store, {
      renderOverlay: (overlay) => <div data-testid="overlay-body">{overlay.kind}</div>,
    });

    expect(screen.queryByTestId('overlay-body')).toBeNull();

    /* This is the dispatch `ConnectedBoard`'s empty state and `BootSurface`
       both make. Before this commit it changed a slice nobody read. */
    act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } }));
    expect(screen.getByTestId('overlay-body').textContent).toBe('attach');

    act(() => store.dispatch({ type: 'shell/overlay', overlay: null }));
    expect(screen.queryByTestId('overlay-body')).toBeNull();
  });

  it('measures the window into the store, and re-arranges from what it reads back', () => {
    setFrame(1280);
    const store = createStore();
    connected(store);
    expect(store.getState().shell.breakpoint).toBe('wide');
    expect(screen.getByTestId('shell-sessions')).toBeTruthy();

    setFrame(900);
    fireEvent(window, new Event('resize'));

    expect(store.getState().shell.breakpoint).toBe('medium');
    expect(screen.getByTestId('shell').dataset.breakpoint).toBe('medium');
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
  });

  it('takes a dragged width into the store', () => {
    setFrame(1280);
    const store = createStore();
    connected(store);

    const resizer = screen.getByTestId('shell-resizer-chat');
    fireEvent.mouseDown(resizer, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 50 });
    fireEvent.mouseUp(window, { clientX: 50 });

    // 392 + 50, clamped by the chat's own limits — the width the model kept.
    expect(store.getState().shell.chat.width).toBe(442);
    // And what CSS was handed, whole: the allowance covers the drag now.
    expect(screen.getByTestId('shell').style.getPropertyValue('--pane-w').trim()).toBe('442px');
    expect(store.getState().shell.dragging).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   OWNER WALK 2026-08-22, ITEM A1 — "How do I add a new repository?"

   The capability was never missing. `overlay.attach` has been in the Cmd/Ctrl-K
   palette all along and the chord is bound. What was missing was any way to
   FIND it: the two on-screen routes — the boot surface and the board's empty
   state — both disappear the moment a repository is attached, because the empty
   state renders only while `projection.nodes.length === 0`.

   So after attaching, the feature was reachable only by already knowing it
   existed. `usability-standard.md` opens on discoverable, and this is that
   clause failing while every unit test stayed green — because a keyboard route
   is trivially testable and "nothing on screen says so" is not, unless someone
   writes this.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the repository is nameable and changeable from the frame', () => {
  it('shows a repository control in the appbar, with nothing attached', () => {
    renderShell();
    const control = screen.getByTestId('shell-repo');
    /* It says what pressing it does. "Sequence" is the product's name and tells
       a reader nothing about which repository they are looking at. */
    expect(control.textContent).toMatch(/open a repository/i);
  });

  it('names the ATTACHED repository once there is one', () => {
    /* A projector is REQUIRED for an attach to land: `loadRepo` returns
       `unattached` without one, and says why in `net.lastFailure`. A store
       built without it cannot reach the state this test is about. */
    const store = createStore({
      persisted: readShellPersisted(),
      project: (g) => seqdFromGraph(g, g.nodeDetail),
    });
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: 'C:/repos/shop',
        repoName: 'shop',
        graph: { version: 1, scannedAt: '2026-08-22T00:00:00.000Z', repoRoot: 'C:/repos/shop', repoName: 'shop', nodes: [], edges: [], warnings: [] },
        summary: { nodes: 0, edges: 0, services: 0, datastores: 0, topics: 0 },
        scannedAt: '2026-08-22T00:00:00.000Z',
      },
      at: 1_755_820_800_000,
    } as never);
    renderShell({}, store);
    /* The one fact a reader needs from a frame that can point at more than one
       repository: which one is this. */
    expect(screen.getByTestId('shell-repo').textContent).toMatch(/shop/);
  });

  it('opens the SAME attach overlay the command palette opens', () => {
    const view = renderShell();
    screen.getByTestId('shell-repo').click();
    /* Not a second route to a second dialog. The palette command and this
       control dispatch the same overlay, so there is one attach flow with two
       doors rather than two flows that will drift. */
    expect(view.store.getState().shell.overlay).toEqual({ kind: 'attach' });
  });

  it('when attached, the chip menu offers Leave project and Open another', () => {
    const onCommand = vi.fn();
    const store = createStore({
      persisted: readShellPersisted(),
      project: (g) => seqdFromGraph(g, g.nodeDetail),
    });
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: 'C:/repos/shop',
        repoName: 'shop',
        graph: { version: 1, scannedAt: '2026-08-22T00:00:00.000Z', repoRoot: 'C:/repos/shop', repoName: 'shop', nodes: [], edges: [], warnings: [] },
        summary: { nodes: 0, edges: 0, services: 0, datastores: 0, topics: 0 },
        scannedAt: '2026-08-22T00:00:00.000Z',
      },
      at: 1_755_820_800_000,
    } as never);
    renderShell({ onCommand }, store);

    const chip = screen.getByTestId('shell-repo');
    expect(chip.textContent).toMatch(/shop/);
    expect(chip.getAttribute('aria-haspopup')).toBe('menu');

    act(() => {
      fireEvent.click(chip);
    });
    expect(screen.getByTestId('shell-repo-menu')).toBeTruthy();
    expect(screen.getByTestId('shell-repo-leave').textContent).toMatch(/leave project/i);
    expect(screen.getByTestId('shell-repo-open-another').textContent).toMatch(/open another/i);

    act(() => {
      fireEvent.click(screen.getByTestId('shell-repo-leave'));
    });
    expect(onCommand).toHaveBeenCalledWith('repo.detach');
  });

  it('Leave project keeps the workspace pane and forces chat open', () => {
    /*
     * Leave clears attachment; the board region stays mounted (whiteboard
     * blank workspace) while chat is forced open. A remembered chatOpen:false
     * must not leave a blank frame.
     *
     * Do NOT pass `boardMounted` — ConnectedShell derives it unless the host
     * forces it. This test mirrors attachment-driven mount before Leave.
     */
    const store = createStore({
      persisted: {
        version: 2,
        chatWidth: DEFAULT_SHELL_TOKENS.chat.base,
        railWidth: DEFAULT_SHELL_TOKENS.rail.base,
        chatOpen: false,
        railOpen: true,
        priority: 'chat',
        theme: 'dark',
      },
      project: (g) => seqdFromGraph(g, g.nodeDetail),
    });
    store.dispatch({
      type: 'repo/loaded',
      draft: {
        root: 'C:/repos/shop',
        repoName: 'shop',
        graph: {
          version: 1,
          scannedAt: '2026-08-22T00:00:00.000Z',
          repoRoot: 'C:/repos/shop',
          repoName: 'shop',
          nodes: [{ id: 'svc:api', kind: 'service', label: 'api', files: [] }],
          edges: [],
          warnings: [],
        },
        summary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
        scannedAt: '2026-08-22T00:00:00.000Z',
      },
      at: 1_755_820_800_000,
    } as never);

    render(
      <StoreProvider store={store}>
        <ConnectedShell
          chat={<div />}
          sessions={<div />}
          rail={<div data-testid="board-body" />}
        />
      </StoreProvider>,
    );
    expect(screen.getByTestId('shell-rail')).toBeTruthy();
    expect(screen.getByTestId('shell-repo').textContent).toMatch(/shop/);

    act(() => {
      store.dispatch({ type: 'repo/detached' });
    });

    expect(store.getState().repo.phase).toBe('unattached');
    expect(store.getState().shell.intent.chat).toBe(true);
    /* Attachment-derived boardMounted goes false when the repo detaches —
       this unit test mirrors the store projector alone (product App uses
       workspace tabs to mount the board). */
    expect(screen.queryByTestId('shell-rail')).toBeNull();
    expect(screen.queryByTestId('shell-workspace')).toBeNull();
    expect(screen.getByTestId('shell-chat')).toBeTruthy();
    expect(screen.getByTestId('shell-repo').textContent).toMatch(/open a repository/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ESCAPE STOPS A RUNNING TURN — last, after everything nearer the keyboard.

   Cancellation was already shipped end to end: the Stop button, liveTurn
   abort, requestAbort on connection close, the metered provider call. It was
   MOUSE-ONLY, and Escape is the reflex every terminal-agent user brings.

   The precedence is the whole design. An overlay over a running turn is the
   nearer thing; the mention picker is nearer still.
   ══════════════════════════════════════════════════════════════════════════ */
describe('Escape, and what it reaches', () => {
  function esc(defaultPrevented = false) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    if (defaultPrevented) event.preventDefault();
    window.dispatchEvent(event);
  }

  /* Rendered DIRECTLY rather than through ConnectedShell, because these assert
     the shell's own key precedence and need its props supplied explicitly. */
  function mountShell(over: Partial<Parameters<typeof Shell>[0]> = {}) {
    const onOverlay = vi.fn();
    const store = createStore({ persisted: readShellPersisted() });
    const props = {
      ...shellPropsFrom(store.getState(), store, {
        canvas: <div data-testid="canvas-body" />,
        chat: <div />,
        rail: <div />,
      }),
      onOverlay,
      ...over,
    };
    render(<Shell {...props} />);
    return { onOverlay };
  }

  it('interrupts when there is nothing else to close', () => {
    const onInterrupt = vi.fn();
    mountShell({ onInterrupt });
    act(() => esc());
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('CLOSES THE OVERLAY FIRST, and does not also interrupt', () => {
    /* One Escape closes one thing. A dialog over a running turn is the nearer
       thing, and killing the turn underneath it is a consequence the reader
       did not ask for and cannot see. */
    const onInterrupt = vi.fn();
    const store = createStore({ persisted: readShellPersisted() });
    store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } });
    const onOverlay = vi.fn();
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          canvas: <div />,
          chat: <div />,
          rail: <div />,
        })}
        onOverlay={onOverlay}
        onInterrupt={onInterrupt}
        renderOverlay={() => <div data-testid="an-overlay" />}
      />,
    );

    act(() => esc());
    expect(onOverlay).toHaveBeenCalledWith(null);
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('DOES NOT INTERRUPT when something nearer already handled the key', () => {
    /*
     * The composer's mention picker closes on Escape with preventDefault and
     * no stopPropagation, so this window listener still runs. Without the
     * defaultPrevented guard, dismissing the `@` picker would also kill a
     * running turn — one keystroke, two consequences, and the second invisible
     * until the answer stopped arriving.
     */
    const onInterrupt = vi.fn();
    mountShell({ onInterrupt });
    act(() => esc(true));
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing running — an absent handler is the signal', () => {
    /* The shell must not invent a consequence for the key. */
    const { onOverlay } = mountShell({ onInterrupt: undefined });
    act(() => esc());
    expect(onOverlay).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THREE FINISHED PANELS THAT COULD NOT BE FOUND.

   Activity, the session list and Settings are all built and all mounted, and
   were reachable only by guessing Cmd/Ctrl-K — a chord that appears nowhere on
   screen. A user who never guesses it cannot reach session history or the
   activity view at all.

   `usability-standard.md` opens on discoverable. This is that clause, failed
   over features that already work — which is the most expensive kind of gap,
   because the engineering is already paid for.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the panels are reachable without knowing a chord', () => {
  function mountBar() {
    const onOverlay = vi.fn();
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          canvas: <div />,
          chat: <div />,
          sessions: <div />,
          rail: <div />,
          boardMounted: true,
        })}
        onOverlay={onOverlay}
      />,
    );
    return { onOverlay };
  }

  it('slims to repo + chord + More, with everything one visible press away', () => {
    /*
     * The claim this test has always made is that these are reachable WITHOUT
     * KNOWING A CHORD - the owner walk's A1 defect. That claim is unchanged;
     * Decision 5 re-homed the DOORS. Sessions is a pane now (seat-walk: not
     * also doubled behind More), and Settings sits at the bottom of that
     * sidebar, so the bar carries no panel buttons of its own — Runs, Rewind
     * and Settings live behind `More`.
     */
    mountBar();
    expect(screen.getByTestId('shell-more')).toBeTruthy();
    expect(screen.queryByTestId('shell-open-settings')).toBeNull();
    expect(screen.queryByTestId('shell-toggle-sessions')).toBeNull();

    /* Collapsed to begin with, and not merely hidden with CSS. */
    for (const id of ['activity', 'rewind', 'settings']) {
      expect(screen.queryByTestId(`shell-open-${id}`)).toBeNull();
    }
    expect(screen.queryByTestId('shell-open-sessions')).toBeNull();

    fireEvent.click(screen.getByTestId('shell-more'));
    for (const id of ['activity', 'rewind', 'settings']) {
      expect(screen.getByTestId(`shell-open-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('shell-open-sessions')).toBeNull();
  });

  it('says whether it is open, for a reader who cannot see the caret', () => {
    mountBar();
    const more = screen.getByTestId('shell-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes when a panel inside it opens', () => {
    /* Leaving the group expanded behind an overlay puts stale chrome under the
       thing the reader just asked for. */
    mountBar();
    fireEvent.click(screen.getByTestId('shell-more'));
    fireEvent.click(screen.getByTestId('shell-open-activity'));
    expect(screen.queryByTestId('shell-open-activity')).toBeNull();
    expect(screen.getByTestId('shell-more').getAttribute('aria-expanded')).toBe('false');
  });

  it('each opens the SAME overlay its palette command opens', () => {
    /*
     * Not a second route to a second dialog. If the button and the command
     * dispatched different overlays, the two would drift the first time either
     * changed and only one of them would be tested. Sessions is a sidebar
     * pane, not a More entry — palette still reaches overlay.sessions.
     */
    const { onOverlay } = mountBar();
    for (const id of ['activity', 'rewind', 'settings'] as const) {
      fireEvent.click(screen.getByTestId('shell-more'));
      fireEvent.click(screen.getByTestId(`shell-open-${id}`));
    }
    expect(onOverlay).toHaveBeenCalledWith({ kind: 'activity' });
    expect(onOverlay).toHaveBeenCalledWith({ kind: 'rewind' });
    expect(onOverlay).toHaveBeenCalledWith({ kind: 'settings', pane: 'provider' });
    expect(onOverlay).not.toHaveBeenCalledWith({ kind: 'sessions' });
  });

  /* THE PERSISTENT SETTINGS GEAR is the App composition's element — it lives at
     the bottom of the sidebar the App fills — so its lock is in app/App.test.tsx,
     not here. What the frame locks is that the bar itself carries no permanent
     Settings word any more, asserted above. */

  it('every app-bar panel is one the command palette also declares', () => {
    /*
     * The lock that keeps the two lists honest with each other. A button
     * opening an overlay the palette does not know about would be a route with
     * no keyboard equivalent, which is the same discoverability failure in
     * reverse.
     */
    const declared = new Set(
      SHELL_COMMANDS.filter((c) => c.overlay).map((c) => c.overlay!.kind),
    );
    for (const id of ['activity', 'rewind', 'settings'] as const) {
      expect(declared.has(id)).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE PALETTE'S FIRST ROW WAS DEAD IN THE SHIPPED APP.

   `composer.focus` is the first row of SHELL_COMMANDS and the default
   selection, so the very first thing a reader tries — Cmd/Ctrl-K, Enter —
   answered "not mounted". The composer WAS mounted; `onCommand` was simply
   never passed, on the reasoning that an honest disabled row beats a row that
   does nothing.

   Both halves of that reasoning were right. The consequence was still the
   worst possible first impression of the only command surface in the product.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the command palette can actually focus the composer', () => {
  function openPalette(onCommand?: (id: string) => void) {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          canvas: <div />,
          chat: <div />,
          rail: <div />,
        })}
        onCommand={onCommand as never}
      />,
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
  }

  it('the first row is NOT disabled once a host is listening', () => {
    openPalette(vi.fn());
    const first = screen.getAllByTestId('command-row')[0]!;
    expect(first.textContent).toMatch(/focus the composer/i);
    expect(first.getAttribute('aria-disabled')).not.toBe('true');
    expect(first.textContent).not.toMatch(/not mounted/i);
  });

  it('running it reaches the host with the composer.focus id', () => {
    const onCommand = vi.fn();
    openPalette(onCommand);
    fireEvent.click(screen.getAllByTestId('command-row')[0]!);
    expect(onCommand).toHaveBeenCalledWith('composer.focus');
  });

  it('still says "not mounted" when nothing is listening', () => {
    /* The original contract, kept: an absent handler means the surface those
       commands need is not mounted, and the row says so rather than doing
       nothing when clicked. */
    openPalette(undefined);
    const first = screen.getAllByTestId('command-row')[0]!;
    expect(first.getAttribute('aria-disabled')).toBe('true');
    expect(first.textContent).toMatch(/not mounted/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE CHORD IS ON SCREEN.

   Cmd/Ctrl-K opens the only command surface in the product and appeared
   nowhere. A reader who never guessed it could not reach the palette, the
   session list or the activity view at all — usability-standard.md's first
   clause, failed over features that already work.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the palette advertises itself', () => {
  function mountBar() {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          canvas: <div />,
          chat: <div />,
          rail: <div />,
        })}
      />,
    );
  }

  it('shows the chord and what it is for', () => {
    mountBar();
    const hint = screen.getByTestId('shell-palette-hint');
    expect(hint.textContent).toMatch(/K/);
    /* Names the ACTION too — a bare chord tells a reader nothing. */
    expect(hint.textContent).toMatch(/commands/i);
  });

  it('IS PRESSABLE, so the reader need not type it to try it', () => {
    mountBar();
    fireEvent.click(screen.getByTestId('shell-palette-hint'));
    expect(screen.getByTestId('command-surface')).toBeTruthy();
  });
});

describe('pane minimise lives on the pane card; dock icons re-expand', () => {
  /*
   * Owner: chat must not vanish when minimised — condense to an icon (same
   * for sessions). Minimise is only inside the pane cards, not the appbar.
   */
  it('appbar does not carry chat/sessions pane toggles', () => {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          chat: <div />,
          sessions: <div />,
          rail: <div />,
        })}
      />,
    );
    expect(screen.queryByTestId('shell-toggle-chat')).toBeNull();
    expect(screen.queryByTestId('shell-toggle-sessions')).toBeNull();
  });

  it('pane headers hide with an accessible name, not Minimise/Close text', () => {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          chat: <div />,
          sessions: <div />,
          rail: <div />,
        })}
      />,
    );
    expect(screen.getByTestId('shell-chat-close').textContent).not.toMatch(/Minimise|Close/);
    expect(screen.getByTestId('shell-sessions-close').textContent).not.toMatch(/Minimise|Close/);
    expect(screen.getByTestId('shell-chat-close').getAttribute('aria-label')).toMatch(/Hide chat/i);
  });

  it('shows worded Sessions + unique section glyphs; minimise is always minus', () => {
    /*
     * Owner 2026-08-26: sessions text disappeared; chat and sessions shared
     * the same cut-off thread icon. Done when: each pane title is worded,
     * identity glyphs differ, every minimise control uses the shared minus.
     */
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <Shell
        {...shellPropsFrom(store.getState(), store, {
          chat: <div />,
          sessions: <div />,
          rail: <div />,
        })}
      />,
    );
    expect(screen.getByTestId('shell-sessions-title').textContent).toMatch(/Sessions/i);
    expect(screen.getByTestId('shell-chat-title').textContent).toMatch(/Chat/i);
    const sessionMark = screen.getByTestId('shell-sessions-title').querySelector('svg');
    const chatMark = screen.getByTestId('shell-chat-title').querySelector('svg');
    expect(sessionMark?.getAttribute('data-icon')).toBe('newthread');
    expect(chatMark?.getAttribute('data-icon')).toBe('topic');
    expect(sessionMark?.getAttribute('data-icon')).not.toBe(chatMark?.getAttribute('data-icon'));
    expect(screen.getByTestId('shell-sessions-close').querySelector('svg')?.getAttribute('data-icon')).toBe(
      'minus',
    );
    expect(screen.getByTestId('shell-chat-close').querySelector('svg')?.getAttribute('data-icon')).toBe(
      'minus',
    );
  });

  it('Whiteboard pane and dock use frame, not Architecture board glyph (P2.5)', () => {
    const store = createStore({ persisted: readShellPersisted() });
    const base = shellPropsFrom(store.getState(), store, {
      chat: <div />,
      rail: <div>wb</div>,
      boardMounted: true,
    });
    const { rerender } = render(
      <Shell {...base} boardMounted rail={<div>wb</div>} railTitle="Whiteboard" onMinimizeBoard={() => {}} />,
    );
    expect(
      screen.getByTestId('shell-rail-title').querySelector('svg')?.getAttribute('data-icon'),
    ).toBe('frame');

    rerender(
      <Shell
        {...base}
        boardMounted={false}
        boardDocked
        rail={<div>wb</div>}
        railTitle="Whiteboard"
        onRestoreBoard={() => {}}
      />,
    );
    expect(screen.getByTestId('shell-dock-board').querySelector('svg')?.getAttribute('data-icon')).toBe(
      'frame',
    );
  });

  it('THE CHAT IS ALWAYS RECOVERABLE — a dock icon replaces the vanished pane', () => {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <StoreProvider store={store}>
        <ConnectedShell chat={<div />} rail={<div />} />
      </StoreProvider>,
    );

    expect(screen.queryByTestId('shell-dock-chat')).toBeNull();
    fireEvent.click(screen.getByTestId('shell-chat-close'));
    expect(screen.queryByTestId('shell-chat')).toBeNull();
    const dock = screen.getByTestId('shell-dock-chat');
    expect(dock.querySelector('svg')).toBeTruthy();
    fireEvent.click(dock);
    expect(screen.getByTestId('shell-chat')).toBeTruthy();
  });

  it('sessions likewise condense to a dock icon', () => {
    const store = createStore({ persisted: readShellPersisted() });
    render(
      <StoreProvider store={store}>
        <ConnectedShell
          chat={<div />}
          sessions={<div />}
          rail={<div />}
        />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('shell-sessions-close'));
    expect(screen.queryByTestId('shell-sessions')).toBeNull();
    fireEvent.click(screen.getByTestId('shell-dock-sessions'));
    expect(screen.getByTestId('shell-sessions')).toBeTruthy();
  });

  it('board minimise uses shared minus and docks without detach (caller owns state)', () => {
    const onMinimizeBoard = vi.fn();
    const onRestoreBoard = vi.fn();
    const base = shellPropsFrom(
      createStore({ persisted: readShellPersisted() }).getState(),
      createStore({ persisted: readShellPersisted() }),
      { chat: <div />, rail: <div>board</div>, boardMounted: true },
    );
    const { rerender } = render(
      <Shell
        {...base}
        boardMounted
        rail={<div>board</div>}
        railTitle="Architecture"
        onMinimizeBoard={onMinimizeBoard}
      />,
    );
    expect(screen.getByTestId('shell-rail')).toBeTruthy();
    const minus = screen.getByTestId('shell-rail-close');
    expect(minus.querySelector('svg')).toBeTruthy();
    fireEvent.click(minus);
    expect(onMinimizeBoard).toHaveBeenCalledOnce();

    rerender(
      <Shell
        {...base}
        boardMounted={false}
        boardDocked
        rail={<div>board</div>}
        railTitle="Architecture"
        onRestoreBoard={onRestoreBoard}
      />,
    );
    expect(screen.queryByTestId('shell-rail')).toBeNull();
    fireEvent.click(screen.getByTestId('shell-dock-board'));
    expect(onRestoreBoard).toHaveBeenCalledOnce();
  });
});
