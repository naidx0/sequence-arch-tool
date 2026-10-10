import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import * as layoutPrefs from './layoutPrefs';
import { PEEK_DEFAULT, PEEK_MAX, PEEK_MIN, PANE_MIN_PX, equalShares, holdShares, normalizeShares, readPaneShares, readPeekWidth, resizeShares, writePaneShares } from './layoutPrefs';

/*
 * ROUND 14, lane "shell" (Jaden, 10-09): the surface bar sits on the chat header's line and is centred over
 * its column; no arrow circle, the bar is dragged; the names fold to icons when they do not fit, and the
 * layout holds at the Electron minimum. Layout numbers are proved in a browser (shots under seq-wt13-shots);
 * these tests lock the structure, the contract and the sheet.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const shell = read('shell2.css');
const body = (sheet: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sheet.matchAll(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};
const freshStore = () => createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('A. the surface bar is centred with the chat', () => {
  it('its row is as tall as the chat header (56 px) plus the card border, so the two share a centre line', () => {
    expect(body(shell, '.s2-ch')).toMatch(/height:\s*56px;/);
    /* The last rule wins: the bar's row is 58 px, pulled up by the stage's 8 px gap so the cards start under it. */
    const bar = [...shell.matchAll(/(?:^|\n)\.s2-topb \{([^}]*)\}/g)].map((m) => m[1]!).pop()!;
    expect(bar).toMatch(/height:\s*58px;/);
    expect(bar).toMatch(/margin-bottom:\s*calc\(-1 \* var\(--sp-8\)\);/);
  });
  it('the pills are centred over the column, not pushed along by the crumb', () => {
    const wrap = body(shell, '.s2-topb > .s2-surfaces-wrap');
    expect(wrap).toMatch(/position:\s*absolute;/);
    expect(wrap).toMatch(/left:\s*50%;/);
    expect(wrap).toMatch(/top:\s*50%;/);
    expect(wrap).toMatch(/translate\(-50%, -50%\)/);
  });
});

describe('B. no arrow circle: the bar is dragged', () => {
  it('has no scroll buttons in the markup or the sheet, and keeps a grab cursor and a grip cue', () => {
    render(<V3App appStore={freshStore()} />);
    expect(document.querySelector('[data-testid^="s2-surfaces-more"]')).toBeNull();
    expect(shell).not.toMatch(/\.s2-surfaces-more/);
    expect(body(shell, ".s2-surfaces[data-scrollable='true']")).toMatch(/cursor:\s*grab;/);
    expect(shell).toMatch(/\.s2-surfaces-wrap:hover\[data-more='both'\]::before/);
  });
});

describe('D. the top surface names are always shown (owner 2026-10-09: "always show their names, always")', () => {
  it('there is no icon fold: no rule, no measure, no attribute', () => {
    expect(shell).not.toMatch(/data-compact/);
    expect(Object.keys(layoutPrefs)).not.toContain('surfaceBarNeedsIcons');
    /* Every rule touching a pill's name leaves it visible. */
    const css = shell.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (/\.s2-seg-l/.test(m[1]!)) expect(m[2]).not.toMatch(/display:\s*none/);
  });
  it('a bar too narrow for its names (jsdom: forced narrow) keeps every name drawn, labelled and scrollable', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('s2-topb') ? 580 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('s2-surfaces') ? 560 : 0;
    });
    render(<V3App appStore={freshStore()} />);
    const bar = screen.getByTestId('s2-surfaces');
    expect(bar.getAttribute('data-compact')).toBeNull();
    for (const id of ['architecture', 'files', 'whiteboard', 'terminal', 'agents']) {
      const b = screen.getByTestId(`s2-tab-${id}`);
      expect(b.querySelector('.s2-seg-l')?.textContent?.trim()).toBeTruthy();
      expect(b.getAttribute('title')).toBeTruthy();
    }
    expect(body(shell, '.s2-surfaces')).toMatch(/overflow-x:\s*auto;/);
  });
});

