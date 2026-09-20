import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { resolvedStyle, substituteVars } from '../../test/support/css';
import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { activateSession, browseCatalogSession } from './sessionActions';
import { V3App } from './V3App';
import { V3Chat } from './V3Chat';

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

function runningStore(): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
  store.dispatch({ type: 'turn/send', at: 1 });
  return store;
}

/**
 * A SESSIONS CLIENT THAT ANSWERS WITH A GOAL.
 *
 * The goalbar tests below used to need nothing, because the bar fell back to
 * the session's TITLE. It does not any more (owner, 2026-09-17: a title shown
 * as a goal is meaningless — see `V3GoalRun.test.tsx`), and the goal is read
 * from the SERVER by `useGoalRun`, so a bar can only be tested by answering as
 * a server would. Injected exactly as `V3GoalRun.test.tsx` injects it.
 */
function goalClient(goal: string): SessionsClient {
  const ok = <T,>(body: T) => Promise.resolve({ outcome: 'ok' as const, body });
  return {
    readSession: () => ok({ chat: { version: 1, sessionId: 's', turns: [] }, meta: {}, goal, plan: [] }),
    readGoalRun: () => ok({ running: false, turns: 0, cap: 24 }),
    update: (id: string) => ok({ ok: true, index: { version: 1, activeId: id, sessions: [] } }),
    list: () => ok({ index: { version: 1, activeId: '', sessions: [] } }),
  } as unknown as SessionsClient;
}

