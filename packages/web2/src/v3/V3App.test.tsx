import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import {
  SLASH_SECTION_PREVIEW,
  slashCommands,
  slashGroupOf,
  TOOLBELT,
} from '../chat/composerModel';
import { readShellPersisted, readShellTokens } from '../shell';
import { resolvedStyle, substituteVars } from '../../test/support/css';
import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { activateSession, browseCatalogSession } from './sessionActions';
import { V3App } from './V3App';
import { V3Chat } from './V3Chat';
import { setStatusBar } from '../shell2/statusBarPref';
import { StatusBar } from '../shell2/StatusBar';

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

  it('mounts the fill-screen shell: panel, chat column, its sizer, the stage and the composer (Decision 49)', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const shell = screen.getByTestId('shell');
    /* Desktop smoke (`tools/desktop-smoke.mjs`) settles on this anchor and the composer field. */
    expect(shell.classList.contains('s2-app')).toBe(true);
    expect(container.querySelector('.v3-rail-slot .s2-panel')).toBeTruthy();
    expect(container.querySelector('.v3-chat-col')).toBeTruthy();
    expect(screen.getByTestId('s2-chat-sizer')).toBeTruthy();
    expect(container.querySelector('.s2-stage')).toBeTruthy();
    expect(within(screen.getByTestId('s2-panel')).getByRole('button', { name: 'New chat' })).toBeTruthy();
    /* Decision 25 (Windows frameless): the top bar is the drag region; the window
       controls draw there only inside the desktop host (WindowControls). */
    expect(container.querySelector('.s2-topb')).toBeTruthy();
    expect(screen.getByTestId('composer-field')).toBeTruthy();
    expect(container.querySelector('.v3-composer-clock')).toBeNull();
  });

  it('keeps the surface bar over the main column, not over the panel', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const bar = container.querySelector('.s2-topb');
    expect(bar && container.querySelector('.s2-mainp')?.contains(bar)).toBe(true);
    expect(bar && container.querySelector('.v3-rail-slot')?.contains(bar)).toBe(false);
  });

  it('hides traffic lights on Windows platform', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('shell').getAttribute('data-platform')).toBe('win');
    expect(container.querySelector('.v3-traffic')).toBeFalsy();
  });

  it('exposes exactly the shipped workspace surface pills (the chat is a column, not a pill)', () => {
    render(<V3App appStore={freshStore()} />);
    const bar = screen.getByRole('navigation', { name: 'Workspace' });
    for (const label of ['Files', 'Architecture', 'Whiteboard', 'Terminal']) {
      expect(within(bar).getByRole('button', { name: new RegExp(`^${label}$`) })).toBeTruthy();
    }
    /* Hidden (SHIPPED_SURFACES, 2026-10-05). */
    for (const label of ['AI Canvas', 'Browser', 'Chat']) {
      expect(within(bar).queryByRole('button', { name: new RegExp(`^${label}$`) })).toBeNull();
    }
  });

  it('keeps the chat column beside Architecture at boot (split-canon)', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    expect(container.querySelector('.v3-chat-col')).toBeTruthy();
    expect(container.querySelector('.s2-pane[data-surface-pane="architecture"]')).toBeTruthy();
  });


  it('opens two surfaces side by side with a divider between, and closes one from its pane head', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    const panes = [...container.querySelectorAll('.s2-pane[data-surface-pane]')];
    expect(panes.map((p) => p.getAttribute('data-surface-pane'))).toEqual(['architecture', 'whiteboard']);
    expect(panes[0]!.nextElementSibling?.getAttribute('data-testid')).toBe('s2-split-divider');
    expect(container.querySelector('.s2-pane.is-focused')?.getAttribute('data-surface-pane')).toBe('whiteboard');
    fireEvent.click(screen.getByTestId('v3-tab-close-whiteboard'));
    expect(container.querySelector('.s2-pane[data-surface-pane="whiteboard"]')).toBeFalsy();
    expect(container.querySelector('.s2-pane[data-surface-pane="architecture"]')).toBeTruthy();
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
  it('flags the scaffold while a splitter is down, and unflags it on release (or cancel)', () => {
    render(<V3App appStore={freshStore()} />);
    const scaffold = screen.getByTestId('shell');
    expect(scaffold.getAttribute('data-resizing')).toBeNull();
    const sizer = screen.getByTestId('s2-chat-sizer');
    fireEvent(sizer, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 }));
    /* From pointerDOWN, not from the first move. */
    expect(scaffold.getAttribute('data-resizing')).toBe('true');
    fireEvent(document, new MouseEvent('pointermove', { bubbles: true, clientX: 520 }));
    expect(scaffold.getAttribute('data-resizing')).toBe('true');
    fireEvent(document, new MouseEvent('pointerup', { bubbles: true, clientX: 520 }));
    expect(scaffold.getAttribute('data-resizing')).toBeNull();
    fireEvent(sizer, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 }));
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

  it('fills the stage when only one surface remains after close', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    expect((container.querySelector('.s2-pane[data-surface-pane="architecture"]') as HTMLElement).style.flex).toMatch(/^0\.5 1 0/);
    fireEvent.click(screen.getByTestId('v3-tab-close-whiteboard'));
    const alone = container.querySelector('.s2-pane[data-surface-pane="architecture"]') as HTMLElement;
    expect(alone).toBeTruthy();
    /* No share left over from the split: the sheet's flex: 1 fills the stage. */
    expect(alone.style.flex).toBe('');
    expect(screen.queryByTestId('s2-split-divider')).toBeNull();
  });

  it('mounts each live surface root when its tab is opened', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Terminal$/ }));
    expect(container.querySelector('.terminal-pane, .v3-terminal-pane, .v3-terminal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/ }));
    expect(container.querySelector('.whiteboard, [data-surface="whiteboard"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Files$/ }));
    expect(container.querySelector('[data-surface="files"]')).toBeTruthy();
    /* Hidden surfaces never mount. */
    expect(container.querySelector('.v3-browser, [data-surface="browser"]')).toBeNull();
    expect(container.querySelector('.v3-ai-canvas, [data-surface="ai-canvas"]')).toBeNull();
  });

  it('opens settings from the sessions rail foot', async () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-rail-settings'));
    expect(container.querySelector('.v3-overlay-scrim')).toBeTruthy();
    /* The overlay loads when it opens (perf ratchet): its body arrives a tick later. */
    /* The overlay's chunk is awaited, not raced: a loaded suite can take longer than findBy's default. */
    await act(async () => {
      await import('../settings/SettingsPanel');
    });
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeTruthy();
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

  it('marks the focused surface pill, and it resolves a fill and an ink', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const focused = container.querySelector('.s2-surfaces button.is-focused');
    expect(focused?.getAttribute('data-tab-id')).toBe('architecture');
    expect(focused?.getAttribute('aria-pressed')).toBe('true');
    const bg = resolvedStyle(focused as Element, 'background');
    const color = resolvedStyle(focused as Element, 'color');
    expect(`${bg} ${color}`.length).toBeGreaterThan(0);
  });

  it('fill-screen win has no floating card radius', () => {
    render(<V3App appStore={freshStore()} />);
    const radius = getComputedStyle(screen.getByTestId('shell')).borderRadius;
    expect(radius === '0px' || radius === '' || Number.parseFloat(radius) === 0).toBe(true);
  });
});