describe('C. the sidebar peeking over the boards is opaque and drag-resizable', () => {
  const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  const slot = () => document.querySelector<HTMLElement>('.s2-panel-slot')!;
  /* A pointer drag along x from the handle (jsdom has no PointerEvent; a MouseEvent of that type reads the same). */
  const dragBy = (handle: HTMLElement, dx: number) => {
    act(() => void handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300 })));
    act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 + dx })));
    act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 300 + dx })));
  };
  const peek = () => {
    setWidth(900);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-sidebar-open'));
  };

  it('has no handle while docked or closed, and one while it peeks', () => {
    setWidth(900);
    render(<V3App appStore={freshStore()} />);
    expect(screen.queryByTestId('s2-peek-sizer')).toBeNull();
    fireEvent.click(screen.getByTestId('s2-sidebar-open'));
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeTruthy();
    expect(slot().classList.contains('is-overlay')).toBe(true);
    expect(slot().style.width).toBe(`${PEEK_DEFAULT}px`);
  });
  it('drags narrower and wider between the bounds, and remembers the width', () => {
    peek();
    const sizer = screen.getByTestId('s2-peek-sizer');
    expect(sizer.getAttribute('aria-valuemin')).toBe(String(PEEK_MIN));
    expect(sizer.getAttribute('aria-valuemax')).toBe(String(PEEK_MAX));
    dragBy(sizer, -30);
    expect(slot().style.width).toBe(`${PEEK_DEFAULT - 30}px`);
    expect(readPeekWidth()).toBe(PEEK_DEFAULT - 30);
    dragBy(sizer, -500);
    expect(slot().style.width).toBe(`${PEEK_MIN}px`);
    dragBy(sizer, 900);
    expect(slot().style.width).toBe(`${PEEK_MAX}px`);
    fireEvent.keyDown(sizer, { key: 'Home' });
    expect(slot().style.width).toBe(`${PEEK_MIN}px`);
    fireEvent.keyDown(sizer, { key: 'ArrowRight' });
    expect(slot().style.width).toBe(`${PEEK_MIN + 16}px`);
    fireEvent.doubleClick(sizer);
    expect(slot().style.width).toBe(`${PEEK_DEFAULT}px`);
  });
  it('a stored width is read back; a stored width out of bounds is held to them', () => {
    localStorage.setItem('s2.peekW', '320');
    peek();
    expect(slot().style.width).toBe('320px');
  });
  it('is drawn in the card colour, not the docked glass', () => {
    /* The docked sheet is 64 percent glass over the ground; the peeking one has nothing behind it. */
    expect(body(shell, '.s2-panel')).toMatch(/background: color-mix\(in srgb, var\(--b-bg\) 64%, transparent\);/);
    expect(body(shell, '.s2-panel-slot.is-overlay .s2-panel')).toMatch(/background:\s*var\(--b-bg\);/);
    expect(body(shell, '.s2-panel-slot.is-overlay .s2-panel')).not.toMatch(/transparent|color-mix/);
  });
});

describe('D. the minimum window, the three dots, the empty context', () => {
  it('Electron will not shrink below 960 x 640, the narrowest size the shell was measured to hold at', () => {
    const main = read('../../../desktop/src/main.ts');
    expect(main).toMatch(/minWidth:\s*960,/);
    expect(main).toMatch(/minHeight:\s*640,/);
    /* Below NARROW_W (1024) the shell is the chat/workspace switch; 960 is inside it, so the minimum is a layout that exists. */
    expect(960).toBeLessThan(1024);
  });
  it('the three dots are named "More options": tooltip, accessible name and a heading over a menu of icon + words', () => {
    render(<V3App appStore={freshStore()} />);
    const more = screen.getByTestId('s2-chat-more');
    expect(more.getAttribute('title')).toBe('More options');
    expect(more.getAttribute('aria-label')).toBe('More options');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More options' });
    expect(menu.querySelector('.s2-menu-h')?.textContent).toBe('More options');
    /* Every row is an icon, a name and a line saying what it does. */
    const rows = [...menu.querySelectorAll<HTMLElement>('.s2-mi')];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row.querySelector('svg')).not.toBeNull();
      expect(row.querySelector('.s2-mi-d')?.textContent?.length ?? 0).toBeGreaterThan(8);
    }
  });
  it('an empty context says "No context" in the status bar, in ink 2 and not the faint line', () => {
    render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('s2-status-context-empty').textContent).toBe('No context');
    expect(screen.getByRole('button', { name: /Context window/ }).getAttribute('aria-label')).toMatch(/no context yet/i);
    expect(body(shell, '.s2-sb-ring-l')).toMatch(/color:\s*var\(--b-ink2\)/);
    const chat2 = read('chat2.css');
    expect(body(chat2, '.s2-ctx .ctxring-panel-empty')).toMatch(/color:\s*var\(--b-ink2\)/);
  });
});