describe('V3 harness smoke', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-platform', 'win');
    localStorage.clear();
  });

  it('mounts the fill-screen v3 shell and sessions rail', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    expect(container.querySelector('.v3-win')).toBeTruthy();
    /* Desktop smoke (`tools/desktop-smoke.mjs`) settles on this anchor. */
    expect(screen.getByTestId('shell')).toBe(container.querySelector('.v3-win'));
    expect(container.querySelector('.v3-rail')).toBeTruthy();
    expect(container.querySelector('.v3-chat-col')).toBeTruthy();
    /* Decision 25 — Windows frameless needs an in-app title strip. */
    expect(screen.getByTestId('v3-titlebar')).toBeTruthy();
    expect(screen.getByTestId('v3-titlebar').textContent).toMatch(/Sequence/);
    expect(container.querySelector('.v3-meta')).toBeFalsy();
    expect(screen.getByTestId('v3-resize-rail')).toBeTruthy();
    expect(screen.getByTestId('v3-resize-chat')).toBeTruthy();
    expect(screen.getByRole('application', { name: 'Sequence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Chat' })).toBeTruthy();
    /* Owner walk 2026-09-16 — "Chats" heading is redundant next to New Chat. */
    expect(container.querySelector('.v3-rail-title')).toBeNull();
    expect(container.querySelector('.v3-composer-clock')).toBeNull();
    /* Desktop smoke settles when shell + composer-field are both present. */
    expect(screen.getByTestId('composer-field')).toBeTruthy();
    expect(container.querySelector('.v3-session-open')).toBeFalsy();
  });

  it('keeps workspace toolbar over the center, not over the rail', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const toolbar = container.querySelector('.v3-toolbar');
    const center = container.querySelector('.v3-center');
    const rail = container.querySelector('.v3-rail');
    expect(toolbar && center?.contains(toolbar)).toBe(true);
    expect(toolbar && rail?.contains(toolbar)).toBe(false);
  });

  it('hides traffic lights on Windows platform', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const win = container.querySelector('.v3-win') as HTMLElement;
    expect(win.getAttribute('data-platform')).toBe('win');
    expect(container.querySelector('.v3-traffic')).toBeFalsy();
  });

  it('exposes all workspace surface tabs', () => {
    render(<V3App appStore={freshStore()} />);
    for (const label of ['Chat', 'Files', 'Architecture', 'Whiteboard', 'AI Canvas', 'Terminal', 'Browser']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
  });

  it('keeps chat column when Architecture is selected (split-canon)', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    /* Boot opens Architecture beside chat — do not re-click (toggle would close). */
    expect(container.querySelector('.v3-chat-col')).toBeTruthy();
    expect(container.querySelector('.v3-live-stack')).toBeTruthy();
    expect(container.querySelector('.v3-center.is-chat-expanded')).toBeFalsy();
    expect(container.querySelector('.v3-live-pane[data-surface="architecture"]')).toBeTruthy();
  });

  it('expands chat when Chat tab is selected', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chat$/ }));
    expect(container.querySelector('.v3-center.is-chat-expanded')).toBeTruthy();
    expect(container.querySelector('.v3-live-stack')).toBeFalsy();
  });

  it('opens multiple live surfaces side-by-side and closes from the chrome tab ×', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    /* Architecture already open at boot; add Whiteboard beside it. */
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    const stack = container.querySelector('[data-testid="v3-live-stack"]') as HTMLElement;
    expect(stack).toBeTruthy();
    const panes = [...stack.querySelectorAll('.v3-live-pane')];
    expect(panes.length).toBeGreaterThanOrEqual(2);
    expect(stack.querySelector('[data-testid="v3-resize-live-architecture-whiteboard"]')).toBeTruthy();
    const focused = stack.querySelector('.v3-live-pane.is-focused');
    expect(focused).toBeTruthy();
    expect(focused?.getAttribute('data-focused')).toBe('true');
    /* In-pane × is gone — only the chrome tab close remains. */
    expect(container.querySelector('.v3-live-pane-close')).toBeNull();
    expect(screen.queryByTestId('v3-live-close-whiteboard')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-tab-close-whiteboard'));
    expect(container.querySelector('.v3-live-pane[data-surface="whiteboard"]')).toBeFalsy();
    expect(container.querySelector('.v3-live-pane[data-surface="architecture"]')).toBeTruthy();
  });

  it('drags the live-pane splitter fluidly and snaps ON RELEASE', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    const stack = container.querySelector('[data-testid="v3-live-stack"]') as HTMLElement;
    const arch = stack.querySelector('.v3-live-pane[data-surface="architecture"]') as HTMLElement;
    const board = stack.querySelector('.v3-live-pane[data-surface="whiteboard"]') as HTMLElement;
    Object.defineProperty(arch, 'getBoundingClientRect', {
      value: () => ({ width: 400, height: 400, top: 0, left: 0, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(board, 'getBoundingClientRect', {
      value: () => ({ width: 400, height: 400, top: 0, left: 400, right: 800, bottom: 400, x: 400, y: 0, toJSON: () => ({}) }),
    });
    const resizer = screen.getByTestId('v3-resize-live-architecture-whiteboard');
    /* jsdom PointerEvent omits clientX — MouseEvent under pointer names, same
       as Whiteboard.test (document listeners are native addEventListener). */
    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    /*
     * ── DRAG-TO-SNAP (owner 2026-09-18) ──────────────────────────────────────
     *
     * "I like the snap frames… but I kind of like the fluid drag motion. Right
     * now it's purely snapping and no drag-to-snap."
     *
     * MID-DRAG THE WIDTH IS THE POINTER'S. 280 of 800 is nearest the 1/3 frame
     * (267), and yesterday's cut wrote 267 here — on every move — which is why
     * the edge was never under the finger. The pane follows the pointer now.
     */
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 280 }));
    expect(arch.style.flex).toMatch(/280px/);
    expect(board.style.flex).toMatch(/520px/);
    /* …and the guide line says where letting go will put it, so the frame is
       announced during the drag rather than enforced through it. */
    const guide = container.querySelector('[data-testid="v3-snap-guide"]') as HTMLElement;
    expect(guide, 'no snap guide while a splitter is being dragged').toBeTruthy();
    expect(guide.style.left).toBe('267px');
    expect(container.querySelector('.v3-scaffold')?.getAttribute('data-resizing')).toBe('true');
    /* ON RELEASE it lands on the frame, and only the frame is persisted. */
    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 280 }));
    expect(arch.style.flex).toMatch(/267px/);
    expect(board.style.flex).toMatch(/533px/);
    expect(container.querySelector('[data-testid="v3-snap-guide"]')).toBeNull();
    expect(container.querySelector('.v3-scaffold')?.getAttribute('data-resizing')).toBeNull();
    expect(localStorage.getItem('v3.liveW')).toMatch(/architecture/);
    /* The stored pair is the SNAP, never the raw width the pointer passed
       through — a free width reloaded on next boot would undo the frames. */
    expect(localStorage.getItem('v3.liveW')).toMatch(/267/);
    expect(localStorage.getItem('v3.liveW')).not.toMatch(/280/);
    /*
     * ALWAYS A FRAME, NEVER A FREE WIDTH (owner 2026-09-17: "make sure it
     * makes people snap to those frames instead of letting them infinitely
     * choose"). 340 is 60px from the half and 73px from the third: it rides at
     * 340 while the finger is down, and lands on the half when it lifts.
     */
    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 340 }));
    expect(arch.style.flex).toMatch(/340px/);
    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 340 }));
    expect(arch.style.flex).toMatch(/400px/);
    expect(board.style.flex).toMatch(/400px/);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE SMEARING TEXT — owner, 2026-09-18, on the installed app: "when I'm
   * moving certain frames too fast they seem to be blurring the words out."
   *
   * It is not the text. Every glass surface in this app samples what is behind
   * it through `backdrop-filter`; while a pane is being resized the geometry
   * moves faster than the compositor can finish a sample, so it ships the stale
   * one and everything drawn on it smears with it. The fix is to stop sampling
   * for the duration of the gesture.
   *
   * ── WHAT THESE TWO CHECKS READ ────────────────────────────────────────────
   *
   * The FIRST reads the DOM: whether the attribute the stylesheet keys on is
   * actually set while a drag is running and cleared when it ends. That is the
   * half jsdom can prove, and it is the half that breaks silently (a pointerup
   * path that forgets to clear it leaves the app permanently unglassed).
   *
   * The SECOND reads the stylesheet's own text. jsdom does not implement
   * `backdrop-filter` at all, so a computed-style assertion would pass whether
   * or not the rule existed — the most expensive kind of green. Reading the
   * source proves the DECLARATION is there and nothing about how it renders.
   * The rendering half is the browser pass, and it does not live in this file.
   * ══════════════════════════════════════════════════════════════════════════
   */
  it('flags the scaffold while a splitter is down, and unflags it on release', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const scaffold = container.querySelector('.v3-scaffold') as HTMLElement;
    expect(scaffold.getAttribute('data-resizing')).toBeNull();
    const resizer = screen.getByTestId('v3-resize-chat');
    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 600 }));
    /* From pointerDOWN, not from the first move: the first frame of the drag is
       the one the owner was looking at. */
    expect(scaffold.getAttribute('data-resizing')).toBe('true');
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 520 }));
    expect(scaffold.getAttribute('data-resizing')).toBe('true');
    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 520 }));
    expect(scaffold.getAttribute('data-resizing')).toBeNull();
    /* A cancelled gesture must clear it too — a pointercancel that left the app
       flat would be a permanent regression nobody could reproduce on purpose. */
    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 600 }));
    expect(scaffold.getAttribute('data-resizing')).toBe('true');
    fireEvent(document, new MouseEvent('pointercancel', { bubbles: true, clientX: 600 }));
    expect(scaffold.getAttribute('data-resizing')).toBeNull();
  });

  it('the stylesheet turns the glass and the width easing OFF under that flag', async () => {
    const { default: css } = (await import('./v3.css?raw')) as { default: string };
    /* The wildcard is deliberate and the test insists on it: the panes being
       resized contain glass from chat.css, files.css, board.css and
       settings.css, which this lane does not own. A list of v3's own eight
       glass classes would go stale the first time another lane adds a ninth. */
    expect(css).toMatch(
      /\.v3-scaffold\[data-resizing='true'\] \*[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/,
    );
    expect(css).toMatch(/-webkit-backdrop-filter:\s*none\s*!important/);
    const flagged = css.slice(css.indexOf(".v3-scaffold[data-resizing='true'] .v3-chat-col"));
    expect(flagged.slice(0, flagged.indexOf('\n}') + 2)).toMatch(/transition:\s*none/);
    /* And the easing exists to be turned off — a transition: none guarding a
       property nothing animates would be a rule about nothing. */
    expect(css).toMatch(/transition:\s*\n?\s*flex-basis var\(--dur-snap\)/);
    expect(css).toMatch(/--dur-snap:\s*140ms/);
  });

  it('fills the live stack when only one pane remains after close', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    const stack = container.querySelector('[data-testid="v3-live-stack"]') as HTMLElement;
    const arch = stack.querySelector('.v3-live-pane[data-surface="architecture"]') as HTMLElement;
    const board = stack.querySelector('.v3-live-pane[data-surface="whiteboard"]') as HTMLElement;
    Object.defineProperty(arch, 'getBoundingClientRect', {
      value: () => ({ width: 400, height: 400, top: 0, left: 0, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(board, 'getBoundingClientRect', {
      value: () => ({ width: 400, height: 400, top: 0, left: 400, right: 800, bottom: 400, x: 400, y: 0, toJSON: () => ({}) }),
    });
    const resizer = screen.getByTestId('v3-resize-live-architecture-whiteboard');
    fireEvent(resizer, new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 280 }));
    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 280 }));
    fireEvent.click(screen.getByTestId('v3-tab-close-whiteboard'));
    const alone = container.querySelector(
      '.v3-live-pane[data-surface="architecture"]',
    ) as HTMLElement;
    expect(alone).toBeTruthy();
    expect(alone.style.flex).toMatch(/1 1 0/);
  });

  it('mounts each live surface root when its tab is opened', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Terminal$/ }));
    expect(container.querySelector('.terminal-pane, .v3-terminal-pane, .v3-terminal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Browser$/ }));
    expect(container.querySelector('.browser-pane, .v3-browser-pane, .v3-browser')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    expect(container.querySelector('.whiteboard, [data-surface="whiteboard"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^AI Canvas$/ }));
    expect(container.querySelector('.ai-canvas, [data-surface="ai-canvas"]')).toBeTruthy();
  });

  it('opens settings from the sessions rail foot', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-rail-settings'));
    expect(container.querySelector('.v3-overlay-scrim')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  it('Cmd/Ctrl+K opens the command palette and Search overlay is real', async () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('command-surface')).toBeTruthy();
    const search = container.querySelector('[data-command="overlay.search"]');
    expect(search).toBeTruthy();
    fireEvent.click(search!);
    await waitFor(() => {
      expect(screen.queryByText(/not wired in V3/i)).toBeNull();
      expect(screen.getByTestId('v3-overlay-search')).toBeTruthy();
    });
  });

  it('palette Help opens the real Help panel', async () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const help = container.querySelector('[data-command="overlay.help"]');
    expect(help).toBeTruthy();
    fireEvent.click(help!);
    await waitFor(() => {
      expect(screen.getByTestId('v3-overlay-help')).toBeTruthy();
      expect(screen.queryByText(/not wired in V3/i)).toBeNull();
    });
  });

  it('resolves gold accent token on a selected tab', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const selected = container.querySelector('.v3-tab.is-selected');
    expect(selected).toBeTruthy();

    const root = document.documentElement;
    const accentRaw =
      root.style.getPropertyValue('--accent') || getComputedStyle(root).getPropertyValue('--accent');
    const accent = substituteVars(accentRaw.trim() || 'var(--accent)', root);
    expect(accent.toUpperCase()).toMatch(/E8C547|232,\s*197,\s*71|245,\s*230,\s*163/);

    const bg = resolvedStyle(selected as Element, 'background');
    const color = resolvedStyle(selected as Element, 'color');
    expect(`${bg} ${color}`.length).toBeGreaterThan(0);
  });

  it('fill-screen win has no floating card radius', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const win = container.querySelector('.v3-win') as HTMLElement;
    const radius = getComputedStyle(win).borderRadius;
    expect(radius === '0px' || radius === '' || Number.parseFloat(radius) === 0).toBe(true);
  });
});

