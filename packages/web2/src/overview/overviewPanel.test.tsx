/**
 * The overview is a compact floating panel, not a column.
 *  - it reserves no grid column and has no height of its own (CSS and shell contract);
 *  - empty sections collapse, and each section says one line about itself;
 *  - the fold to a pill is stored and survives a fresh mount;
 *  - placeOverview, the clamp that keeps it clear of the chat card, is a pure function.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assistantTurn, inFlight, userTurn } from '../chat/fixtures';
import { createStore, StoreProvider, type Store } from '../state';
import shellCss from '../shell2/shell2.css?raw';
import shellSrc from '../shell2/Shell2.tsx?raw';
import { ChatOverview, type OverviewFloat } from './ChatOverview';
import overviewCss from './overview.css?raw';
import { CHAT_CARD_W, CHAT_COMFY_W, CHAT_MIN_W, OVERVIEW_GAP, PANEL_MAX_W, PANEL_MIN_W, PILL_W, placeOverview, type Box, type PlaceInput } from './overviewPlace';
import { OVERVIEW_PILL_KEY } from './overviewPrefs';
import { artifactsSummary, emptyLine, filesSummary, keyCount, listOpenByDefault, progressOpenByDefault, progressSummary, windowLine } from './overviewSummary';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const box = (left: number, right: number, top = 0, bottom = 900): Box => ({ left, right, top, bottom });

describe('the layout contract: it floats', () => {
  it('reserves no grid column: the overview has no grid-column, and the shell grid is the three it always was', () => {
    expect(overviewCss).not.toMatch(/grid-column|grid-row/);
    expect(shellCss).toMatch(/\.s2-row\[data-stage='none'\]\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/);
    expect(shellCss).not.toMatch(/\.ov\b/);
  });

  it('is content-sized: no full-height rule, a max-height from the placement, an inner scroll, and it is absolute over the row', () => {
    expect(overviewCss).not.toMatch(/(^|[^-])height:\s*100%/m);
    expect(overviewCss).not.toMatch(/\.ov[^{]*\{[^}]*\bheight:\s*(100vh|100%|calc)/);
    expect(overviewCss).toMatch(/\.ov-float\s*\{[^}]*position:\s*absolute/);
    expect(overviewCss).toMatch(/\.ov-panel,\s*\.ov-pop\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('takes nothing from the dock room: the shell no longer counts the overview as a docked column', () => {
    expect(shellSrc).not.toMatch(/roomFor\(\{[^}]*overviewShown/);
  });

  it('wears the app glass tokens, not a colour of its own', () => {
    expect(overviewCss).toMatch(/var\(--panel-glass\)/);
    /* no blur of its own: the style ratchet caps backdrop-filters */
    expect(overviewCss).not.toMatch(/^\s*(-webkit-)?backdrop-filter\s*:/m);
    expect(overviewCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('placeOverview (the clamp that avoids the chat card)', () => {
  /* Jaden's seat: 1440 wide, the sidebar open (248 px), the main column 248..1432, the card 960 wide centred in it. */
  const at1440 = { container: box(0, 1440), column: box(248, 1432), chat: box(360, 1320, 60) };
  const at1280 = { container: box(0, 1280), column: box(248, 1272), chat: box(280, 1240, 60) };
  const wideWin = { container: box(0, 1920), column: box(248, 1912), chat: box(606, 1566, 60) };
  /* `legacyFold` is the pill flag an older build stored: placement no longer takes it, so passing it must change nothing. */
  const go = (g: typeof at1440, legacyFold = false, centred = true) => placeOverview({ ...g, centred, collapsed: legacyFold } as PlaceInput);

  it('at 1440 with the sidebar open it is the PANEL: the card shifts left, then narrows, and stays clear of the panel', () => {
    const p = go(at1440);
    expect(p.mode).toBe('panel');
    if (p.mode !== 'panel') return;
    /* CONTRACT CHANGE (0184 fin layout): the panel gives up the last few px before the card drops under 900 (it was 896 at 1440) */
    expect(p.width).toBeLessThanOrEqual(PANEL_MAX_W);
    expect(p.width).toBeGreaterThanOrEqual(PANEL_MIN_W);
    expect(p.chatShift).not.toBeNull();
    expect(p.chatShift!.width).toBeGreaterThanOrEqual(CHAT_COMFY_W);
    const cardLeft = 248 + p.chatShift!.left;
    const cardRight = cardLeft + p.chatShift!.width;
    /* shifted all the way to the sidebar's gap first, narrowed only for what is left */
    expect(cardLeft).toBe(248 + OVERVIEW_GAP);
    expect(p.chatShift!.width).toBeGreaterThanOrEqual(CHAT_MIN_W);
    expect(p.chatShift!.width).toBeLessThan(960);
    const panelLeft = 1440 - p.right - p.width;
    expect(panelLeft).toBeGreaterThanOrEqual(cardRight + OVERVIEW_GAP);
  });

  it('the card keeps the comfortable width while the panel can still give room, at any window width', () => {
    for (let w = 1100; w <= 2000; w += 4) {
      const column = box(248, w - 8);
      const colW = column.right - column.left;
      const w0 = Math.min(CHAT_CARD_W, colW);
      const left0 = column.left + (colW - w0) / 2;
      const p = placeOverview({ container: box(0, w), column, chat: box(left0, left0 + w0, 60), centred: true });
      if (p.mode === 'panel' && p.chatShift && p.chatShift.width < Math.min(CHAT_COMFY_W, w0)) {
        expect(p.width).toBe(PANEL_MIN_W);
      }
    }
  });

  it('a window wide enough needs no shift: the card keeps its place and width', () => {
    const p = go(wideWin);
    expect(p.mode).toBe('panel');
    if (p.mode === 'panel') expect(p.chatShift).toBeNull();
  });

  it('when shifting alone is enough the card keeps its full width', () => {
    /* margin 200, left room 96: shifting 88 leaves the rest to narrowing, so use a left margin big enough for all of it */
    const g = { container: box(0, 1700), column: box(248, 1692), chat: box(380, 1340, 60) };
    const p = go(g);
    expect(p.mode).toBe('panel');
    if (p.mode !== 'panel') return;
    expect(p.chatShift).not.toBeNull();
    expect(p.chatShift!.width).toBe(960);
    expect(248 + p.chatShift!.left + 960 + OVERVIEW_GAP).toBeLessThanOrEqual(1700 - p.right - p.width);
  });

  it('never narrows the card below the composer minimum, at any window width', () => {
    for (let w = 1180; w <= 2000; w += 4) {
      const column = box(248, w - 8);
      const colW = column.right - column.left;
      const w0 = Math.min(CHAT_CARD_W, colW);
      const left0 = column.left + (colW - w0) / 2;
      const p = placeOverview({ container: box(0, w), column, chat: box(left0, left0 + w0, 60), centred: true });
      if (p.mode === 'panel' && p.chatShift) {
        expect(p.chatShift.width).toBeGreaterThanOrEqual(CHAT_MIN_W);
        expect(p.chatShift.left).toBeGreaterThanOrEqual(OVERVIEW_GAP);
        expect(248 + p.chatShift.left + p.chatShift.width + OVERVIEW_GAP).toBeLessThanOrEqual(w - p.right - p.width);
      }
    }
  });

  it('at 1280 with the sidebar open the panel cannot fit: the pill or the chat header, the card unmoved', () => {
    const p = go(at1280);
    expect(p.mode).not.toBe('panel');
    expect(p.chatShift).toBeNull();
  });

  it('CONTRACT CHANGE (0184 finish): the sweep over window widths reaches panel and inline (the pill needs a tighter card, below), and none of them overlaps the card', () => {
    const modes = new Set<string>();
    for (let w = 1100; w <= 2000; w += 4) {
      const column = box(248, w - 8);
      const colW = column.right - column.left;
      const w0 = Math.min(CHAT_CARD_W, colW);
      const left0 = column.left + (colW - w0) / 2;
      const chat = box(left0, left0 + w0, 60);
      const p = placeOverview({ container: box(0, w), column, chat, centred: true });
      modes.add(p.mode);
      if (p.mode === 'pill') expect(w - p.right - PILL_W).toBeGreaterThanOrEqual(chat.right + OVERVIEW_GAP);
    }
    expect([...modes].sort()).toEqual(['inline', 'panel']);
  });

  it('the pill is only what a too-tight margin makes: room for the pill, none for the panel even shifted and narrowed', () => {
    const p = placeOverview({ container: box(0, 1348), column: box(248, 1248), chat: box(268, 1228, 60), centred: true });
    expect(p).toMatchObject({ mode: 'pill', canExpand: false, chatShift: null });
  });

  it('CONTRACT CHANGE (0184 finish): chat-only wide, a stored fold cannot make the panel a pill', () => {
    expect(go(at1440, true)).toMatchObject({ mode: 'panel' });
    expect(go(at1440, true)).toEqual(go(at1440, false));
    const tight = go({ container: box(0, 1300), column: box(248, 1292), chat: box(290, 1250, 60) }, false);
    expect(tight.mode).not.toBe('panel');
  });

  it('only the geometry folds it: where the panel cannot fit the stored flag changes nothing either way', () => {
    expect(go(at1280, true)).toEqual(go(at1280, false));
    expect(go(at1280, true).mode).not.toBe('panel');
  });

  it('with a surface open the margin is the stage, so it is always inline', () => {
    expect(go(at1440, false, false).mode).toBe('inline');
    expect(go(at1440, true, false).mode).toBe('inline');
  });

  it('the panel is bounded by the row below its top', () => {
    const p = placeOverview({ container: box(0, 1700, 0, 300), column: box(248, 1692), chat: box(380, 1340, 60, 300), centred: true });
    expect(p.mode).toBe('panel');
    if (p.mode === 'panel') expect(p.maxHeight).toBe(300 - 60 - OVERVIEW_GAP);
  });

  it('unmeasured (no layout yet) it is the panel, folded or not, and never inline', () => {
    expect(placeOverview({ container: null, column: null, chat: null, centred: true }).mode).toBe('panel');
    expect(go({ container: box(0, 0), column: box(0, 0), chat: box(0, 0) }, true).mode).toBe('panel');
  });
});

describe('the one line each section says', () => {
  it('counts files and edits, cards, and progress', () => {
    expect(filesSummary([{ state: 'read' }, { state: 'edited' }, { state: 'edited' }])).toBe('3 files, 2 edited');
    expect(filesSummary([{ state: 'read' }])).toBe('1 file');
    expect(artifactsSummary(1)).toBe('1 card');
    expect(artifactsSummary(3)).toBe('3 cards');
    expect(progressSummary([{ status: 'done' }, { status: 'active' }], null)).toBe('1 of 2 done');
    expect(progressSummary([], { round: 2, roundCap: 4 })).toBe('Round 2 of 4');
    expect(keyCount([1, 2], [3])).toBe(3);
  });
  it('an empty chat has one line, a chat with either list has none', () => {
    expect(emptyLine(0, 0)).toBe('No files or artifacts yet');
    expect(emptyLine(1, 0)).toBeNull();
    expect(emptyLine(0, 1)).toBeNull();
    expect(emptyLine(0, 0)).not.toContain('·');
  });
  it('a short list opens in place, a long one folds; progress opens while live or unfinished', () => {
    expect(listOpenByDefault(3)).toBe(true);
    expect(listOpenByDefault(4)).toBe(false);
    expect(progressOpenByDefault(true, [{ status: 'done' }])).toBe(true);
    expect(progressOpenByDefault(false, [{ status: 'done' }, { status: 'pending' }])).toBe(true);
    expect(progressOpenByDefault(false, [{ status: 'done' }])).toBe(false);
  });
  it('the window line keeps the usage and the window apart', () => {
    expect(windowLine('27.6k', '128k')).toBe('27.6k of 128k');
    expect(windowLine('27.6k', null)).toBe('27.6k used, window unknown');
    expect(windowLine(null, '128k')).toBe('128k, nothing sent yet');
    expect(windowLine(null, null)).toBe('Not measured');
  });
});

function chatWithFiles(n: number): Store {
  const store = createStore({});
  store.dispatch({
    type: 'session/hydrated',
    turns: [
      userTurn('u1', 'go'),
      assistantTurn('a1', 'u1', { text: 'ok', evidence: { tools: [], filesRead: Array.from({ length: n }, (_, i) => `src/f${i}.ts`), proposals: [] } }),
    ],
  } as never);
  return store;
}
const draw = (store: Store, float?: OverviewFloat) =>
  render(
    <StoreProvider store={store}>
      <ChatOverview onOpenSurface={() => {}} {...(float ? { float } : {})} />
    </StoreProvider>,
  );

describe('empty sections collapse', () => {
  it('an empty chat draws only Context, one quiet line and Quick open', () => {
    draw(createStore({}));
    const sections = [...document.querySelectorAll('[data-testid^="ov-sec-"]')].map((e) => e.getAttribute('data-testid'));
    expect(sections).toEqual(['ov-sec-context', 'ov-sec-quick']);
    expect(screen.getByTestId('ov-empty')).toBeTruthy();
  });

  it('a chat with files only hides the empty Artifacts and shows the Files summary', () => {
    draw(chatWithFiles(2));
    expect(screen.queryByTestId('ov-sec-artifacts')).toBeNull();
    expect(screen.queryByTestId('ov-empty')).toBeNull();
    expect(screen.getByTestId('ov-sum-files').textContent).toBe('2 files');
  });

  it('a long list folds to its summary line and unfolds on a press', () => {
    draw(chatWithFiles(5));
    expect(screen.getByTestId('ov-sum-files').textContent).toBe('5 files');
    expect(screen.queryByTestId('ov-files')).toBeNull();
    fireEvent.click(within(screen.getByTestId('ov-sec-files')).getByRole('button', { name: /Files/ }));
    expect(screen.getAllByTestId('ov-file')).toHaveLength(5);
  });
});

describe('the context rows carry their whole value', () => {
  it('a value the panel has to cut is still readable: the row carries it whole', () => {
    /* The Project row is cut with an ellipsis when the repo and the branch are long - a cut
       value with no way to read it is a value the reader does not have. */
    draw(createStore({}));
    for (const id of ['ov-project', 'ov-model']) {
      const row = screen.getByTestId(id);
      expect(row.getAttribute('title')).toBe(row.textContent);
    }
  });
});

describe('the progress list says what is running', () => {
  const TODOS = [
    { id: 't1', title: 'Read the file', status: 'done' as const },
    { id: 't2', title: 'Write the fix', status: 'active' as const },
  ];
  const settled = (): Store => {
    const store = createStore({});
    store.dispatch({
      type: 'session/hydrated',
      turns: [userTurn('u1', 'go'), assistantTurn('a1', 'u1', { text: 'ok', todos: TODOS, evidence: { tools: [], filesRead: [], proposals: [] } })],
    } as never);
    return store;
  };
  const running = (): Store => {
    const first = createStore({});
    const state = first.getState();
    return createStore({ hydrate: { ...state, session: { ...state.session, inFlight: inFlight({ todos: TODOS }) } } });
  };

  it('a finished turn\'s list is not live: the panel must not say "running" about a run that is over', () => {
    draw(settled());
    expect(screen.getByTestId('ov-todos').getAttribute('data-live')).toBe('false');
  });

  it('the list of a running turn is live', () => {
    draw(running());
    expect(screen.getByTestId('ov-todos').getAttribute('data-live')).toBe('true');
  });

  it('the accent - the panel\'s one hue - is spent on a running step only', () => {
    /* Unscoped, the accent was on every active step, including the one a finished turn left
       active: the panel said "running" about a run that was over. */
    expect(overviewCss).not.toMatch(/(^|\})\s*\.ov-todo\[data-status='active'\]\s+\.ov-mark\s*\{[^}]*--b-acc/);
    expect(overviewCss).toMatch(/\[data-live='true'\][^{]*\.ov-todo\[data-status='active'\]\s+\.ov-mark\s*\{[^}]*--b-acc/);
  });
});

describe('a file row says which file', () => {
  const chatWith = (paths: string[]): Store => {
    const store = createStore({});
    store.dispatch({
      type: 'session/hydrated',
      turns: [userTurn('u1', 'go'), assistantTurn('a1', 'u1', { text: 'ok', evidence: { tools: [], filesRead: paths, proposals: [] } })],
    } as never);
    return store;
  };

  it('names the folder in front of the name, so two files with one name are told apart', () => {
    /* This repository has seventeen files called index.ts. Two rows reading "index.ts" and
       nothing else are two rows the reader cannot use. */
    draw(chatWith(['a/index.ts', 'b/index.ts']));
    expect(screen.getAllByTestId('ov-file-dir').map((d) => d.textContent).sort()).toEqual(['a/', 'b/']);
    expect(screen.getAllByTestId('ov-file-name').map((n) => n.textContent)).toEqual(['index.ts', 'index.ts']);
  });

  it('the folder gives way from its front and the name is never cut', () => {
    expect(overviewCss).toMatch(/\.ov-row-dir\s*\{[^}]*direction:\s*rtl/);
    expect(overviewCss).toMatch(/\.ov-row-dir\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(overviewCss).toMatch(/\.ov-row-n\s*\{[^}]*flex:\s*none/);
  });

  it('a file at the root has no folder to name', () => {
    draw(chatWith(['README.md']));
    expect(screen.queryByTestId('ov-file-dir')).toBeNull();
    expect(screen.getByTestId('ov-file-name').textContent).toBe('README.md');
  });
});

describe('the context window row', () => {
  const metered = (inputTokens: number): Store => {
    const store = createStore({});
    store.dispatch({
      type: 'session/hydrated',
      turns: [userTurn('u1', 'go'), assistantTurn('a1', 'u1', { text: 'ok', usage: { inputTokens, outputTokens: 320 } } as never)],
    } as never);
    return store;
  };

  it('names the measurement when the window is unknown: "Not measured" was a lie about the usage', () => {
    /* The model is one the vendor does not publish a window for (a local model), so the
       window is unknown while the turn was metered. The row said "Not measured" and the
       ring beside it said how much had been sent. */
    draw(metered(27640));
    expect(screen.getByTestId('ov-window').textContent).toBe('27.6k used, window unknown');
  });

  it('says "Not measured" only when nothing was measured at all', () => {
    draw(createStore({}));
    expect(screen.getByTestId('ov-window').textContent).toBe('Not measured');
  });

  it('names the window it knows when nothing has been sent yet', () => {
    /* A chat that has not sent a turn yet still has a window (the model's), and the ring
       beside the row said so: "Window holds 128,000 tokens". The row said nothing was
       measured, which read as "the window is unknown". */
    const store = createStore({});
    store.dispatch({ type: 'composer/context-window', tokens: 128000 } as never);
    draw(store);
    expect(screen.getByTestId('ov-window').textContent).toBe('128k, nothing sent yet');
  });

  it('a known window and a known usage are the pair, in that order', () => {
    const store = metered(27640);
    store.dispatch({ type: 'composer/context-window', tokens: 128000 } as never);
    draw(store);
    expect(screen.getByTestId('ov-window').textContent).toBe('27.6k of 128k');
  });
});

describe('the pill', () => {
  /* The pill is what the GEOMETRY makes of the panel (1280 with the sidebar: no room beside the card): it sits in the chat header. */
  const rectOf = (b: Box) => () => ({ ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) }) as DOMRect;
  const el = (b: Box): HTMLElement => {
    const e = document.createElement('div');
    e.getBoundingClientRect = rectOf(b);
    return e;
  };
  const narrow = (): { slot: HTMLElement; float: OverviewFloat } => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    return { slot, float: { rowRef: { current: el(box(0, 1280)) }, mainRef: { current: el(box(248, 1272)) }, chatRef: { current: el(box(280, 1240, 60)) }, centred: true, headSlot: slot } };
  };

  it('CONTRACT CHANGE (0184 finish): chat-only wide has no manual collapse, and a legacy stored fold cannot suppress it', () => {
    localStorage.setItem(OVERVIEW_PILL_KEY, '1');
    const f: OverviewFloat = { rowRef: { current: el(box(0, 1440)) }, mainRef: { current: el(box(248, 1432)) }, chatRef: { current: el(box(360, 1320, 60)) }, centred: true, headSlot: null };
    draw(createStore({}), f);
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('panel');
    expect(screen.queryByTestId('ov-collapse')).toBeNull();
    expect(screen.queryByRole('button', { name: /collapse overview/i })).toBeNull();
    expect(screen.getByTestId('ov-sec-context')).toBeTruthy();
  });

  it('unmeasured too: the legacy flag draws the panel and no collapse control', () => {
    localStorage.setItem(OVERVIEW_PILL_KEY, '1');
    draw(createStore({}));
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('panel');
    expect(screen.queryByTestId('ov-collapse')).toBeNull();
  });

  it('a surface opening moves it to the header, and returning to chat-only restores the panel', () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    const wide = (centred: boolean): OverviewFloat => ({ rowRef: { current: el(box(0, 1440)) }, mainRef: { current: el(box(248, 1432)) }, chatRef: { current: el(box(360, 1320, 60)) }, centred, headSlot: slot });
    const store = createStore({});
    const view = draw(store, wide(true));
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('panel');
    const again = (f: OverviewFloat) => view.rerender(<StoreProvider store={store}><ChatOverview onOpenSurface={() => {}} float={f} /></StoreProvider>);
    again(wide(false));
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('inline');
    expect(slot.contains(screen.getByTestId('ov-pill'))).toBe(true);
    again(wide(true));
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('panel');
    expect(screen.queryByTestId('ov-collapse')).toBeNull();
    slot.remove();
  });

  it('narrow layouts still fold on their own, at 1280 and at 420', () => {
    const { slot, float } = narrow();
    const v = draw(createStore({}), float);
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('inline');
    expect(slot.contains(screen.getByTestId('ov-pill'))).toBe(true);
    v.unmount();
    const phone: OverviewFloat = { rowRef: { current: el(box(0, 420)) }, mainRef: { current: el(box(0, 420)) }, chatRef: { current: el(box(0, 420, 60)) }, centred: true, headSlot: slot };
    draw(createStore({}), phone);
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('inline');
    expect(slot.contains(screen.getByTestId('ov-pill'))).toBe(true);
    slot.remove();
  });

  it('carries the key count', () => {
    const { slot, float } = narrow();
    draw(chatWithFiles(3), float);
    expect(screen.getByTestId('ov-pill-count').textContent).toBe('3');
    expect(screen.getByTestId('ov-pill').getAttribute('aria-label')).toBe('Overview, 3 files, 0 cards');
    slot.remove();
  });

  it('draws no middle dot', () => {
    const { slot, float } = narrow();
    const { container } = draw(chatWithFiles(3), float);
    expect(container.textContent).not.toContain('·');
    expect(slot.textContent).not.toContain('·');
    slot.remove();
  });
});