describe('E. a divider between every pair of surfaces, sizes remembered', () => {
  it('the share maths: only the two panes beside a divider move, neither below the minimum, the sum stays 1', () => {
    const eq = equalShares(3);
    expect(eq.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const moved = resizeShares(eq, 0, 0.1, 0.1);
    expect(moved[0]).toBeCloseTo(1 / 3 + 0.1, 9);
    expect(moved[1]).toBeCloseTo(1 / 3 - 0.1, 9);
    expect(moved[2]).toBe(eq[2]);
    /* Positive and negative controls for the floor: a long drag stops at the minimum on either side. */
    expect(resizeShares(eq, 1, 5, 0.1)[2]).toBeCloseTo(0.1, 9);
    expect(resizeShares(eq, 1, -5, 0.1)[1]).toBeCloseTo(0.1, 9);
    expect(resizeShares(eq, 1, 5, 0.1)[0]).toBe(eq[0]);
    /* A pair that cannot hold two minimums is left alone; a divider that is not there is a no-op. */
    expect(resizeShares([0.9, 0.1, 0.05], 1, 0.02, 0.1)).toEqual([0.9, 0.1, 0.05]);
    expect(resizeShares(eq, 2, 0.1, 0.1)).toEqual(eq);
    expect(normalizeShares([2, 1, 1], 3)).toEqual([0.5, 0.25, 0.25]);
    expect(normalizeShares([2, 1], 3)).toEqual(equalShares(3));
    expect(normalizeShares([1, -1, 1], 3)).toEqual(equalShares(3));
    localStorage.setItem('s2.panes.3', 'not json');
    expect(readPaneShares(3)).toEqual(equalShares(3));
    writePaneShares(3, [0.5, 0.3, 0.2]);
    expect(readPaneShares(3)).toEqual([0.5, 0.3, 0.2]);
    expect(PANE_MIN_PX).toBeGreaterThanOrEqual(200);
  });

  const stageW = (w: number) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('s2-pane') ? w : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
    });
  };
  const panes = () => [...document.querySelectorAll<HTMLElement>('.s2-stage > .s2-pane[data-surface-pane]')];
  const dividers = () => screen.queryAllByRole('separator', { name: /Resize surfaces/ });

  it('N panes get N-1 dividers: none for one, the split for two, two for three', () => {
    render(<V3App appStore={freshStore()} />);
    expect(panes()).toHaveLength(1);
    expect(dividers()).toHaveLength(0);
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    expect(panes()).toHaveLength(2);
    expect(screen.getByTestId('s2-split-divider')).toBeTruthy();
    expect(dividers()).toHaveLength(0);
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    expect(panes()).toHaveLength(3);
    expect(screen.queryByTestId('s2-split-divider')).toBeNull();
    expect(dividers()).toHaveLength(panes().length - 1);
    /* Each divider sits between its two panes. */
    panes().slice(0, -1).forEach((p, i) => expect(p.nextElementSibling).toBe(screen.getByTestId(`s2-pane-divider-${i}`)));
    expect(panes().map((p) => p.style.flex)).toEqual(panes().map(() => `${1 / 3} 1 0px`));
  });

  it('a drag moves only the two panes beside it, stops at the minimum, and the shares are remembered', () => {
    stageW(400);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    const d0 = screen.getByTestId('s2-pane-divider-0');
    const drag = (el: HTMLElement, dx: number) => {
      act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500 })));
      act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 + dx })));
      act(() => void window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 + dx })));
    };
    /* 3 panes of 400 px: 1200 px to share. +120 px is +0.1 of it. */
    drag(d0, 120);
    const flex = () => panes().map((p) => Number(p.style.flex.split(' ')[0]));
    expect(flex()[0]).toBeCloseTo(1 / 3 + 0.1, 3);
    expect(flex()[1]).toBeCloseTo(1 / 3 - 0.1, 3);
    expect(flex()[2]).toBeCloseTo(1 / 3, 3);
    expect(JSON.parse(localStorage.getItem('s2.panes.3')!)).toEqual(flex().map((x) => Math.round(x * 1000) / 1000));
    /* A huge drag the other way stops with the middle pane at the minimum, the third untouched. */
    const d1 = screen.getByTestId('s2-pane-divider-1');
    drag(d1, 5000);
    expect(flex()[2]).toBeCloseTo(PANE_MIN_PX / 1200, 3);
    expect(flex()[0]).toBeCloseTo(1 / 3 + 0.1, 3);
    expect(flex().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
  });

  it('the keyboard steps a divider, Home and End bound it, a double click makes the panes equal again, and the store is read back', () => {
    stageW(400);
    const first = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    const d0 = screen.getByTestId('s2-pane-divider-0');
    fireEvent.keyDown(d0, { key: 'ArrowRight' });
    expect(Number(panes()[0]!.style.flex.split(' ')[0])).toBeCloseTo(1 / 3 + 16 / 1200, 3);
    fireEvent.keyDown(d0, { key: 'End' });
    expect(Number(panes()[1]!.style.flex.split(' ')[0])).toBeCloseTo(PANE_MIN_PX / 1200, 3);
    fireEvent.doubleClick(d0);
    expect(panes().map((p) => p.style.flex)).toEqual(panes().map(() => `${1 / 3} 1 0px`));
    writePaneShares(3, [0.5, 0.3, 0.2]);
    first.unmount();
    render(<V3App appStore={freshStore()} />);
    expect(panes().map((p) => Number(p.style.flex.split(' ')[0]))).toEqual([0.5, 0.3, 0.2]);
  });
});