describe('V3 thinking HUD + approvals', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('ships Plan/Build/Teach behind the one composer menu', () => {
    const store = createStore({});
    const { container } = render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    /* Decision 36 — the mode pill left the row and the `+` took its job.
       The mode is still SAYABLE without opening anything: it is on the
       trigger's accessible name and in its `data-mode`. */
    const plus = screen.getByTestId('v3-tools-trigger');
    expect(plus.getAttribute('data-mode')).toBe('plan');
    expect(plus.getAttribute('aria-label')).toMatch(/Plan/);
    expect(screen.queryByTestId('v3-mode-trigger')).toBeNull();
    fireEvent.click(plus);
    expect(screen.getByRole('menuitemradio', { name: /Build/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Teach/ })).toBeTruthy();
    expect(container.querySelector('.v3-composer')).toBeTruthy();
  });

  it('ships tools menu, path strip, model, and effort controls', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-tools-trigger')).toBeTruthy();
    expect(screen.getByTestId('v3-composer-where')).toBeTruthy();

    /* THE THREE CONTROLS THE OWNER COUNTED, asserted BEFORE anything is
       opened: "the only buttons you can really see on the prompt bar are the
       plus, the agent and the send." The ring is a gauge, not a button, and
       a popover's rows are the foot's descendants only while it is open. */
    const foot = document.querySelector('.v3-composer-foot');
    expect(foot).toBeTruthy();
    expect(
      Array.from(foot!.querySelectorAll('button')).map((b) => b.getAttribute('data-testid')),
    ).toEqual(['v3-tools-trigger', 'v3-model-trigger', 'composer-send']);
    /* ONE agent control since Decision 34: model and reasoning share a chip. */
    expect(screen.getByTestId('v3-model-trigger')).toBeTruthy();
    expect(screen.queryByTestId('v3-effort-trigger')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    expect(screen.getByRole('menuitem', { name: /Break it down/ })).toBeTruthy();
  });

  it('renders thinking HUD as Working · time · running (no Round/helper copy)', () => {
    const store = runningStore();
    expect(store.getState().session.inFlight).toBeTruthy();
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const hud = screen.getByTestId('v3-thinking');
    expect(hud.textContent).toMatch(/Working|Queued|Finalizing|Drawing/);
    expect(screen.getByTestId('v3-thinking-elapsed')).toBeTruthy();
    expect(hud.textContent).not.toMatch(/Round/);
    expect(hud.textContent).not.toMatch(/tool and model steps/i);
    expect(screen.queryByTestId('v3-thinking-status')).toBeNull();
    /* Owner walk: Working must show braille/shimmer glyph, not a static clock. */
    expect(screen.getByTestId('chat-reasoning-glyph')).toBeTruthy();
    expect(hud.querySelector('.v3-thinking-bar')).toBeTruthy();

    /*
     * THE TIMER IS THE LAST COLUMN (owner, 2026-09-19: "the one running, the
     * 38 seconds, the 40 seconds, these are all disproportionate, they are all
     * disaligned").
     *
     * The order is the half of that fix a test can hold. It used to be phase,
     * timer, count — with the timer pushed right by `margin-left: auto` and the
     * count landing AFTER it, so the thing on the far right changed identity
     * depending on whether any tools were running. One right-hand column, and
     * it is always the clock.
     */
    const bar = hud.querySelector('.v3-thinking-bar')!;
    const order = [...bar.children]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null);
    expect(order[order.length - 1]).toBe('v3-thinking-elapsed');
  });

  it('hides empty user turns (meta without bubble body)', () => {
    const store = createStore({});
    store.dispatch({
      type: 'session/hydrated',
      turns: [
        {
          id: 'u-empty' as never,
          role: 'user',
          text: '   ',
          intents: [],
          chips: [],
          contextLines: [],
          surface: null,
          memoryTrim: null,
          at: 100,
        },
        {
          id: 'u-ok' as never,
          role: 'user',
          text: 'hello',
          intents: [],
          chips: [],
          contextLines: [],
          surface: null,
          memoryTrim: null,
          at: 200,
        },
      ],
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const users = screen.getAllByTestId('v3-msg-user');
    expect(users).toHaveLength(1);
    expect(users[0]!.textContent).toMatch(/hello/);
  });

  it('Set focus opens from tools menu — no always-on invite, no window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('ignored');
    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 's-empty', title: '', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 's-empty',
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.queryByTestId('v3-focus-invite')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-new-goal'));
    expect(screen.getByTestId('v3-focus-form')).toBeTruthy();
    expect(screen.getByTestId('v3-focus-input')).toBeTruthy();
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('goalbar says Working toward this focus while a turn runs without a plan', async () => {
    const store = runningStore();
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 's-run', title: 'Ship the plot', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 's-run',
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat goalRunClient={goalClient('ship the plot')} />
        </div>
      </StoreProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('v3-goalbar-working').textContent).toMatch(
        /Working toward this focus/i,
      ),
    );
  });

  it('goalbar prefixes Working · on the active plan step while in flight', async () => {
    const store = runningStore();
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 's-plan', title: 'Guard the gateway', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 's-plan',
    });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'todo:list',
        items: [
          { id: 's1', title: 'Read the parser', status: 'done' },
          { id: 's2', title: 'Add the guard', status: 'active' },
          { id: 's3', title: 'Lock it with a test', status: 'pending' },
        ],
      },
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat goalRunClient={goalClient('guard the gateway')} />
        </div>
      </StoreProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('v3-goalbar-step').textContent).toMatch(/Working · Add the guard/),
    );
  });

  it('assistant turn bill is labeled turn · … not the context-ring fill', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: { type: 'usage', inputTokens: 11_100, outputTokens: 1_100, estimated: false },
    });
    store.dispatch({
      type: 'turn/event',
      at: 3,
      event: { type: 'result', text: 'here is the answer' },
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const bill = screen.getByTestId('v3-turn-bill');
    expect(bill.textContent).toMatch(/^turn ·/);
    expect(bill.getAttribute('title')).toMatch(/Turn bill/i);
    expect(bill.getAttribute('title')).toMatch(/not the context-ring/i);
  });

  it('strips raw XML function tags from assistant prose', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'search' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'result',
        text: 'Looking.\n\n<function name="search_files"><param name="limit">20</param></function>\n\nDone.',
      },
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const prose = screen.getByTestId('v3-msg-prose');
    expect(prose.textContent).not.toMatch(/<function|search_files|param/);
    expect(prose.textContent).toMatch(/Looking|Done/);
  });

  it('tools-only assistant turn paints no empty-answer filler copy', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'draw' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: { type: 'tool:start', id: 'tool-1', name: 'propose_chart' },
    });
    store.dispatch({
      type: 'turn/event',
      at: 3,
      event: { type: 'tool:done', id: 'tool-1', name: 'propose_chart' },
    });
    store.dispatch({
      type: 'turn/event',
      at: 4,
      event: { type: 'result', text: '' },
    });
    const { container } = render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.queryByTestId('v3-msg-prose')).toBeNull();
    expect(screen.queryByTestId('v3-msg-empty')).toBeNull();
    expect(container.textContent).not.toMatch(/No written answer/i);
  });

  /* DECISION 34 — one chip opens both halves: the model list, then reasoning
     drawn as a METER. Owner, 2026-09-19: "model and effort should be in one
     icon… effort as kind of a meter." */
  it('the agent chip opens the model list above a four-step reasoning meter', () => {
    render(<V3App appStore={freshStore()} />);
    const trigger = screen.getByTestId('v3-model-trigger');
    /* `agent`, not `bot` — the chip opens WHICH agent and HOW HARD, which is
       not what a face says (owner, 2026-09-19: "a sub-agent icon"). */
    expect(trigger.querySelector('[data-icon="agent"]')).toBeTruthy();
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Model and reasoning' });
    expect(within(menu).getByText('Model')).toBeTruthy();
    const meter = within(menu).getByRole('radiogroup', { name: 'Reasoning strength' });
    expect(within(meter).getAllByRole('radio')).toHaveLength(4);
    /* THE BARS CARRY NO WORDS. That is the whole point of the rail shape: the
       level is the bars and the READING is the line under them, so nothing on
       screen has to be a control and a label at once. */
    expect(meter.textContent).toBe('');
    expect(screen.getByTestId('v3-effort-read').textContent).toMatch(/^Med/);
    expect(screen.getByTestId('v3-effort-medium').getAttribute('data-filled')).toBe('yes');
    expect(screen.getByTestId('v3-effort-low').getAttribute('data-filled')).toBe('yes');
    expect(screen.getByTestId('v3-effort-high').getAttribute('data-filled')).toBe('no');
  });

  /* DECISION 36 — the plus carries the mode, the agent chip carries the model. */
  it('the plus wears the mode and the agent chip wears a cut of the model name', () => {
    render(<V3App appStore={freshStore()} />);
    const plus = screen.getByTestId('v3-tools-trigger');
    expect(plus.getAttribute('data-mode')).toBe('plan');
    /* The glyph is THERE. A container rule written against Decision 33's
       chevron hid it by position (`svg:last-child`) once the chevron went, and
       both chips drew an empty box (owner, 2026-09-19). */
    expect(plus.querySelector('svg')).toBeTruthy();

    const agent = screen.getByTestId('v3-model-trigger');
    expect(agent.className).toMatch(/v3-agent-chip/);
    expect(agent.querySelector('svg')).toBeTruthy();
    /* A CUT, NOT AN OVERFLOW. Whatever the model is called, the chip is the
       same width, so Send does not move when the reader switches — and the
       whole name is on the title, which is where a truncation puts what it
       cut. */
    const cut = agent.querySelector('.v3-chip-ellipsis');
    expect(cut).toBeTruthy();
    expect((cut!.textContent ?? '').length).toBeLessThanOrEqual(10);
    expect(agent.getAttribute('title')).toBeTruthy();
  });

  it('rail foot lists Open project above Settings in header ink', () => {
    render(<V3App appStore={freshStore()} />);
    const open = screen.getByTestId('v3-rail-open-project');
    const settings = screen.getByTestId('v3-rail-settings');
    expect(open.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('v3-titlebar').querySelector('.v3-titlebar-mark')).toBeTruthy();
  });

  it('goalbar dismiss hides focus until a new goal', async () => {
    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 's-focus', title: 'Ship Wave B', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 's-focus',
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat goalRunClient={goalClient('ship Wave B')} />
        </div>
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('v3-goalbar')).toBeTruthy());
    fireEvent.click(screen.getByTestId('v3-goalbar-dismiss'));
    expect(screen.queryByTestId('v3-goalbar')).toBeNull();
    expect(screen.queryByTestId('v3-focus-invite')).toBeNull();
  });

  it('shows the work list live and pins the active step on Focus', async () => {
    const store = runningStore();
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 's-plan', title: 'Guard the gateway', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 's-plan',
    });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'todo:list',
        items: [
          { id: 's1', title: 'Read the parser', status: 'done' },
          { id: 's2', title: 'Add the guard', status: 'active' },
          { id: 's3', title: 'Lock it with a test', status: 'pending' },
        ],
      },
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat goalRunClient={goalClient('guard the gateway')} />
        </div>
      </StoreProvider>,
    );
    const list = screen.getByTestId('todo-list');
    expect(list.getAttribute('data-streaming')).toBe('true');
    expect(list.textContent).toMatch(/Add the guard/);
    await waitFor(() =>
      expect(screen.getByTestId('v3-goalbar-step').textContent).toMatch(/Working · Add the guard/),
    );
    expect(screen.getByTestId('v3-goalbar-progress').textContent).toBe('1/3');
    expect(screen.getByTestId('v3-goalbar-track')).toBeTruthy();
  });

  it('keeps the finished work list on the assistant turn', () => {
    const store = runningStore();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'todo:list',
        items: [
          { id: 's1', title: 'Read the parser', status: 'done' },
          { id: 's2', title: 'Add the guard', status: 'done' },
        ],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Locked.' }, at: 3 });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const list = screen.getByTestId('todo-list');
    expect(list.getAttribute('data-streaming')).toBe('false');
    expect(list.textContent).toMatch(/2 of 2 done/);
  });

  it('tools menu exposes New goal', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    expect(screen.getByTestId('v3-new-goal')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /New goal/ })).toBeTruthy();
  });

  it('approval Accept all dispatches proposal/file-decide', () => {
    const store = runningStore();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'two files',
        files: [
          { path: 'src/a.ts', content: 'a' },
          { path: 'src/b.ts', content: 'b' },
        ],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'here' }, at: 3 });

    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-approve')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Accept all/i }));
    const proposal = Object.values(store.getState().session.proposals)[0]!;
    expect(proposal.files.every((f) => f.decision === 'accepted')).toBe(true);
  });

  it('approval Reject all marks files rejected', () => {
    const store = runningStore();
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'one file',
        files: [{ path: 'src/c.ts', content: 'c' }],
      },
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'here' }, at: 3 });

    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Reject all/i }));
    const proposal = Object.values(store.getState().session.proposals)[0]!;
    expect(proposal.files.every((f) => f.decision === 'rejected')).toBe(true);
  });

  it('context ring shows fraction label and opens breakdown', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/context-window', tokens: 131_072 });
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'usage', inputTokens: 12_000, outputTokens: 40, estimated: false },
      at: 2,
    });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'result',
        text: 'done',
        contextBreakdown: {
          totalMeasured: 12_000,
          sections: [
            { id: 'system', label: 'System', tokens: 2000 },
            { id: 'history', label: 'History', tokens: 8000 },
            { id: 'tools', label: 'Tools', tokens: 2000 },
          ],
        },
      },
      at: 3,
    });

    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.queryByTestId('composer-context-label')).toBeNull();
    const ring = screen.getByTestId('composer-context');
    fireEvent.click(ring);
    expect(screen.getByTestId('composer-context-breakdown')).toBeTruthy();
    expect(screen.getByTestId('composer-context-label').textContent).toMatch(/12k\s*\/\s*131/i);
  });
});