describe('placed from real bounds', () => {
  const rectOf = (b: Box) => () => ({ ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) }) as DOMRect;
  const el = (b: Box): HTMLElement => {
    const e = document.createElement('div');
    e.getBoundingClientRect = rectOf(b);
    return e;
  };
  const floatOf = (card: Box, centred = true, headSlot: HTMLElement | null = null): OverviewFloat => ({
    rowRef: { current: el(box(0, 1440)) },
    mainRef: { current: el(box(248, 1432)) },
    chatRef: { current: el(card) },
    centred,
    headSlot,
  });

  it('at 1440 with the sidebar open it draws the floating panel and shifts the chat card for it, then gives the card back', () => {
    const f = floatOf(box(360, 1320, 60));
    const card = f.chatRef.current!;
    const view = draw(createStore({}), f);
    const root = screen.getByTestId('chat-overview');
    expect(root.getAttribute('data-kind')).toBe('panel');
    expect(root.className).toContain('ov-float');
    expect(root.style.width).toBe(`${PANEL_MAX_W - 4}px`); /* 4 px to the card: 900, not 896 (0184 fin layout) */
    expect(card.getAttribute('data-ov-shift')).toBe('true');
    expect(card.style.getPropertyValue('--ov-left')).toBe(`${OVERVIEW_GAP}px`);
    view.unmount();
    expect(card.hasAttribute('data-ov-shift')).toBe(false);
    expect(card.style.getPropertyValue('--ov-w')).toBe('');
  });

  it('where the panel cannot fit (1280) the pill sits in the header and opens the panel as a popover that Escape closes', () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    const f = { ...floatOf(box(280, 1240, 60), true, slot), mainRef: { current: el(box(248, 1272)) }, rowRef: { current: el(box(0, 1280)) } };
    draw(createStore({}), f);
    expect(screen.getByTestId('chat-overview').getAttribute('data-kind')).toBe('inline');
    expect(slot.contains(screen.getByTestId('ov-pill'))).toBe(true);
    expect(screen.queryByTestId('ov-pop')).toBeNull();
    fireEvent.click(screen.getByTestId('ov-pill'));
    expect(screen.getByTestId('ov-pop').querySelector('[data-testid="ov-sec-context"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ov-pop')).toBeNull();
    slot.remove();
  });

  it('with a surface open it sits in the chat header slot, not floating', () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    draw(createStore({}), floatOf(box(240, 700, 60), false, slot));
    const root = screen.getByTestId('chat-overview');
    expect(slot.contains(root)).toBe(true);
    expect(root.getAttribute('data-kind')).toBe('inline');
    expect(root.className).not.toContain('float');
    slot.remove();
  });
});
