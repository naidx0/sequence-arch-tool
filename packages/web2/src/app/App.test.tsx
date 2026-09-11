import { resolve } from 'node:path';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import { resolvedStyle, substituteVars } from '../../test/support/css';
import { App } from './App';
import { WORKSPACE_PANE_STORAGE_KEY } from './chromeTabModel';
import { ConnectedIndexRail } from './ConnectedIndexRail';
import { buildFunctionIndex } from '../rail';
import { twoPackageFunctions, twoPackages } from '../rail/fixtures';
import { loadRealRepoScan } from '../rail/realRepoScan.testSupport';
import { CanvasProvider, ConnectedBoard, DocProvider, seqdFromGraph } from '../canvas';
import { summarizeGraph } from '../boot';
import type { ReviewClient } from '../review';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';

/* ══════════════════════════════════════════════════════════════════════════
   THE WIRING LANE'S LOCKS — Waves 4 and 5, mounted.
   packages/web2/src/app/App.test.tsx

   WHAT THIS TIER IS FOR AND WHAT IT IS EXPLICITLY NOT FOR.

   `e2e/app-mounted.mjs` is the real lock: a real browser over the shipped
   bundle, fed by a real scan and a real `git diff`, asking "can a person who
   opens this app reach the rail and reach review". That question CANNOT be
   answered here — jsdom paints nothing, and the last three waves each shipped a
   surface that was green in jsdom and absent from the product.

   What this file adds is the two things jsdom is better at than a browser: it
   runs on every `vitest` invocation rather than only when Chromium is present,
   and it can hold a REAL scanned graph in memory and check the wiring maps it
   correctly without a network. So the division is deliberate:

     here   the composition — which component the shell's rail slot holds, which
            component the overlay host answers 'review' with, and what the
            connector does with a real graph and a real click
     e2e    that any of it is reachable, painted and correct in the bundle

   NOTHING HERE ASSERTS A DISPATCH LANDED. CANON §6: "This project has twice
   shipped a test asserting that a dispatch landed while the button opened
   nothing." Every assertion below reads the DOM, or reads the STORE after a
   real `fireEvent.click` on a real row — never a spy standing in for either.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── the real graph, cache optional ─────────────────────────────────────────
 *
 * `.sequence/graph.json` is the engine's own cache for this repository,
 * written by the real scanner. It is gitignored, so a fresh clone has none.
 * `loadRealRepoScan` reuses it locally and invokes the analyzer's deterministic,
 * key-free builders when it is absent. CI therefore exercises this wiring
 * instead of printing a reassuring suite name beside a skip.
 * ─────────────────────────────────────────────────────────────────────────── */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const { graph: GRAPH, functions: FUNCTIONS } = await loadRealRepoScan(REPO);

/**
 * A client that answers ONLY `/api/functions`, out of the engine's own cache.
 *
 * Every other method refuses, and refuses rather than throwing, because the
 * rail must not depend on any of them — a stub that answered them all would
 * hide a connector that had quietly started calling one.
 */
function clientServing(functions: GetFunctionsResponse | null): ReviewClient {
  const refuse = async () => ({ outcome: 'unreachable', message: 'not served in this test' }) as const;
  return {
    status: refuse,
    diff: refuse,
    /* Refused like the rest: this test asserts which routes a connector calls,
       so a revisions stub that answered would hide a caller that started
       asking for one. */
    revisions: refuse,
    writeFile: refuse,
    commit: refuse,
    discard: refuse,
    /* Refused for the same reason as the rest: this test asserts WHICH
       routes a connector reaches for, and a checkpoints stub that
       answered would hide the rail quietly starting to ask. */
    checkpoint: refuse,
    checkpoints: refuse,
    planRestore: refuse,
    restore: refuse,
    functions: async () =>
      functions === null
        ? ({ outcome: 'error', status: 404, body: null } as const)
        : ({ outcome: 'ok', status: 200, body: { functionGraph: functions.functionGraph } } as const),
  };
}

/** A store holding a real scan, built the way `App.tsx` builds the real one —
 *  same projector, same token read — so a defect in that composition shows up
 *  here rather than being configured around. */
function storeWithGraph(graph: GetArchGraphResponse): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: REPO,
      repoName: graph.repoName ?? 'sequence',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt ?? new Date().toISOString(),
    },
    at: Date.now(),
  });
  return store;
}

/**
 * THE WINDOW IS WIDENED, AND THAT IS PART OF THE ASSERTION RATHER THAN SETUP.
 *
 * `shellModel.ts` puts the rail in COLUMN mode only at the `wide` breakpoint
 * (`WIDE_MIN = 1100`), and an overlay pane "always starts closed… an overlay
 * that opened itself on a resize is a panel appearing over the work". jsdom's
 * default window is 1024px, so a rail that is correctly hidden there would make
 * "the rail is mounted" unanswerable and the first draft of this file read
 * `Unable to find shell-rail` against a perfectly correct shell.
 *
 * Setting it here says the frame this suite asks its question about is a
 * desktop one. It is set BEFORE each render because `Shell.tsx` measures the
 * window in a mount effect, and reset afterwards so no other file inherits it.
 */
const JSDOM_DEFAULT_WIDTH = window.innerWidth;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    value: JSDOM_DEFAULT_WIDTH,
    configurable: true,
  });
  window.localStorage.clear();
});