describe('V3 effort + session switch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('Effort High writes localStorage immediately', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    fireEvent.click(screen.getByTestId('v3-effort-high'));
    expect(localStorage.getItem('v3.reasoningEffort')).toBe('high');
    expect(screen.getByTestId('v3-model-trigger').getAttribute('aria-label')).toMatch(/High/);
    /* The panel STAYS OPEN, so the reader can see the meter they just moved. */
    expect(screen.getByTestId('v3-effort-high').getAttribute('data-filled')).toBe('yes');
  });

  it('activateSession sets activeId before readSession resolves', async () => {
    let resolveRead: (v: unknown) => void = () => {};
    const readGate = new Promise((r) => {
      resolveRead = r;
    });
    const client = {
      activate: vi.fn(async () => ({
        outcome: 'ok' as const,
        status: 200,
        body: {
          index: {
            sessions: [
              { id: 's1', title: 'One', pinned: false, updatedAt: '2026-01-01' },
              { id: 's2', title: 'Two', pinned: false, updatedAt: '2026-01-01' },
            ],
            activeId: 's2',
          },
        },
      })),
      readSession: vi.fn(async () => {
        await readGate;
        return {
          outcome: 'ok' as const,
          status: 200,
          body: { chat: { turns: [] } },
        };
      }),
      list: vi.fn(),
      create: vi.fn(),
    };

    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [
        { id: 's1', title: 'One', pinned: false, updatedAt: '2026-01-01' },
        { id: 's2', title: 'Two', pinned: false, updatedAt: '2026-01-01' },
      ],
      activeId: 's1',
    });

    const pending = activateSession(store, 's2', client as never);
    expect(store.getState().session.activeId).toBe('s2');
    expect(store.getState().session.hydrating).toBe(true);
    resolveRead(undefined);
    await pending;
    expect(client.activate).toHaveBeenCalledWith('s2');
    expect(client.readSession).toHaveBeenCalled();
    expect(store.getState().session.hydrating).toBe(false);
  });
});