describe('D. the board tags in a narrow pane fold to icons instead of cutting off', () => {
  it('under 560 px of pane the tags not on screen lose their names (titles stay), the one on screen keeps a short one', () => {
    const css = shell;
    const at = css.indexOf('@container s2pane (max-width: 559px) {');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf('\n}\n', at) + 3);
    expect(block).toMatch(/\.board-tabs \.btag\[data-on='false'\] \.btag-t \{\s*display: none;/);
    expect(block).toMatch(/\.board-tabs \.btag\[data-on='true'\] \.btag-t \{[^}]*text-overflow: ellipsis;/);
    /* The pane is the container the query measures. */
    expect(body(css, '.s2-pane')).toMatch(/container:\s*s2pane \/ inline-size;/);
  });
});

describe('fix round: the Working label lives in the chat header, never in the surface bar', () => {
  const running = () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 's-work', title: 'Session', pinned: false, updatedAt: '2026-09-20' }], activeId: 's-work' } as never);
    store.dispatch({ type: 'composer/draft', text: 'map this repository' });
    store.dispatch({ type: 'turn/send', at: 1 });
    return store;
  };
  it('while a turn runs it is in .s2-ch before the three dots, with nothing of it in the top bar', () => {
    render(<V3App appStore={running()} />);
    const label = screen.getByTestId('s2-working');
    expect(label.textContent).toMatch(/Working/);
    expect(label.closest('.s2-ch')).not.toBeNull();
    expect(label.closest('.s2-topb')).toBeNull();
    const more = screen.getByTestId('s2-chat-more');
    expect(label.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shell).not.toMatch(/\.s2-topb > \.s2-working/);
  });
  it('idle: no label (the negative control)', () => {
    render(<V3App appStore={freshStore()} />);
    expect(screen.queryByTestId('s2-working')).toBeNull();
  });
});