/** Open Architecture pill when not already visible. */
function openArchitectureTab() {
  const pill = screen.getByTestId('workspace-tab-architecture');
  if (pill.getAttribute('data-on') !== 'true') {
    fireEvent.click(pill);
  }
}

/** A token's live value, read through the same substitution the sheets use. */
function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

describe('the shell mounts the surfaces the lanes built', () => {
  /*
   * THE ONE THAT WOULD HAVE CAUGHT WAVE 2. `App.tsx` passed
   * `rail={<NotYet what="Index" wave="Wave 4" />}` while `src/rail/` held 81
   * green tests. Both halves are asserted, because only one of them moves when
   * somebody adds the real rail BESIDE the placeholder instead of in place of
   * it — and a rail under a "Built in Wave 4" panel is the same defect wearing
   * a different hat.
   *
   * DECISION 5 + P2.5: chat alone is the default; Architecture is one tab
   * press. Composition locks that need the board open that tab first.
   */
  function openArchitecture() {
    openArchitectureTab();
  }

  function openSessions() {
    expect(screen.getByTestId('workspace-rail')).toBeTruthy();
  }

  it('puts the real index rail in the board pane, and no not-yet panel beside either', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitecture();

    expect(screen.queryByTestId('notyet-index')).toBeNull();
    const region = screen.getByTestId('board-region');
    /* Index starts collapsed — open it to prove the real rail is wired. */
    fireEvent.click(within(region).getByTestId('board-index-toggle'));
    expect(within(region).getByTestId('rail')).toBeTruthy();

    openSessions();
    expect(screen.getByTestId('shell-settings-gear')).toBeTruthy();
    expect(screen.queryByTestId('shell-settings-corner')).toBeNull();
  });

  it('the sessions-rail settings entry opens the SAME overlay the palette command opens', () => {
    const appStore = storeWithGraph(GRAPH);
    render(<App appStore={appStore} />);

    fireEvent.click(screen.getByTestId('shell-settings-gear'));

    expect(appStore.getState().shell.overlay).toEqual({
      kind: 'settings',
      pane: 'provider',
    });
    /* And it is on screen inside the ONE host, not merely dispatched. */
    expect(screen.getByTestId('overlay-settings')).toBeTruthy();
  });

  it('boots a blank workspace on chat alone with workspace pills', () => {
    /*
     * Owner P2.5: default opens to one chatbot view. Architecture and
     * Whiteboard are one pill press away; board pane is not forced on.
     */
    render(<App />);

    expect(screen.getByTestId('workspace-tabs')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-chat').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('shell-workspace')).toBeTruthy();
    expect(screen.getByTestId('shell-cb')).toBeTruthy();
    expect(screen.getByTestId('workspace-rail')).toBeTruthy();
    expect(screen.queryByTestId('board-region')).toBeNull();
    expect(screen.getByTestId('shell').getAttribute('data-tab-layout')).toBe('true');
    expect(screen.getByTestId('chat-empty-attach')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-architecture')).toBeTruthy();
    expect(screen.queryByTestId('workspace-tab-sessions')).toBeNull();
  });

  it('workspace Architecture / Whiteboard pills mount the board pane', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-whiteboard'));
    expect(screen.getByTestId('board-region')).toBeTruthy();
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-whiteboard').getAttribute('aria-selected')).toBe(
      'true',
    );

    openArchitecture();
    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('aria-selected')).toBe(
      'true',
    );
    /* Owner multi-pane: opening Architecture does not close Whiteboard. */
    expect(screen.getAllByTestId('board-region')).toHaveLength(2);
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
  });

  it('AI Canvas pill mounts the typed-canvas surface', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-ai-canvas'));
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-ai-canvas').getAttribute('aria-selected')).toBe('true');
  });

  it('chat + AI Canvas stay split when AI Canvas is the focused pill', () => {
    /* Owner: clicking AI Canvas used to drop the split (active=ai-canvas was
       excluded), forcing a hunted Chat re-click. Chat stays left; canvas right. */
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-ai-canvas'));
    expect(screen.getByTestId('shell-workspace-split')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-chat')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
  });

  it('workspace + menu: Files is attach-gated; Browser is a pill (C2.5); Terminal is a pill (C1.3)', () => {
    render(<App />);
    expect(screen.getByTestId('workspace-tab-terminal')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-browser')).toBeTruthy();
    fireEvent.click(screen.getByTestId('workspace-plus'));
    const menu = screen.getByTestId('workspace-plus-menu');
    const files = within(menu).getByTestId('workspace-plus-files');
    expect(files.hasAttribute('disabled')).toBe(true);
    expect(within(menu).queryByTestId('workspace-plus-terminal')).toBeNull();
    expect(within(menu).queryByTestId('workspace-plus-browser')).toBeNull();
    /* Files is shipped — only needs an attached repo. Do not call it "not shipped". */
    expect(files.getAttribute('title')).toMatch(/attach a repository/i);
    expect(files.getAttribute('title')).not.toMatch(/not shipped/i);
    expect(files.textContent).toMatch(/attach a repo/i);
    expect(files.textContent).not.toMatch(/not shipped/i);
  });

  it('Browser workspace pill mounts the pane (C2.5)', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-browser'));
    expect(screen.getByTestId('workspace-tab-browser').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-pane-browser')).toBeTruthy();
  });

  it('Terminal workspace pill mounts the pane (C1.3); composer opens Terminal when shipped (C1.7)', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-terminal'));
    expect(screen.getByTestId('workspace-tab-terminal').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('terminal-pane')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-pane-terminal')).toBeTruthy();
    const composerTerminal = screen.getByTestId('composer-terminal');
    expect(composerTerminal.hasAttribute('disabled')).toBe(false);
    expect(composerTerminal.getAttribute('title')).toBe('Open terminal');
  });

  it('Browser workspace pill mounts the pane (C2.5); composer opens Browser when shipped', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('workspace-tab-browser'));
    expect(screen.getByTestId('workspace-tab-browser').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
    const composerBrowser = screen.getByTestId('composer-browser');
    expect(composerBrowser.hasAttribute('disabled')).toBe(false);
    expect(composerBrowser.getAttribute('title')).toBe('Open browser');
  });

  it('workspace + menu glyphs are unique vs pills and each other (C+B)', () => {
    render(<App />);
    const chatIcon = screen
      .getByTestId('workspace-tab-chat')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const archIcon = screen
      .getByTestId('workspace-tab-architecture')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const wbIcon = screen
      .getByTestId('workspace-tab-whiteboard')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const aiIcon = screen
      .getByTestId('workspace-tab-ai-canvas')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const termIcon = screen
      .getByTestId('workspace-tab-terminal')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const browserIcon = screen
      .getByTestId('workspace-tab-browser')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    const railSessionsIcon = screen
      .getByTestId('workspace-rail-sessions')
      .querySelector('svg')
      ?.getAttribute('data-icon');
    expect(chatIcon).toBe('chatbox');
    expect(archIcon).toBe('board');
    expect(wbIcon).toBe('frame');
    expect(aiIcon).toBe('spark');
    expect(termIcon).toBe('terminal');
    expect(browserIcon).toBe('link');
    /* Sessions rail = book thread (option C); New chat keeps newthread. */
    expect(railSessionsIcon).toBe('thread');

    fireEvent.click(screen.getByTestId('workspace-plus'));
    const menu = screen.getByTestId('workspace-plus-menu');
    const plusIcons = {
      files: within(menu).getByTestId('workspace-plus-files').querySelector('svg')?.getAttribute('data-icon'),
    };
    expect(plusIcons).toEqual({
      files: 'file',
    });
    const all = [chatIcon, archIcon, wbIcon, aiIcon, termIcon, browserIcon, railSessionsIcon, ...Object.values(plusIcons)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('composer Terminal control opens the Terminal workspace pill (C1.7)', () => {
    render(<App />);
    const terminal = screen.getByTestId('composer-terminal');
    expect(terminal.getAttribute('aria-label')).toBe('Terminal');
    expect(terminal.getAttribute('title')).toBe('Open terminal');
    expect(terminal.hasAttribute('disabled')).toBe(false);
    fireEvent.click(terminal);
    expect(screen.getByTestId('workspace-tab-terminal').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('terminal-pane')).toBeTruthy();
  });

  it('composer Browser control opens the Browser workspace pill (C2.5)', () => {
    render(<App />);
    const browser = screen.getByTestId('composer-browser');
    expect(browser.getAttribute('aria-label')).toBe('Browser');
    expect(browser.getAttribute('title')).toBe('Open browser');
    expect(browser.hasAttribute('disabled')).toBe(false);
    fireEvent.click(browser);
    expect(screen.getByTestId('workspace-tab-browser').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
  });

  it('workspace + Files opens Architecture with the index rail expanded when attached', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    expect(screen.getByTestId('shell').getAttribute('data-board')).toBe('off');

    fireEvent.click(screen.getByTestId('workspace-plus'));
    const files = within(screen.getByTestId('workspace-plus-menu')).getByTestId(
      'workspace-plus-files',
    );
    expect(files.hasAttribute('disabled')).toBe(false);
    fireEvent.click(files);

    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('board-region')).toBeTruthy();
    const rail = screen.getByTestId('board-region-rail');
    expect(rail.getAttribute('data-collapsed')).toBe('false');
    expect(within(rail).getByTestId('rail')).toBeTruthy();
  });

  it('Architecture pill toggle hides board when focused again', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitecture();
    expect(screen.getByTestId('board-region')).toBeTruthy();
    fireEvent.click(screen.getByTestId('workspace-tab-architecture'));
    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('data-on')).toBe('false');
    expect(screen.queryByTestId('board-region')).toBeNull();
    fireEvent.click(screen.getByTestId('workspace-tab-architecture'));
    expect(screen.getByTestId('board-region')).toBeTruthy();
  });

  it('host Files open keeps board; unshipped third view refuses without displacing', async () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    fireEvent.click(screen.getByTestId('workspace-plus'));
    fireEvent.click(
      within(screen.getByTestId('workspace-plus-menu')).getByTestId('workspace-plus-files'),
    );
    expect(screen.getByTestId('board-region')).toBeTruthy();
    expect(screen.getByTestId('board-region-rail').getAttribute('data-collapsed')).toBe('false');

    /* Palette / host board command must not drop Files — in-slot switch only. */
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'whiteboard' } });
    fireEvent.click(screen.getAllByTestId('command-row')[0]!);
    expect(screen.getByTestId('workspace-tab-whiteboard').getAttribute('aria-selected')).toBe(
      'true',
    );
    /* Architecture stays open — separate panes, not one exclusive board slot. */
    expect(screen.getAllByTestId('board-region').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
  });

  it('blank workspace still lists general sessions in the left rail', async () => {
    render(<App />);
    expect(screen.getByTestId('session-home-context')).toBeTruthy();
    expect(screen.getByTestId('session-home-repo').textContent).toMatch(/local workspace/i);
    expect(screen.getByTestId('workspace-rail')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('sessions-panel')).toBeTruthy());
  });

  it('chat and architecture both highlight and split when both are visible', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    expect(screen.getByTestId('workspace-tab-chat').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('shell-workspace-split')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-chat')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-board')).toBeTruthy();
  });

  it('three visible pills paint three equal workspace panes', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    fireEvent.click(screen.getByTestId('workspace-tab-whiteboard'));
    expect(screen.getByTestId('shell-workspace-split')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-chat')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-board')).toBeTruthy();
    expect(screen.getByTestId('shell-workspace-pane-whiteboard')).toBeTruthy();
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
  });

  it('clicking inside a pane focuses that workspace tab', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    fireEvent.click(screen.getByTestId('workspace-tab-whiteboard'));
    expect(screen.getByTestId('workspace-tab-architecture').getAttribute('data-on')).toBe('true');
    const archPane = screen.getByTestId('shell-workspace-board');
    expect(archPane.getAttribute('data-focused')).toBe('false');
    fireEvent.pointerDown(archPane);
    expect(archPane.getAttribute('data-focused')).toBe('true');
  });

  it('multi-pane split exposes workspace resizers and inline grid tracks', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    const split = screen.getByTestId('shell-workspace-split');
    expect(split.getAttribute('data-workspace-split')).toBe('resizable');
    expect(screen.getByTestId('shell-workspace-resizer-chat')).toBeTruthy();
    expect(split.style.gridTemplateColumns).toMatch(/\d+px 8px \d+px/);
  });

  it('the workspace resizer can be GRABBED — 8px was under the WCAG floor', () => {
    /*
     * MEASURED IN THE RUNNING APP: this button was 8 x 639 CSS px — the smallest
     * target on screen and the only one a reader DRAGS rather than taps. WCAG 2.2
     * AA 2.5.8's floor is 24 x 24, and its spacing exception cannot rescue it:
     * that needs 24px of clearance to the next target and the board's first card
     * began 4px away.
     *
     * The grab area grows LEFT ONLY. The chat's nearest control is 34px away; the
     * board is 4px away, so a symmetric 24px strip would have swallowed the left
     * edge of the leftmost card at z-index 1 — trading a drag defect for a click
     * one. Verified after the change: grab area 24 x 639, intruding 0px into the
     * board, with the drawn line still centred on 748 exactly as before.
     *
     * The 8px GRID TRACK is unchanged and still asserted above — the track is the
     * layout, the button is the target, and this is the whole point: they are
     * allowed to differ.
     */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    const resizer = screen.getByTestId('shell-workspace-resizer-chat');
    const width = resolvedStyle(resizer, 'width');
    /* IN PIXELS, AND THEN ABOVE THE FLOOR — in that order, because
       `Number.parseFloat('100%')` is 100 and sails past a bare `>= 24`. The
       mutation that restored `width: 100%` was caught only by the token
       comparison below until this line learned to check the unit. */
    expect(width).toMatch(/^\d+(\.\d+)?px$/);
    expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(24);
    /* And it is the FLOOR that is asserted, not a literal: a bare equality
       against --target-min would go green again the day the token is lowered. */
    expect(resolvedStyle(resizer, 'width')).toBe(token('--target-min'));
  });

  it('dragging a workspace resizer retargets column widths and remembers them', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    const split = screen.getByTestId('shell-workspace-split');
    const before = split.style.gridTemplateColumns;

    const resizer = screen.getByTestId('shell-workspace-resizer-chat');
    fireEvent.mouseDown(resizer, { clientX: 200 });
    fireEvent.mouseMove(window, { clientX: 250 });
    fireEvent.mouseUp(window);

    expect(split.style.gridTemplateColumns).not.toBe(before);
    expect(window.localStorage.getItem(WORKSPACE_PANE_STORAGE_KEY)).toBeTruthy();
  });

  it('workspace resizer drag does not steal pane focus', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    fireEvent.click(screen.getByTestId('workspace-tab-whiteboard'));
    const archPane = screen.getByTestId('shell-workspace-board');
    expect(archPane.getAttribute('data-focused')).toBe('false');
    fireEvent.mouseDown(screen.getByTestId('shell-workspace-resizer-chat'), { clientX: 0 });
    expect(archPane.getAttribute('data-focused')).toBe('false');
  });
});