describe('V3 owner-walk locks', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders assistant markdown strong (no literal asterisks)', () => {
    const store = createStore({});
    store.dispatch({
      type: 'session/browse',
      activeId: 's1',
      turns: [
        {
          id: 'a1',
          role: 'assistant',
          at: 1,
          text: '**Internal** API stays private',
          evidence: { files: [], tools: [] },
          work: [],
        },
      ],
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const strong = screen.getByTestId('chat-strong');
    expect(strong.textContent).toBe('Internal');
    expect(screen.getByTestId('v3-prose').textContent).not.toMatch(/\*\*/);
  });

  it('names the chart via tool timeline — no second open-AI-Canvas pointer', () => {
    const store = createStore({});
    store.dispatch({
      type: 'session/browse',
      activeId: 's1',
      turns: [
        {
          id: 'a1',
          role: 'assistant',
          at: 1,
          text: 'Here is the curve.',
          evidence: { files: [], tools: [{ id: 't1', name: 'propose_chart', text: 'charted line' }] },
          work: [
            {
              id: 'chart:a1:1',
              group: 'change',
              verb: 'Drew a chart',
              identifier: null,
              outcome: null,
              provenance: null,
              status: 'done',
              from: 'chart:proposal',
              opens: 'ai-canvas',
            },
          ],
        },
      ],
    });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.queryByTestId('chat-chart-pointer')).toBeNull();
    expect(screen.getByTestId('v3-tool-timeline')).toBeTruthy();
    expect(screen.getByTestId('v3-tool-timeline').textContent).toMatch(/chart|Drawing|Drew/i);
  });

  it('browseCatalogSession soft-loads without activate', async () => {
    const client = {
      readSession: vi.fn(async (_id: string, _sig?: AbortSignal, repoPath?: string) => ({
        outcome: 'ok' as const,
        status: 200,
        body: {
          chat: {
            version: 1,
            sessionId: 'foreign-1',
            turns: [{ id: 't1', role: 'user', at: '2026-01-01T00:00:00.000Z', text: 'hello from foreign' }],
          },
          meta: {},
          canvas: {
            version: 1,
            sessionId: 'foreign-1',
            blocks: [{ id: 'b1', type: 'markdown', payload: '# hi', status: 'landed' }],
          },
        },
        ...(repoPath ? {} : {}),
      })),
      list: vi.fn(),
      create: vi.fn(),
      activate: vi.fn(async () => {
        throw new Error('activate must not run on soft catalog switch');
      }),
    };

    const store = createStore({});
    store.dispatch({
      type: 'session/index',
      sessions: [{ id: 'local-1', title: 'Local', pinned: false, updatedAt: '2026-01-01' }],
      activeId: 'local-1',
    });

    const result = await browseCatalogSession(
      store,
      'C:/repos/other',
      'foreign-1',
      client as never,
    );
    expect(result.outcome).toBe('ok');
    expect(client.activate).not.toHaveBeenCalled();
    expect(client.readSession).toHaveBeenCalledWith('foreign-1', undefined, 'C:/repos/other');
    expect(store.getState().session.activeId).toBe('foreign-1');
    expect(store.getState().session.browseRepoPath).toBe('C:/repos/other');
    expect(store.getState().session.turns[0]?.text).toMatch(/hello from foreign/);
    expect(store.getState().session.canvasDoc.blocks.length).toBe(1);
  });

  it('open live tab pill exposes × that closes without focusing the pane first', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^AI Canvas$/ }));
    expect(container.querySelector('.v3-live-pane[data-surface="ai-canvas"]')).toBeTruthy();
    const close = screen.getByTestId('v3-tab-close-ai-canvas');
    fireEvent.click(close);
    expect(container.querySelector('.v3-live-pane[data-surface="ai-canvas"]')).toBeFalsy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   DECISION 35 — one `+` menu and a shelved palette
   DECISION 36 — three controls on the row, one-line rows, a segmented meter
   ══════════════════════════════════════════════════════════════════════════ */