describe('V3 thinking HUD + approvals', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('the mode pill names the mode and its menu holds every mode (Decision 49)', () => {
    const store = createStore({});
    const { container } = render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-mode-label').textContent).toBe('Plan');
    /* The modes are in the mode icon's own menu, not in the model popup. */
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    for (const name of [/^Plan/, /^Smart/, /^Full auto/]) {
      expect(screen.getByRole('menuitemradio', { name })).toBeTruthy();
    }
    expect(container.querySelector('.v3-composer')).toBeTruthy();
  });

  it('the bar holds only +, the one pill (mode icon, model) and send; the where-row shows when the status bar is off', () => {
    setStatusBar(false);
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-composer-where')).toBeTruthy();
    /* THE CONTROLS THE OWNER COUNTED, before anything is opened (the context ring
       joins them once a model reports its window). */
    const bar = document.querySelector('.s2-cb')!;
    expect(Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'))).toEqual([
      'v3-tools-trigger',
      's2-mode-trigger',
      'v3-model-trigger',
      'composer-send',
    ]);
    expect(screen.queryByTestId('v3-effort-trigger')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    expect(screen.getByRole('menuitem', { name: /Attach a file/ })).toBeTruthy();
    setStatusBar(true);
  });

  it('renders the live line as phase, then the clock last (no Round or helper copy)', () => {
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
    expect(hud.textContent).not.toMatch(/Round/);
    expect(hud.textContent).not.toMatch(/tool and model steps/i);
    expect(screen.queryByTestId('v3-thinking-status')).toBeNull();
    /* THE TIMER IS THE LAST COLUMN (owner, 2026-09-19). */
    const bar = screen.getByTestId('v3-thinking-bar');
    const order = [...bar.children].map((el) => el.getAttribute('data-testid')).filter((id): id is string => id !== null);
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

  it('goalbar prefixes Working, on the active plan step while in flight', async () => {
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
      expect(screen.getByTestId('v3-goalbar-step').textContent).toMatch(/Working, Add the guard/),
    );
  });

  it("the turn bill says in and out, and its title says it is not the context fill", () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: { type: 'usage', inputTokens: 11_100, outputTokens: 1_100, estimated: false },
    });
    store.dispatch({ type: 'turn/event', at: 3, event: { type: 'result', text: 'here is the answer' } });
    render(
      <StoreProvider store={store}>
        <div className="v3-chat-col">
          <V3Chat />
        </div>
      </StoreProvider>,
    );
    const bill = screen.getByTestId('v3-turn-bill');
    expect(bill.textContent).toBe('11.1k in1.1k out');
    expect(bill.getAttribute('title')).toMatch(/Turn bill/i);
    expect(bill.getAttribute('title')).toMatch(/not the context fill/i);
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
  it('the model pill opens the models above a reasoning slider: a stop per effort, labels under, the current one filled', () => {
    const withModel = freshStore();
    /* Reasoning belongs to a model: with none chosen the popup hides it. */
    withModel.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
    render(<V3App appStore={withModel} />);
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    const menu = screen.getByRole('menu', { name: 'Model and reasoning' });
    const slider = within(menu).getByTestId('s2-effort-slider');
    const thumb = within(slider).getByRole('slider', { name: 'Reasoning effort' });
    expect(thumb.getAttribute('aria-valuemax')).toBe('3');
    expect(thumb.getAttribute('aria-valuenow')).toBe('2');
    expect(thumb.getAttribute('aria-valuetext')).toBe('Medium');
    /* SLIDER (owner's Cursor reference): Faster/Smarter at the ends, a dot per level named by its label,
       "Recommended" under Medium, and the chosen level is the one filled. */
    expect(slider.textContent).toBe('FasterSmarterRecommended');
    expect(within(slider).getByTestId('s2-effort-recommended').style.getPropertyValue('--rt-x')).toBe(String(2 / 3));
    expect(within(slider).getByRole('button', { name: 'Off' }).getAttribute('data-effort')).toBe('none');
    expect(within(slider).getByRole('button', { name: 'Low' }).getAttribute('data-effort')).toBe('low');
    expect(within(slider).getByRole('button', { name: 'Medium' }).getAttribute('data-effort')).toBe('medium');
    expect(within(slider).getByRole('button', { name: 'High' }).getAttribute('data-effort')).toBe('high');
    expect(screen.getByTestId('v3-effort-read').textContent).toBe('Medium');
    expect(screen.getByTestId('v3-effort-medium').getAttribute('data-on')).toBe('true');
    expect(screen.getByTestId('v3-effort-medium').className).toMatch(/is-on/);
    expect(screen.getByTestId('v3-effort-high').className).not.toMatch(/is-on/);
    expect(thumb.style.getPropertyValue('--rt-x')).toBe(String(2 / 3));
    /* the thumb is a real slider: keyboard moves it */
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(screen.getByTestId('v3-effort-read').textContent).toBe('High');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Reasoning effort' }), { key: 'Home' });
    expect(screen.getByTestId('v3-effort-read').textContent).toBe('Off');
  });

  /* DECISION 36 — the plus carries the mode, the agent chip carries the model. */
  it('the mode pill wears the mode, and with no model the model pill names the action in full', () => {
    render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('v3-mode-label').textContent).toBe('Plan');
    expect(screen.getByTestId('v3-tools-trigger').querySelector('svg')).toBeTruthy();
    const pill = screen.getByTestId('v3-model-trigger');
    expect(pill.querySelector('svg')).toBeTruthy();
    expect(pill.querySelector('.s2-pill-l')!.textContent).toBe('Connect agent');
    expect(pill.getAttribute('data-action')).toBe('connect');
    expect(pill.getAttribute('title')).toBeTruthy();
  });

  it('the panel foot lists Open project above Settings', () => {
    render(<V3App appStore={freshStore()} />);
    const open = screen.getByTestId('v3-rail-open-project');
    const settings = screen.getByTestId('v3-rail-settings');
    expect(open.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
      expect(screen.getByTestId('v3-goalbar-step').textContent).toMatch(/Working, Add the guard/),
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
        <StatusBar />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('composer-context-label')).toBeNull();
    expect(document.querySelector('.s2-cb [data-testid="composer-context"]')).toBeNull();
    const ring = within(screen.getByTestId('s2-status-context')).getByTestId('composer-context');
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

  it('Effort High writes localStorage immediately, and the menu stays open on the slider', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
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
    expect(screen.getByTestId('v3-effort-high').getAttribute('data-on')).toBe('true');
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

  it('an open surface closes from its pane head without being focused first', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Terminal$/ }));
    expect(container.querySelector('.s2-pane[data-surface-pane="terminal"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v3-tab-close-terminal'));
    expect(container.querySelector('.s2-pane[data-surface-pane="terminal"]')).toBeFalsy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   DECISION 35 — one `+` menu and a shelved palette
   DECISION 36 — three controls on the row, one-line rows, a segmented meter
   ══════════════════════════════════════════════════════════════════════════ */

describe('the composer’s one menu', () => {
  it("B's + menu: what can go into the message, New goal, Customize; the modes live on the mode pill", () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const menu = screen.getByRole('menu', { name: 'Add to the message' });
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((r) => r.getAttribute('data-testid'))).toEqual([
      'v3-tools-attach',
      's2-tools-image',
      's2-tools-mention',
      's2-tools-slash',
      'v3-new-goal',
      'v3-tools-customize',
    ]);
    expect(within(menu).queryByRole('menuitemradio')).toBeNull();
  });



  it('Customize opens Settings, which is where models, skills and MCP servers are edited', async () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-tools-customize'));
    expect(screen.queryByRole('menu', { name: 'Add to the message' })).toBeNull();
    /* The overlay's chunk is awaited, not raced: a loaded suite can take longer than findBy's default. */
    await act(async () => {
      await import('../settings/SettingsPanel');
    });
    expect(await screen.findByTestId('settings-panel')).toBeTruthy();
  });

  /* A saved Ask must NOT widen. The real path: V3App's hydrate loads it as Plan, rewrites the saved pair
     through the keys the composer saves to, and the composer says so once. */
  it('a saved Ask loads as Plan through the real hydrate, says so once, and does not repeat', async () => {
    localStorage.setItem('v3.composer.mode', 'build');
    localStorage.setItem('v3.composer.access', 'ask');
    const first = freshStore();
    const v = render(<V3App appStore={first} />);
    expect(first.getState().composer.permission.mode).toBe('plan');
    expect(first.getState().composer.permission.access).toBe('autoEdit');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('plan');
    expect((await screen.findByTestId('s2-mode-note')).textContent).toContain('Ask mode is now Plan. Pick Smart to let the agent edit.');
    expect(localStorage.getItem('v3.composer.mode')).toBe('plan');
    expect(localStorage.getItem('v3.composer.access')).toBe('autoEdit');
    v.unmount();
    /* the next launch: still Plan, no note */
    const second = freshStore();
    render(<V3App appStore={second} />);
    expect(second.getState().composer.permission.mode).toBe('plan');
    expect(screen.queryByTestId('s2-mode-note')).toBeNull();
  });

  it('the quick mode menu from the pill picks Smart', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.click(screen.getByTestId('s2-quickmode-smart'));
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('smart');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('aria-label')).toBe('Mode: Smart');
  });

  it('picking a mode from the mode menu names it on the pill and closes the menu', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    expect(screen.queryByTestId('s2-mode-teach')).toBeNull();
    fireEvent.click(screen.getByTestId('s2-quickmode-smart'));
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('data-mode')).toBe('smart');
    expect(screen.getByTestId('v3-mode-label').textContent).toBe('Smart');
  });

});