describe('the whiteboard has a door in the palette', () => {
  it('switches the attached canvas to the real whiteboard', () => {
    render(<App appStore={storeWithGraph(twoPackages())} />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'whiteboard' } });

    const row = screen.getAllByTestId('command-row')[0]!;
    expect(row.getAttribute('data-command')).toBe('canvas.whiteboard');
    expect(row.getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(row);

    expect(screen.getByTestId('whiteboard')).toBeTruthy();
    expect(screen.getByTestId('workspace-tab-whiteboard').getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('review has a home a person can reach', () => {
  /**
   * DRIVEN THROUGH THE PALETTE THE USER USES, not through a dispatch.
   *
   * The interesting failure here is not "does OverlayHost have a review arm" —
   * that is one line and a reader can see it. It is "is there any sequence of
   * actions that reaches it", which is the exact question Wave 2 answered wrong
   * about a whole shell. So this test presses Ctrl-K on `window`, types into
   * the real field, and clicks the real row. If the command register loses the
   * row, or the row renders disabled because the overlay renderer went missing,
   * this goes red and a test that dispatched `shell/overlay` directly would not.
   */
  function openThePalette() {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    return screen.getByTestId('command-surface');
  }

  it('offers review in the command surface, enabled', () => {
    render(<App />);
    openThePalette();

    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'review' } });
    const rows = screen.getAllByTestId('command-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-command')).toBe('overlay.review');
    /* ENABLED, ASSERTED SEPARATELY. `Shell.tsx` renders an unavailable command
       as a row that does nothing and prints why beside it, so a review row that
       is present and inert would satisfy a presence check while being exactly
       the surface-nobody-can-reach defect. */
    expect(rows[0].getAttribute('aria-disabled')).toBeNull();
    expect(within(rows[0]).queryByTestId('command-why')).toBeNull();
  });

  it('opens the real review pane, not the not-yet panel', async () => {
    render(<App />);
    openThePalette();

    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'review' } });
    fireEvent.click(screen.getByTestId('command-row'));

    const pane = await screen.findByTestId('review');
    expect(screen.queryByTestId('overlay-review')).toBeNull();
    /* Inside the ONE overlay host, because "two open at once is not a state the
       shell has a layout for" and a pane rendered outside the host is a second
       one by another name. */
    expect(screen.getByTestId('shell-overlay').contains(pane)).toBe(true);
    /* Its own scope control is on screen, so this is the surface and not an
       empty box wearing its testid. */
    expect(screen.getAllByTestId('review-scope-seg').length).toBeGreaterThan(1);
  });

  it('closes review on Escape and leaves the rail standing', async () => {
    /* Decision 5 + P2.5: open Architecture so the board pane exists, then
       assert Escape leaves it standing. */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    openThePalette();
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'review' } });
    fireEvent.click(screen.getByTestId('command-row'));
    await screen.findByTestId('review');

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('review')).toBeNull());
    expect(screen.getByTestId('board-region')).toBeTruthy();
    expect(screen.getByTestId('board-index-toggle')).toBeTruthy();
  });

  it('Proposed edits opens Review on Last turn, not Unstaged git', async () => {
    /* Seat Gate 4: chat's opens:review door must load the session proposal.
       Opening Unstaged (working tree) was the inverted fix that hid Accept. */
    const store = storeWithGraph(GRAPH);
    store.dispatch({ type: 'composer/draft', text: 'propose a helper' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      at: 2,
      event: {
        type: 'edit:proposal',
        title: 'Seat4 health helper',
        files: [{ path: 'gateway/src/lib/seat4-health.ts', content: 'export const ok = 1;\n' }],
      },
    });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'result', text: 'Proposed for review.' },
      at: 3,
    });

    const turn = store.getState().session.turns.find((t) => t.role === 'assistant');
    if (!turn || turn.role !== 'assistant' || turn.effect.kind !== 'propose') {
      throw new Error('expected a propose effect');
    }

    render(<App appStore={store} />);
    fireEvent.click(screen.getByTestId('chat-opens-row'));

    const pane = await screen.findByTestId('review');
    expect(pane.getAttribute('data-scope')).toBe('last-turn');
    expect(screen.getAllByText('gateway/src/lib/seat4-health.ts').length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY VIEW HAS A DOOR, AND THE DOOR IS THE ONE THAT EXISTS.
   ══════════════════════════════════════════════════════════════════════════ */

describe('the activity view has a home a person can reach', () => {
  /**
   * §5.2 of the plan asks for this surface because "multi-agent work is
   * unusable without 'which of my N threads needs me' answerable from outside
   * the app", and Codex answers it on a dedicated chord. Sequence has one
   * command surface, so the palette IS the way in — and a way in that nobody
   * can walk is the Wave 2 defect this whole file exists to police.
   *
   * DRIVEN THROUGH THE PALETTE THE USER USES, exactly as the review block above
   * is: Ctrl-K on `window`, a real change event on the real field, a real click
   * on the real row.
   */
  function openThePalette() {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    return screen.getByTestId('command-surface');
  }

  it('offers the activity view in the command surface, enabled', () => {
    render(<App />);
    openThePalette();

    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'activity' } });
    const rows = screen.getAllByTestId('command-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('data-command')).toBe('overlay.activity');
    /* ENABLED, ASSERTED SEPARATELY. `Shell.tsx` renders an unavailable command
       as a row that does nothing and prints why beside it, so a row that is
       present and inert would satisfy a presence check while being exactly the
       surface-nobody-can-reach defect. */
    expect(rows[0].getAttribute('aria-disabled')).toBeNull();
    expect(within(rows[0]).queryByTestId('command-why')).toBeNull();
  });

  it('opens the real activity pane inside the one overlay host', async () => {
    render(<App />);
    openThePalette();

    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'activity' } });
    fireEvent.click(screen.getByTestId('command-row'));

    const pane = await screen.findByTestId('activity');
    expect(screen.getByTestId('shell-overlay').contains(pane)).toBe(true);
  });

  it('states the absence rather than a count, with no engine behind it', async () => {
    /*
     * THE STATE THE APP IS ACTUALLY IN HERE. jsdom has no Sequence engine, so
     * `GET /api/program/runs` never returns a list — which makes this the one
     * place in the suite where the surface is exercised against a real absent
     * engine rather than a `runs={null}` prop. It must say so, and it must draw
     * no bucket count over a list it has not read.
     */
    render(<App />);
    openThePalette();
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'activity' } });
    fireEvent.click(screen.getByTestId('command-row'));

    const pane = await screen.findByTestId('activity');
    await waitFor(() =>
      expect(
        pane.querySelector('[data-testid="activity-unanswered"]') ??
          pane.querySelector('[data-testid="activity-failure"]'),
      ).not.toBeNull(),
    );
    expect(pane.querySelector('[data-testid="activity-list"]')).toBeNull();
    expect(pane.querySelectorAll('[data-testid="activity-row"]')).toHaveLength(0);
    expect(pane.querySelector('[data-testid="activity-buckets"]')).toBeNull();
  });

  it('closes the activity view on Escape and leaves the rail standing', async () => {
    /* Decision 5 + P2.5: open Architecture so the board pane exists. */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openArchitectureTab();
    openThePalette();
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'activity' } });
    fireEvent.click(screen.getByTestId('command-row'));
    await screen.findByTestId('activity');

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('activity')).toBeNull());
    expect(screen.getByTestId('board-region')).toBeTruthy();
    expect(screen.getByTestId('board-index-toggle')).toBeTruthy();
  });
});