describe('the composer’s one menu', () => {
  it('opens with the modes at the top, the actions, the attach row and three submenus', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const menu = screen.getByRole('menu', { name: 'Add agents, context, tools' });

    /* THE MODES ARE IN IT, which is the shape of the reference shot — and
       since Decision 36 this is the ONLY way to `pickMode` from the composer.
       The pill that used to be the second way was the duplicate, so removing
       it cost the row a control and cost the reader nothing. */
    for (const key of ['plan', 'build', 'teach']) {
      expect(screen.getByTestId(`v3-tools-mode-${key}`)).toBeTruthy();
    }
    expect(screen.getByTestId('v3-tools-mode-plan').getAttribute('aria-checked')).toBe('true');

    expect(within(menu).getByText('Break it down')).toBeTruthy();
    expect(screen.getByTestId('v3-new-goal')).toBeTruthy();

    /* NOT "Image". `onAttach` posts text, and a row that promised an image
       would be the menu claiming something the engine cannot do. */
    const attach = screen.getByTestId('v3-tools-attach');
    expect(attach.textContent).toMatch(/Attach a file/);
    expect(menu.textContent).not.toMatch(/Image/);

    for (const id of ['models', 'skills', 'mcp']) {
      expect(screen.getByTestId(`v3-tools-${id}`)).toBeTruthy();
    }
  });

  it('picking a mode from the menu moves the plus and closes the menu', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-tools-mode-teach'));
    expect(screen.queryByRole('menu', { name: 'Add agents, context, tools' })).toBeNull();
    expect(screen.getByTestId('v3-tools-trigger').getAttribute('data-mode')).toBe('teach');
  });

  it('a submenu opens one at a time and says what is behind it', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const skills = screen.getByTestId('v3-tools-skills');
    /* An empty shelf says where to put something, rather than being a dead
       end the reader has to guess at. */
    fireEvent.click(skills);
    expect(skills.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Skills' }).textContent).toMatch(/No skills yet/);

    fireEvent.click(screen.getByTestId('v3-tools-mcp'));
    expect(screen.getByTestId('v3-tools-skills').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('menu', { name: 'MCP servers' }).textContent).toMatch(/mcp\.json/);
  });
});