describe('fix round: pane shares are held to the minimum against the live width', () => {
  it('the three repros: a Home on a wide window, a narrower window, a stale store', () => {
    const min = (room: number) => PANE_MIN_PX / room;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    /* 1920: divider 0 on Home leaves [0.171, 0.496, 0.333]; at 1200 (1184 of room) the first would be 118 px. */
    const held = holdShares([0.171, 0.496, 0.333], 1184);
    expect(held[0]! * 1184).toBeGreaterThanOrEqual(PANE_MIN_PX - 0.01);
    expect(held.every((s) => s * 1184 >= PANE_MIN_PX - 0.01)).toBe(true);
    expect(sum(held)).toBeCloseTo(1, 9);
    /* A stale store [0.02, 0.02, 0.96]. */
    const stale = holdShares([0.02, 0.02, 0.96], 904);
    expect(stale.every((s) => s >= min(904) - 1e-9)).toBe(true);
    expect(sum(stale)).toBeCloseTo(1, 9);
    expect(stale[2]).toBeCloseTo(1 - 2 * min(904), 9);
    /* Controls: shares already above the minimum are untouched; an unmeasured room changes nothing; no room for N minimums gives equal shares. */
    expect(holdShares([0.5, 0.3, 0.2], 1200)).toEqual([0.5, 0.3, 0.2]);
    expect(holdShares([0.02, 0.02, 0.96], 0)).toEqual([0.02, 0.02, 0.96]);
    expect(holdShares([0.02, 0.02, 0.96], 600)).toEqual(equalShares(3));
  });
  const stageAt = (w: number) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('s2-stage') ? w : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
    });
  };
  it('a stale stored share is held at render, and the dividers stay inside their own min and max', () => {
    stageAt(920);
    localStorage.setItem('s2.panes.3', JSON.stringify([0.02, 0.02, 0.96]));
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    const flex = [...document.querySelectorAll<HTMLElement>('.s2-stage > .s2-pane[data-surface-pane]')].map((p) => Number(p.style.flex.split(' ')[0]));
    expect(flex).toHaveLength(3);
    for (const f of flex) expect(f * (920 - 16)).toBeGreaterThanOrEqual(PANE_MIN_PX - 0.5);
    for (const i of [0, 1]) {
      const d = screen.getByTestId(`s2-pane-divider-${i}`);
      const now = Number(d.getAttribute('aria-valuenow'));
      expect(now).toBeGreaterThanOrEqual(Number(d.getAttribute('aria-valuemin')));
      expect(now).toBeLessThanOrEqual(Number(d.getAttribute('aria-valuemax')));
    }
  });
});

describe('fix round: the crumb and the empty context at the default layout', () => {
  it('the crumb carries the whole location as a title, and Windows measures its half from the bar centre', () => {
    render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('s2-crumb').getAttribute('title')).toMatch(/\S/);
    expect(shell).toMatch(/\.s2\[data-platform='win'\] \.s2-topb:has\(\.shell-winctl\) > \.s2-crumb \{\s*max-width: calc\(50% \+ /);
    expect(shell).toMatch(/\.s2-crumb\[data-trim='true'\] \.s2-crumb-b \{\s*display: none;/);
  });
  it('the empty-context word shows down to a 360 px status bar, so the default 420 px chat has it', () => {
    expect(shell).toMatch(/@container s2status \(max-width: 359px\) \{\s*\.s2-sb-ring-l \{\s*display: none;/);
    expect(shell).not.toMatch(/@container s2status \(max-width: 519px\)/);
    expect(420 - 2 * 8).toBeGreaterThan(359);
  });
});

describe('the activity loader: the radar tops the chat card only; the status bar carries the rest (owner 2026-10-09)', () => {
  const session = () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 's-work', title: 'Session', pinned: false, updatedAt: '2026-09-20' }], activeId: 's-work' } as never);
    return store;
  };
  const turn = () => {
    const store = session();
    store.dispatch({ type: 'composer/draft', text: 'map this repository' });
    store.dispatch({ type: 'turn/send', at: 1 });
    return store;
  };
  const agentRun = (over: Record<string, unknown> = {}) =>
    ({ id: 'r1', sessionId: 's-work', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, ...over }) as never;
  afterEach(() => agentRuns.patch((s) => ({ ...s, runs: [] })));

  it('a running turn: a radar in the chat header and none in any pane head', () => {
    render(<V3App appStore={turn()} />);
    const head = screen.getByTestId('s2-working-radar');
    expect(head.closest('.s2-ch')).not.toBeNull();
    expect(head.getAttribute('data-variant')).toBe('radar');
    expect(document.querySelectorAll('[data-variant="radar"]')).toHaveLength(1);
    expect(document.querySelector('.s2-pane-head [data-variant="radar"]')).toBeNull();
    expect(document.querySelector('[data-testid^="s2-pane-radar"], [data-testid^="s2-pane-working"]')).toBeNull();
    expect(shell).not.toMatch(/s2-pane-working/);
  });
  it('a running AGENT run (no model turn in flight) shows the same radar: the case the old Working label missed', () => {
    agentRuns.patch((s) => ({ ...s, runs: [agentRun()] }));
    render(<V3App appStore={session()} />);
    expect(screen.getByTestId('s2-working-radar')).toBeTruthy();
    expect(screen.getByTestId('s2-working').textContent).toMatch(/Working/);
  });
  it('idle, and an agent run in ANOTHER chat: no radar anywhere (the negative controls)', () => {
    const first = render(<V3App appStore={session()} />);
    expect(screen.queryByTestId('s2-working-radar')).toBeNull();
    expect(document.querySelector('[data-variant="radar"]')).toBeNull();
    first.unmount();
    agentRuns.patch((s) => ({ ...s, runs: [agentRun({ sessionId: 'someone-else' })] }));
    render(<V3App appStore={session()} />);
    expect(screen.queryByTestId('s2-working-radar')).toBeNull();
    expect(document.querySelector('.s2-pane-head [data-variant="radar"]')).toBeNull();
  });
  it('the radar is a fixed box: integer font from the tokens, line-height from the tokens, the box exactly its text', () => {
    const b = body(shell, '.act-loader.is-radar');
    expect(b).toMatch(/font-size:\s*var\(--t-12\)/);
    expect(b).toMatch(/line-height:\s*var\(--lh-12\)/);
    expect(b).toMatch(/width:\s*29px/);
    expect(b).toMatch(/height:\s*calc\(var\(--lh-12\) \* 2\)/);
  });
});

