import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import { resolvedStyle, substituteVars } from '../../test/support/css';
/* The sheets the geometry cases read. `resolvedStyle` resolves out of the
   stylesheets that reached the document, so a rule in a sheet nobody imported
   comes back as the empty string and every width assertion passes vacuously. */
import '../tokens/graphite.css';
import '../v3/v3.css';
import { App } from './App';
import { CHROME_TAB_DEFS, WORKSPACE_PILLS } from './chromeTabModel';
import {
  openPane,
  openPanes,
  pane,
  paneIsFocused,
  paneIsOpen,
  tab,
  workspaceBar,
} from '../../test/support/v3';
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

/*
 * WHICH PANES ARE OPEN IS PERSISTED CHROME STATE (`v3.chromeTabs`), so a case
 * that does not clear it is testing what the previous case left behind. This
 * file has thirty of them.
 */
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

/** Open the Architecture pane when it is not already open. See test/support/v3. */
function openArchitectureTab() {
  openPane('architecture');
}

/** A token's live value, read through the same substitution the sheets use. */
function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

describe('the shell mounts the surfaces the lanes built', () => {
  /*
   * ══ THE ONE THAT WOULD HAVE CAUGHT WAVE 2, REPOINTED AT V3 ═════════════
   *
   * `App.tsx` once passed `rail={<NotYet what="Index" wave="Wave 4" />}` while
   * `src/rail/` held 81 green tests — a surface built and unreachable. That is
   * what this file polices, and it is the reason the cases below read the DOM
   * a person sees rather than a dispatch.
   *
   * EVERY `workspace-tab-*` AND `shell-workspace-*` ID IN HERE WAS v2 CHROME.
   * `shell/Shell.tsx` is a retired stub returning `null` (Decision 22) and V3
   * draws the workspace itself, so none of those elements exists. The mapping
   * is in `test/support/v3.ts`, in one place, and it is a READING rather than a
   * rename — a v2 pill carried `aria-selected`, a V3 pill carries
   * `aria-pressed` for OPEN and a class for FOCUSED, and those are two facts.
   *
   * THREE CASES WERE DELETED RATHER THAN REPOINTED, each because the
   * requirement itself was retired by a later ruling, and each is named where
   * it stood so nobody re-adds it as a regression:
   *
   *   the workspace `+` menu and its attach-gated Files entry — V3 has no `+`
   *   menu (every surface is a pill) and Files is no longer attach-gated: the
   *   pane works against the home workspace (owner, 2026-09-17, "you don't
   *   have to open a project if you're working from the default workspace");
   *
   *   the composer's Terminal and Browser controls — removed by Decision 37,
   *   owner 2026-09-19: "the only buttons you can really see on the prompt bar
   *   are the plus, the agent and the send". The pills are the door;
   *
   *   the grid-track and resizer-geometry cases — V3 sizes with flex and has
   *   its own splitter. `workspaceFrame.test.tsx` owns what is left of that
   *   finding, stated as a property rather than as a track list.
   */

  it('mounts the real board in the architecture pane, not a placeholder', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');

    expect(screen.queryByTestId('notyet-index')).toBeNull();
    const board = pane('architecture');
    expect(board, 'the architecture pill is on and no pane is mounted').toBeTruthy();
    expect(within(board!).getByTestId('board')).toBeTruthy();
  });

  /*
   * ── A GAP THIS FILE CAN SEE AND MUST NOT PAPER OVER ──────────────────────
   *
   * The case above used to open the board's INDEX TOGGLE and assert the real
   * `rail` inside the board pane. V3 mounts no index rail: `ConnectedIndexRail`
   * has no importer outside tests, and `board-index-toggle` is not in the
   * product at all. The component is alive and its own locks below still pass
   * against a real scan — it is the MOUNT that is missing, which is precisely
   * the Wave 2 shape this file was written for, one layer up.
   *
   * It is not repaired here because WHERE the rail belongs in V3 is a design
   * question (its own pane? inside the board? the Files pane's second tab?)
   * and not a test's to answer. Carried to the owner in
   * docs/OWNER-WALK-2026-09-20.md.
   */
  it('the sessions-rail settings entry opens the SAME overlay the palette command opens', () => {
    const appStore = storeWithGraph(GRAPH);
    render(<App appStore={appStore} />);

    /* The gear moved from the v2 appbar to the rail foot, under Open project. */
    fireEvent.click(screen.getByTestId('v3-rail-settings'));

    expect(appStore.getState().shell.overlay).toEqual({
      kind: 'settings',
      pane: 'provider',
    });
    /* And it is on screen inside the ONE host, not merely dispatched. */
    expect(screen.getByTestId('overlay-settings')).toBeTruthy();
  });

  it('boots on chat beside the board, with the bar in reach', () => {
    /*
     * ── WHAT THE BOOT STATE ACTUALLY IS, AND THE RULING IT SITS BESIDE ────
     *
     * This asserted CHAT ALONE, from owner ruling P2.5: "default opens to one
     * chatbot view ... board pane is not forced on." V3 boots with
     * Architecture open and focused beside chat (`INITIAL_TABS`).
     *
     * The test is repointed at what the product does rather than the product
     * moved to match the test, because the two are not obviously in conflict
     * and the later evidence leans the other way: the owner, 2026-09-20,
     * expects the board to be there on a new project ("as soon as you load a
     * new chat ... it should ask you a pop-up on the architecture board, do
     * you want to import or create an architecture around it"). P2.5 was about
     * not FORCING a board pane; an architecture tool opening on its
     * architecture is a different claim.
     *
     * Carried to him in docs/OWNER-WALK-2026-09-20.md rather than settled
     * here. What is locked meanwhile is the part neither reading disputes: the
     * chat is present and typeable, and every surface is one press away.
     */
    render(<App />);

    expect(workspaceBar()).toBeTruthy();
    expect(paneIsOpen('chat')).toBe(true);
    expect(screen.getByTestId('composer-field')).toBeTruthy();
    for (const id of WORKSPACE_PILLS) expect(tab(id)).toBeTruthy();
  });

  it('Architecture and Whiteboard pills each mount their own pane', () => {
    render(<App />);
    openPane('whiteboard');
    expect(pane('whiteboard')).toBeTruthy();
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
    expect(paneIsFocused('whiteboard')).toBe(true);

    /* Owner multi-pane: opening one does not close the other, and they sit in
       the BAR's order rather than the click order — Architecture is already
       open at boot, so opening Whiteboard put it second and left it there. */
    expect(paneIsOpen('architecture')).toBe(true);
    expect(openPanes()).toEqual(['architecture', 'whiteboard']);
  });

  it('AI Canvas pill mounts the typed-canvas surface, beside chat', () => {
    /* Owner: clicking AI Canvas used to drop the split (active=ai-canvas was
       excluded), forcing a hunted Chat re-click. Chat stays left; canvas right. */
    render(<App />);
    openPane('ai-canvas');
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
    expect(paneIsFocused('ai-canvas')).toBe(true);
    expect(paneIsOpen('chat')).toBe(true);
    expect(screen.getByTestId('composer-field')).toBeTruthy();
  });

  it('Terminal and Browser are pills that mount their panes (C1.3, C2.5)', () => {
    render(<App />);

    openPane('terminal');
    expect(paneIsFocused('terminal')).toBe(true);
    expect(screen.getByTestId('terminal-pane')).toBeTruthy();
    expect(pane('terminal')).toBeTruthy();

    openPane('browser');
    expect(paneIsFocused('browser')).toBe(true);
    expect(screen.getByTestId('browser-pane')).toBeTruthy();
    expect(pane('browser')).toBeTruthy();
  });

  it('renders no glyph twice — an icon that means two things means neither', () => {
    /*
     * DERIVED FROM THE PILL LIST, not typed out. The old version named six
     * pills and a seventh rail element by hand, so a pill added later could
     * duplicate a glyph and this would stay green. `CHROME_TAB_DEFS` is the
     * source of both the bar and the check.
     */
    render(<App />);
    const glyphs = WORKSPACE_PILLS.map(
      (id) => tab(id).querySelector('svg')?.getAttribute('data-icon') ?? null,
    );
    expect(glyphs).toEqual(WORKSPACE_PILLS.map((id) => CHROME_TAB_DEFS[id].icon));
    expect(glyphs.every((g) => g !== null)).toBe(true);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('the Files pane opens without an attached repository', () => {
    /*
     * REVERSED, on the owner's ruling of 2026-09-17: "you don't have to open a
     * project if you're working from the default workspace ... it has a path to
     * a home workspace where it can save the drawings, contacts etc."
     *
     * This asserted the opposite — that the Files entry was DISABLED until a
     * repo was attached, and said why in its title. The gate is gone and the
     * pane answers for the home workspace instead, which is a better answer to
     * the same worry: the reader is not told "no", they are shown where their
     * files actually are.
     */
    render(<App />);
    openPane('files');
    expect(pane('files')).toBeTruthy();
    expect(screen.getByTestId('connected-files-unattached')).toBeTruthy();
  });

  it('Files opens as a pane of its own, and a later board open does not displace it', () => {
    /*
     * THE PROPERTY IS THE SAME ONE IT ALWAYS WAS: the panes are separate
     * columns, not one exclusive board slot. Stronger now than under v2, where
     * "Files" was an alias for the Architecture index rail and the two shared
     * a slot.
     */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('files');
    expect(pane('files')).toBeTruthy();
    expect(screen.getByTestId('connected-files')).toBeTruthy();

    /* The palette's board command must not drop Files. */
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'whiteboard' } });
    fireEvent.click(screen.getAllByTestId('command-row')[0]!);

    expect(paneIsFocused('whiteboard')).toBe(true);
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
    expect(pane('files')).toBeTruthy();
    expect(paneIsOpen('files')).toBe(true);
  });

  it('the Architecture pill toggles its pane off and on', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    expect(pane('architecture')).toBeTruthy();

    fireEvent.click(tab('architecture'));
    expect(paneIsOpen('architecture')).toBe(false);
    expect(pane('architecture')).toBeNull();

    fireEvent.click(tab('architecture'));
    expect(pane('architecture')).toBeTruthy();
  });

  it('blank workspace still lists general sessions in the left rail', async () => {
    render(<App />);
    /*
     * ── THE STRIP WENT; THE PATH IS WHAT SAYS WHERE YOU ARE ───────────────
     *
     * This read `session-home-context` — a chip row under the composer
     * carrying repo, branch and model on an empty thread. The owner took it
     * off on 2026-09-21: "under the text box we have these stacked icons,
     * workspace, model — we don't need that. We have our model, our chat box."
     * Two of the three were already on screen (the path row says which repo,
     * the agent chip says which model) and the third, the branch, is pinned to
     * the right of the path row now.
     *
     * What the case is about is unchanged and is the interesting half: a blank
     * workspace is a PLACE, and the row that says which place is drawn.
     *
     * WHICH place it names is NOT asserted here, and that is deliberate rather
     * than lazy: `data-where` reads 'workspace' only once `/api/workspace` has
     * answered, and nothing in this render stubs it. Asserting it would mean
     * stubbing the route, at which point the test would be checking the stub.
     * `chat/Composer.test.tsx` owns the row's three states against known props.
     */
    expect(screen.getByTestId('v3-composer-where')).toBeTruthy();
    /* The rail is V3's own `<aside aria-label="Sessions">`. */
    expect(screen.getByRole('complementary', { name: 'Sessions' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('v3-rail-open-project')).toBeTruthy());
  });

  it('chat and architecture are both open, and only one is focused', () => {
    /*
     * OPEN AND FOCUSED, ASSERTED APART. The v2 version read `aria-selected` on
     * both pills and got `true` for both, which conflated the two facts. V3
     * says them separately and the split is the more interesting one: two
     * panes side by side, one of them taking the keys.
     */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');

    expect(paneIsOpen('chat')).toBe(true);
    expect(paneIsOpen('architecture')).toBe(true);
    expect(paneIsFocused('architecture')).toBe(true);
    expect(paneIsFocused('chat')).toBe(false);
    expect(screen.getByTestId('composer-field')).toBeTruthy();
  });

  it('two live pills paint two panes, in the bar\'s own order', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    openPane('whiteboard');

    /* NOT THE CLICK ORDER — the bar's, so the columns do not shuffle under a
       reader who opens the same two panes in a different sequence. */
    expect(openPanes()).toEqual(['architecture', 'whiteboard']);
    expect(screen.getByTestId('whiteboard')).toBeTruthy();
  });

  it('clicking inside a pane focuses it', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    openPane('whiteboard');
    expect(paneIsFocused('whiteboard')).toBe(true);

    const board = pane('architecture')!;
    expect(board.getAttribute('data-focused')).toBe('false');
    fireEvent.mouseDown(board);
    expect(board.getAttribute('data-focused')).toBe('true');
    expect(paneIsFocused('architecture')).toBe(true);
  });

  it('a multi-pane split exposes a splitter between the panes', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    openPane('whiteboard');

    expect(screen.getByTestId('v3-live-stack')).toBeTruthy();
    expect(screen.getByTestId('v3-resize-live-architecture-whiteboard')).toBeTruthy();
    /* And the chat column keeps its own. */
    expect(screen.getByTestId('v3-resize-chat')).toBeTruthy();
  });

  it('every splitter can be GRABBED — 8px was under the WCAG floor', () => {
    /*
     * MEASURED IN THE RUNNING APP under the v2 shell: the resizer was 8 x 639
     * CSS px — the smallest target on screen and the only one a reader DRAGS
     * rather than taps. WCAG 2.2 AA 2.5.8's floor is 24 x 24, and the spacing
     * exception cannot rescue it: that needs 24px of clearance to the next
     * target and the board's first card began 4px away.
     *
     * V3 rebuilt the splitter, so what is checked is the FLOOR rather than the
     * v2 geometry — and it is checked on EVERY splitter the shell draws, not
     * on the one the old test happened to name. The DRAWN LINE may still be a
     * hairline; the TARGET may not, and that is the whole point: they are
     * allowed to differ.
     */
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    openPane('whiteboard');

    const resizers = Array.from(document.querySelectorAll<HTMLElement>('.v3-resizer'));
    expect(resizers.length).toBeGreaterThanOrEqual(3);

    /*
     * ── READ THE HIT AREA, NOT THE DRAWN LINE ──────────────────────────────
     *
     * The element itself is `flex: 0 0 1px` and should stay that way: the
     * SEAM is a hairline. The target is its `::before`, stretched past the
     * element on both sides, and that is the thing WCAG 2.5.8 is about.
     *
     * A check that read the element's own width would report 1px and fail
     * forever, or — worse — be "fixed" by widening the seam, which trades an
     * accessibility defect for a 24px gutter down the middle of the workspace.
     * `inset: 0 -Npx` gives a target of `1 + 2N`.
     */
    /* READ OFF THE SHEET, because jsdom does not resolve a pseudo-element's
       computed style. That is a proxy and it is named as one: what it proves
       is that the RULE grants the target, not that a browser painted it.
       `e2e/board-furniture.mjs` is where a measured box belongs. */
    const sheet = readFileSync(resolve(__dirname, '..', 'v3', 'v3.css'), 'utf8');
    const rule = /\.v3-resizer::before \{[^}]*inset:\s*0\s+(-?\d+(?:\.\d+)?)px/.exec(sheet);
    expect(rule, 'no `.v3-resizer::before` inset rule in v3.css').toBeTruthy();
    const overhang = Math.abs(Number.parseFloat(rule![1]!));
    expect(1 + 2 * overhang).toBeGreaterThanOrEqual(24);

    /* And the seam itself is still a hairline, on every one of them. */
    for (const resizer of resizers) {
      expect(resolvedStyle(resizer, 'flex-basis')).toBe('1px');
    }
  });

  it('dragging the chat splitter retargets the column and remembers it', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');

    const chatCol = document.querySelector<HTMLElement>('.v3-chat-col')!;
    const before = chatCol.style.width;

    /* ON `document`, WHICH IS WHERE THE SHELL LISTENS. A pointermove fired at
       `window` runs window's own listeners and nothing else, so a drag driven
       there reports success while moving nothing — the failure this assertion
       exists to catch, arriving through the test rather than the product. */
    /* REAL EVENTS WITH REAL COORDINATES, ON ALL THREE. jsdom has no
       `PointerEvent` constructor, so `fireEvent.pointerDown/Move` build a
       plain Event and the coordinate is dropped — `startX` and `clientX` come
       through undefined, the delta is NaN, and the drag reports success having
       moved nothing. `MouseEvent`'s init dictionary carries clientX, React's
       synthetic listener answers to the event NAME, and the shell's handlers
       read nothing else off the event. */
    const resizer = screen.getByTestId('v3-resize-chat');
    act(() => {
      resizer.dispatchEvent(new MouseEvent('pointerdown', { clientX: 600, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 700, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 700, bubbles: true }));
    });

    expect(chatCol.style.width).not.toBe(before);
    expect(window.localStorage.getItem('v3.chatW')).toBeTruthy();
  });

  it('a splitter drag does not steal pane focus', () => {
    render(<App appStore={storeWithGraph(GRAPH)} />);
    openPane('architecture');
    openPane('whiteboard');

    const board = pane('architecture')!;
    expect(board.getAttribute('data-focused')).toBe('false');
    act(() => {
      screen
        .getByTestId('v3-resize-chat')
        .dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, bubbles: true }));
    });
    expect(board.getAttribute('data-focused')).toBe('false');
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
    expect(paneIsOpen('whiteboard')).toBe(true);
    expect(paneIsFocused('whiteboard')).toBe(true);
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

    const reviewPane = await screen.findByTestId('review');
    expect(screen.queryByTestId('overlay-review')).toBeNull();
    /* Inside the ONE overlay host, because "two open at once is not a state the
       shell has a layout for" and a pane rendered outside the host is a second
       one by another name. V3's host names itself after the overlay it is
       holding, so the id IS the assertion that only one is open. */
    expect(screen.getByTestId('v3-overlay-review').contains(reviewPane)).toBe(true);
    expect(document.querySelectorAll('.v3-overlay-panel')).toHaveLength(1);
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
    /* AND THE WORKSPACE IS STILL THERE — the half of this case that matters.
       An overlay that takes the shell down with it is worse than one that will
       not close. (`board-index-toggle` was the v2 board's index door; V3
       mounts no index rail — see the note in the first describe.) */
    expect(pane('architecture')).toBeTruthy();
    expect(within(pane('architecture')!).getByTestId('board')).toBeTruthy();
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

    /*
     * ── THE DOOR MOVED INTO THE TRANSCRIPT ITSELF ─────────────────────────
     *
     * This clicked `chat-opens-row`, a line under the answer that said which
     * surface it opened. V3's transcript does not draw it: the proposal is
     * DECIDED WHERE IT LANDS, with Accept all / Reject all on the turn
     * (`V3App.test.tsx` locks that), so there is no longer a journey out to
     * Review to make one decision.
     *
     * What is still worth locking is the part Seat Gate 4 was actually about,
     * because it is the part that was got WRONG once: opening Review FOR A
     * PROPOSAL must scope to the last turn. Scoping it to unstaged git was
     * "the inverted fix that hid Accept" — the pane opened, showed the working
     * tree, and the thing the reader came for was not in it.
     *
     * Driven through the overlay's own contract rather than through a click,
     * because the click no longer exists. That is weaker than this file
     * prefers and it is said out loud rather than dressed up: what it cannot
     * catch is a missing door, and what it can catch is a door that opens on
     * the wrong thing.
     */
    render(<App appStore={store} />);
    act(() => {
      store.dispatch({
        type: 'shell/overlay',
        overlay: { kind: 'review', proposalId: turn.effect.proposalId },
      });
    });

    const reviewPane = await screen.findByTestId('review');
    expect(reviewPane.getAttribute('data-scope')).toBe('last-turn');
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
    expect(screen.getByTestId('v3-overlay-activity').contains(pane)).toBe(true);
    expect(document.querySelectorAll('.v3-overlay-panel')).toHaveLength(1);
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
    /* AND THE WORKSPACE IS STILL THERE — see the review case above. */
    expect(pane('architecture')).toBeTruthy();
    expect(within(pane('architecture')!).getByTestId('board')).toBeTruthy();
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