describe('the reasoning rail', () => {
  it('separates the level from the reading, and fills up to the chosen bar', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    const group = screen.getByRole('radiogroup', { name: 'Reasoning strength' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);

    /* DECISION 37 — the bars are the level and they say NOTHING. Two earlier
       shapes tried to be the control and the reading at once (dots with named
       ends, then labelled cells) and the owner rejected both. The kit's
       progress rail splits them, and the split is the fix. */
    expect(group.textContent).toBe('');
    expect(group.textContent).not.toMatch(/Faster|Smarter/);
    for (const key of ['none', 'low', 'medium', 'high']) {
      expect(screen.getByTestId(`v3-effort-${key}`)).toBeTruthy();
      /* The words are reachable — they are each bar's accessible name. */
      expect(screen.getByTestId(`v3-effort-${key}`).getAttribute('aria-label')).toBeTruthy();
    }

    /* THE READING IS THE LINE UNDER THEM, in words, like the kit's `3 / 5`. */
    const read = screen.getByTestId('v3-effort-read');
    expect(read.querySelector('b')?.textContent).toBe('Med');
    expect(read.textContent).toMatch(/Balanced/);

    /* STILL A METER AND NOT A SWITCH: every bar up to the chosen one is lit,
       which is the difference between "how much" and "which one". */
    expect(screen.getByTestId('v3-effort-none').getAttribute('data-filled')).toBe('yes');
    expect(screen.getByTestId('v3-effort-medium').getAttribute('data-filled')).toBe('yes');
    expect(screen.getByTestId('v3-effort-high').getAttribute('data-filled')).toBe('no');
  });

  /* Owner, 2026-09-19: "when you go to slash mode, you can't really find
     Teach anywhere, which is kind of annoying." */
  it('the palette offers all three modes, not the two that are permissions', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.change(screen.getByTestId('composer-field'), { target: { value: '/' } });
    fireEvent.mouseDown(screen.getByTestId('v3-slash-more-commands'));
    const names = screen
      .getAllByTestId('v3-slash-item')
      .map((b) => b.getAttribute('data-command'));
    expect(names).toContain('plan');
    expect(names).toContain('build');
    expect(names).toContain('teach');
  });

  it('typing /teach puts the composer in Teach', () => {
    render(<V3App appStore={freshStore()} />);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/teach' } });
    const row = screen
      .getAllByTestId('v3-slash-item')
      .find((b) => b.getAttribute('data-command') === 'teach');
    expect(row).toBeTruthy();
    fireEvent.mouseDown(row!);
    /* The `+` is where the mode lives now, so it is where the answer shows. */
    expect(screen.getByTestId('v3-tools-trigger').getAttribute('data-mode')).toBe('teach');
  });
});

describe('the slash palette is shelved', () => {
  function typeSlash() {
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/' } });
  }

  it('groups the rows under headings and caps each shelf with a count', () => {
    render(<V3App appStore={freshStore()} />);
    typeSlash();
    const pop = screen.getByTestId('v3-slash');
    expect(within(pop).getByText('Commands')).toBeTruthy();
    expect(within(pop).getByText('Modes')).toBeTruthy();
    /* Five commands, three shown: the count is the point, not "Show more". */
    const more = screen.getByTestId('v3-slash-more-commands');
    expect(more.textContent).toMatch(/^Show 2 more$/);
  });

  it('opening a shelf shows the rest and takes the count away', () => {
    render(<V3App appStore={freshStore()} />);
    typeSlash();
    fireEvent.mouseDown(screen.getByTestId('v3-slash-more-commands'));
    expect(screen.queryByTestId('v3-slash-more-commands')).toBeNull();
    expect(screen.getAllByTestId('v3-slash-item').length).toBeGreaterThan(5);
  });
});