/**
 * THE PROVIDERS THE PRODUCT MOUNTS, IN THE ORDER THE PRODUCT MOUNTS THEM.
 *
 * `App.tsx` puts `CanvasProvider` inside `StoreProvider`, because the canvas
 * channel seeds itself from `store.getState().canvas`. A test that arranged
 * them differently — or that left the canvas one out and let `useCanvas` fall
 * back to something private — would be exercising a composition that does not
 * ship, which is how a green suite comes to describe a different application
 * from the one a person opens.
 */
function Mounted({ store, children }: { store: Store; children: ReactNode }) {
  return (
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>{children}</DocProvider>
      </CanvasProvider>
    </StoreProvider>
  );
}

/* This suite is collected only after `loadRealRepoScan` has either read the
   engine cache or built the same real-repo result from source. There is no
   cache-dependent branch left that can turn these assertions into skips. */
describe('the rail connector, over a real scan', () => {
  const graph: GetArchGraphResponse = GRAPH;

  /** The nodes the rail's first rung is built from. */
  const realIds = new Set(graph.nodes.map((n) => n.id));

  it('draws a card rung for every node the scan produced, and invents none', () => {
    render(
      <Mounted store={storeWithGraph(graph)}>
        <ConnectedIndexRail />
      </Mounted>,
    );

    const cards = screen
      .getAllByTestId('rail-row')
      .filter((row) => row.getAttribute('data-rung') === 'card');

    expect(cards.length).toBeGreaterThan(0);
    const invented = cards
      .map((row) => row.getAttribute('data-row-id'))
      .filter((id) => id === null || !realIds.has(id));
    expect(invented).toEqual([]);
  });

  it('draws the file rung, so the index has the depth the store can supply', () => {
    render(
      <Mounted store={storeWithGraph(graph)}>
        <ConnectedIndexRail />
      </Mounted>,
    );

    const files = screen
      .getAllByTestId('rail-row')
      .filter((row) => row.getAttribute('data-rung') === 'file');
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * THE GESTURE THE BOARD ALREADY BINDS, BOUND THE SAME WAY IN THE RAIL.
   *
   * `Board.tsx`: "Selecting a grounded node and grounding the composer on it
   * are the same gesture, so there is exactly one chip per click and no second
   * control to find." A card row and a card are the same `ArchNode`, and this
   * asserts on the STORE after a real click rather than on a callback — a
   * connector that called `onFocusNode` and dropped it would pass any spy.
   */
  it('grounds the composer on the node whose row was clicked', () => {
    const store = storeWithGraph(graph);
    render(
      <Mounted store={store}>
        <ConnectedIndexRail />
      </Mounted>,
    );

    expect(store.getState().composer.chips).toEqual([]);

    const card = screen
      .getAllByTestId('rail-row')
      .find((row) => row.getAttribute('data-rung') === 'card')!;
    const nodeId = card.getAttribute('data-row-id')!;
    fireEvent.click(card);

    const chips = store.getState().composer.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0].ref).toBe(nodeId);
    expect(chips[0].kind).toBe('node');

    /* And a second click on the same row does not stack a duplicate — the
       store dedupes by id, and this is what makes reading down the rail safe. */
    fireEvent.click(card);
    expect(store.getState().composer.chips).toHaveLength(1);
  });

  /**
   * THE CLICK IS ANSWERED ON SCREEN AS WELL AS IN THE STORE. The chip is the
   * half a person cannot see from the rail; the detail panel is the half they
   * can. Asserting only the first is how a surface comes to feel dead while
   * every test is green.
   */
  it('opens the node detail panel on the same click', () => {
    render(
      <Mounted store={storeWithGraph(graph)}>
        <ConnectedIndexRail />
      </Mounted>,
    );

    expect(screen.queryByTestId('rail-detail')).toBeNull();
    const card = screen
      .getAllByTestId('rail-row')
      .find((row) => row.getAttribute('data-rung') === 'card')!;
    fireEvent.click(card);
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
  });

  /**
   * THE ROW COUNTS ARE THE ENGINE'S, NOT A ZERO STANDING IN FOR ONE.
   *
   * THIS IS THE TEST THE SCREENSHOT WROTE. Mounted with `functions: null` — the
   * state the rail lane left and the state the store still produces — the rail
   * prints `0` beside every file and every card, because `buildRailRows`
   * derives both counts from the index it was not given. Five hundred rows each
   * asserting the scan found no function in that file, on a repository where it
   * found thousands. Graphite law 4, broken on every row, and invisible to all 81
   * of the rail's own tests because every one of them is handed a real index.
   *
   * So this asserts the fix at its root rather than the symptom: the connector
   * ASKS for the index, and what lands on the rows is the engine's own number.
   * A connector that fetched and dropped the answer, or that fetched into state
   * the rail never sees, fails here while any spy on the client would pass.
   */
  it('fills the rows with the engine’s own function counts, not zeros', async () => {
    render(
      <Mounted store={storeWithGraph(graph)}>
        <ConnectedIndexRail client={clientServing(FUNCTIONS)} />
      </Mounted>,
    );

    /* THE WAIT IS ON A NON-ZERO COUNT, which is the only observable that
       cannot be true before the answer lands. Waiting on "the rail rendered"
       would pass instantly against the zeros this test exists to forbid. */
    await waitFor(() => {
      const printed = screen
        .getAllByTestId('rail-row')
        .filter((row) => row.getAttribute('data-rung') === 'file')
        .map((row) => (row.textContent ?? '').trim().match(/(\d+)$/)?.[1]);
      expect(printed.some((n) => n !== undefined && Number(n) > 0)).toBe(true);
    });

    /* THE NUMBER IS CHECKED AGAINST THE INDEX, not against itself. `byFile` is
       what `buildFunctionIndex` produced from the engine's cache, so a row
       reading 4 is right only if the engine names four functions in that file. */
    const index = buildFunctionIndex(FUNCTIONS);
    let checked = 0;
    for (const row of screen
      .getAllByTestId('rail-row')
      .filter((row) => row.getAttribute('data-rung') === 'file')) {
      const label = row.querySelector('.rail-name')?.textContent ?? '';
      /* Skipped when the file's own name is borne by more than one path — this
         repo has 15 files called `index.ts` (CANON §3) and picking the first
         match would be checking a number against a different file. */
      const matches = Object.keys(index.byFile).filter((p) => p.endsWith(`/${label}`));
      if (matches.length !== 1) continue;
      const printed = (row.textContent ?? '').trim().match(/(\d+)$/)?.[1];
      if (printed === undefined) continue;
      expect(Number(printed)).toBe(index.byFile[matches[0]].length);
      checked += 1;
      if (checked >= 25) break;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('renders no playback strip until a flow is playing', () => {
    render(
      <Mounted store={storeWithGraph(graph)}>
        <ConnectedIndexRail />
      </Mounted>,
    );
    /* A strip with nothing playing would be a control with no subject. This is
       the resting state; the test below is the state after a click. */
    expect(screen.queryByTestId('rail-strip')).toBeNull();
    expect(screen.getByTestId('rail')).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM playback — A CLICK IN THE RAIL MOVES THE BOARD.

   WHAT THIS REPLACES. The test that used to sit here asserted the opposite and
   was right to: "the cursor is held in `ConnectedIndexRail`… What it does NOT
   do is move the board." The rail and the board were two React trees with no
   state between them, the flow panel's heading had been retreated from "Plays
   on board" to "Traced path" because of it, and the Waves 4/5 gate had watched
   a traced function click in the shipped bundle change no board node's class,
   selection or camera.

   WHAT THIS TIER CAN AND CANNOT ANSWER. jsdom paints nothing and measures
   nothing, so THE CAMERA IS NOT ASSERTED HERE — `e2e/flow-plays.mjs` is the
   lock for that, in a real browser over the shipped bundle, and this file's own
   header says why that division exists. What jsdom is better at is exactly what
   is asserted below: the two surfaces mounted together, one click, and the
   resulting CLASS AND STATE on a specific card.

   THE FIXTURE IS USED RATHER THAN THE REAL SCAN, AND THE REASON IS MEASURED.
   `.sequence/functions.json` for this monorepo holds thousands of call edges and NOT
   ONE crosses a package, so every real flow here resolves `inside` a single
   service — a true and important case, and the only one, which would leave the
   `direct` branch of the resolver untested against any real click.
   `twoPackageFunctions()` has a call from `packages/alpha` into
   `packages/beta`, so both branches are exercised by one flow.
   ══════════════════════════════════════════════════════════════════════════ */
describe('item playback — the flow plays on the board', () => {
  /** Mount the two surfaces the way the shell mounts them: siblings, one slice. */
  function mountBoth() {
    const store = storeWithGraph(twoPackages());
    const view = render(
      <Mounted store={store}>
        <ConnectedBoard />
        <ConnectedIndexRail client={clientServing(twoPackageFunctions())} />
      </Mounted>,
    );
    return { store, view };
  }

  const boardNode = (id: string) =>
    screen.getAllByTestId('board-node').find((el) => el.getAttribute('data-node-id') === id);

  const rowNamed = (rung: string, name: string) =>
    screen
      .getAllByTestId('rail-row')
      .filter((row) => row.getAttribute('data-rung') === rung)
      .find((row) => (row.querySelector('.rail-name')?.textContent ?? '').trim() === name);

  /** Open `one.ts` and click `openGate`, which is the traced function. */
  async function playOpenGate() {
    await waitFor(() => expect(rowNamed('file', 'one.ts')).toBeTruthy());
    fireEvent.click(rowNamed('file', 'one.ts')!);
    await waitFor(() => expect(rowNamed('function', 'openGate')).toBeTruthy());
    fireEvent.click(rowNamed('function', 'openGate')!);
    await waitFor(() => expect(screen.queryByTestId('rail-strip')).toBeTruthy());
  }

  it('lights the hop’s node and dims what the flow never touches', async () => {
    mountBoth();
    await playOpenGate();

    /* HOP 1 OF 2 runs alpha→alpha (one.ts calls two.ts, same package), so it
       resolves `inside svc:alpha` — the board focuses the service the hop
       happened in and says, in its own note, that it has no crossing to draw. */
    /*
     * WAITED FOR, BECAUSE THE BOARD REACTS ONE EFFECT-HOP AFTER THE RAIL.
     *
     * `playOpenGate` above waits for the rail's own strip, which is the last
     * thing the RAIL renders — but the board learns about the flow through
     * `canvasChannel`, and `canvas/flow-focus` is dispatched from an effect, so
     * there is another commit to come. Reading synchronously measured whether
     * that commit had happened yet: this passed at 330ms standalone and failed
     * at 1510ms inside a full gate.
     *
     * The expected value is unchanged. `waitFor` polls the same assertion until
     * the render settles instead of sampling it once at whatever moment the
     * machine's load produced, and the assertions below then read a DOM that has
     * stopped moving.
     */
    await waitFor(() =>
      expect(boardNode('svc:alpha')!.getAttribute('data-selected')).toBe('true'),
    );

    /* AND THE REST OF THE BOARD RECEDES. `store:pg` is on no hop of this flow,
       so sheet 06.6's dim is spent on it — which it may be, because this is
       playback and not an ordinary click. */
    expect(boardNode('store:pg')!.getAttribute('data-dimmed')).toBe('true');
    /* svc:beta is on the SECOND hop, so it is lit even before the playhead
       reaches it: the lit set is the whole path, not the current step. */
    expect(boardNode('svc:beta')!.getAttribute('data-dimmed')).toBe('false');
  });

  it('moves the focused card when the reader scrubs to the next hop', async () => {
    mountBoth();
    await playOpenGate();
    expect(boardNode('svc:alpha')!.getAttribute('data-selected')).toBe('true');

    /* THE SCRUB IS THE PRODUCT'S OWN CONTROL, driven as a person drives it. A
       test that dispatched `canvas/flow-cursor` directly would assert that a
       reducer works, which `canvasReduce.test.ts` already does; this asserts
       that the control in front of the reader is wired to it. */
    fireEvent.change(screen.getByTestId('rail-scrub'), { target: { value: '1' } });

    await waitFor(() =>
      expect(boardNode('svc:beta')!.getAttribute('data-selected')).toBe('true'),
    );
    // ONE card, never two — a second would read as a multi-selection.
    expect(boardNode('svc:alpha')!.getAttribute('data-selected')).toBe('false');
  });

  it('says what it cannot show, instead of sitting still and saying nothing', async () => {
    mountBoth();
    await playOpenGate();

    /* HOP 1 IS `inside`. The board focuses svc:alpha and moves to it — a real
       response — but it has no crossing to draw, and the difference between a
       board that says so and one that does not is the difference between
       grounded and "why did the picture stop changing". */
    const note = screen.getByTestId('board-flow-note');
    expect(note.querySelector('.t')!.textContent).toContain('Hop 1 of 2');
    expect(note.querySelector('.s')!.textContent).toContain('no crossing');

    /* HOP 2 IS `direct` — alpha really does call into beta — so the board shows
       it and the note is gone. A note that stayed would be the surface
       explaining an absence that is not there. */
    fireEvent.change(screen.getByTestId('rail-scrub'), { target: { value: '1' } });
    await waitFor(() => expect(screen.queryByTestId('board-flow-note')).toBeNull());
  });

  it('gives the board back when the flow is cleared', async () => {
    mountBoth();
    await playOpenGate();
    expect(boardNode('store:pg')!.getAttribute('data-dimmed')).toBe('true');

    fireEvent.click(screen.getByTestId('rail-clear'));

    await waitFor(() => expect(boardNode('store:pg')!.getAttribute('data-dimmed')).toBe('false'));
    expect(boardNode('svc:alpha')!.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('rail-strip')).toBeNull();
  });
});

describe('C4.3 board selection syncs the rail', () => {
  function mountBoth() {
    const store = storeWithGraph(twoPackages());
    render(
      <Mounted store={store}>
        <ConnectedBoard />
        <ConnectedIndexRail client={clientServing(twoPackageFunctions())} />
      </Mounted>,
    );
  }

  const boardNode = (id: string) =>
    screen.getAllByTestId('board-node').find((el) => el.getAttribute('data-node-id') === id);

  it('clicking a board card highlights the matching card row and opens detail', async () => {
    mountBoth();
    await waitFor(() => expect(boardNode('svc:alpha')).toBeTruthy());
    fireEvent.click(boardNode('svc:alpha')!);

    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-testid="rail-row"][data-rung="card"][data-row-id="svc:alpha"][data-selected="true"]',
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
  });
});