describe('working fonts and the shimmer read clean (owner 2026-10-09: "fonts too minimalistic when they are working")', () => {
  const tokens = read('../tokens/graphite.css');
  it('the chat header Working label: UI face, 13, label weight', () => {
    const b = body(shell, '.s2-working');
    expect(b).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(b).toMatch(/font-size:\s*var\(--t-13\)/);
    expect(b).toMatch(/line-height:\s*var\(--lh-13\)/);
    expect(b).toMatch(/-weight:\s*var\(--fw-label\)/);
  });
  it('the status bar state: UI face, 12, label weight', () => {
    const b = body(shell, '.s2-sb-state');
    expect(b).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(b).toMatch(/font-size:\s*var\(--t-12\)/);
    expect(b).toMatch(/-weight:\s*var\(--fw-label\)/);
  });
  it('the shimmer: base ink-2 (never the faint ink-3), peak --shimmer-peak', () => {
    const rule = /\n\.shimmer-text \{([^}]*)\}/.exec(tokens)![1]!;
    const gradient = /linear-gradient\(([\s\S]*?)\n  \);/.exec(rule)![1]!;
    expect(rule).toMatch(/color:\s*var\(--ink-2\)/);
    expect(gradient).not.toMatch(/--ink-3/);
    expect(gradient).toMatch(/var\(--ink-2\) 0%/);
    expect(gradient).toMatch(/var\(--shimmer-peak\) 50%/);
    expect(rule).not.toMatch(/ink-3 at both ends/);
    expect(tokens).not.toMatch(/ink-3 at both ends/);
  });
  it('light theme: the sweep peak is at least 2:1 from the rest ink (reviewer: ink-1 on ink-2 is 1.5:1)', () => {
    const at = tokens.indexOf('--ink-1: #2B2A27');
    const light = tokens.slice(at, at + 4000);
    const hex = (name: string) => new RegExp('--' + name + ': (#[0-9A-Fa-f]{6})').exec(light)![1]!;
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(light).toMatch(/--shimmer-peak:\s*var\(--accent\)/);
    expect(ratio(hex('accent'), hex('ink-2'))).toBeGreaterThanOrEqual(2);
    /* The negative control: the old peak, ink-1, is under 2:1. */
    expect(ratio(hex('ink-1'), hex('ink-2'))).toBeLessThan(2);
  });
});