describe('the reasoning rail', () => {

  /* Owner, 2026-09-19: "when you go to slash mode, you can't really find
     Teach anywhere, which is kind of annoying." */
  it('the slash menu offers the three modes (Plan, Smart, Full auto)', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.change(screen.getByTestId('composer-field'), { target: { value: '/' } });
    const names = screen.getAllByTestId('v3-slash-item').map((b) => b.getAttribute('data-command'));
    for (const mode of ['plan', 'smart', 'full']) expect(names).toContain(mode);
    expect(names).not.toContain('build');
  });

  it('an outside press closes the slash menu; the next keystroke reopens it', () => {
    render(<V3App appStore={freshStore()} />);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/' } });
    expect(screen.queryByTestId('v3-slash')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('v3-slash')).toBeNull();
    fireEvent.change(field, { target: { value: '/p' } });
    expect(screen.queryByTestId('v3-slash')).not.toBeNull();
  });

  it('typing /smart puts the composer in Smart', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.change(screen.getByTestId('composer-field'), { target: { value: '/smart' } });
    const row = screen.getAllByTestId('v3-slash-item').find((b) => b.getAttribute('data-command') === 'smart');
    expect(row).toBeTruthy();
    fireEvent.mouseDown(row!);
    expect(screen.getByTestId('v3-mode-label').textContent).toBe('Smart');
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
    /*
     * THE COUNT IS THE POINT, NOT "Show more" — and so the number is DERIVED
     * rather than written down. It used to read `/^Show 2 more$/`, which was
     * true of the five commands that existed the day it was written and went
     * red the moment a sixth was added (`/draw`, 2026-09-21). A hard number
     * here asserts the size of the menu, which nothing promised, instead of
     * the property the shelf actually has: it shows three and says how many it
     * is holding back. See `derive-the-subject-set`.
     */
    /* No modes are passed: this filters to the COMMANDS shelf, and the modes
       argument only ever builds the modes one. Reaching into V3Chat for its
       private MODE_ROWS to feed an argument that is then discarded would widen
       a module's surface for a value this case does not use. */
    const commands = slashCommands([], TOOLBELT, { goal: true, board: true }).filter(
      (c) => slashGroupOf(c.source) === 'commands',
    );
    const hidden = commands.length - SLASH_SECTION_PREVIEW;

    expect(hidden, 'this case only means anything while something IS hidden').toBeGreaterThan(0);
    const more = screen.getByTestId('v3-slash-more-commands');
    expect(more.textContent).toBe(`Show ${hidden} more`);
  });

  it('opening a shelf shows the rest and takes the count away', () => {
    render(<V3App appStore={freshStore()} />);
    typeSlash();
    fireEvent.mouseDown(screen.getByTestId('v3-slash-more-commands'));
    expect(screen.queryByTestId('v3-slash-more-commands')).toBeNull();
    expect(screen.getAllByTestId('v3-slash-item').length).toBeGreaterThan(5);
  });
});
