import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { LIVE_PILLS, CHROME_TAB_DEFS } from '../app/chromeTabModel';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { CARD_GAP } from './layoutPrefs';
import cssRaw from './shell2.css?raw';
import { seedOpenArchitecture } from './legacyDefaultTabs.testSupport';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

const css = cssRaw.replace(/\r\n/g, '\n');

/*
 * ROUND 7, SECTION B (Jaden's walkthrough of the installed app, 2026-10-06):
 *   B1 "When you're on architecture, it doesn't show the other ones... I
 *      should always just show their surface names." "Closing is a little
 *      difficult and unclear. Terminal has no X." "The X's... don't fit."
 *   B3 "The surfaces don't need to be always open. They can condense into
 *      their little icons when no surface is open, and it can just center
 *      the actual chat box."
 *   B4 Each area a floating rounded card, as in Mix.dc.html.
 * The subject set is LIVE_PILLS (derived, not hand-listed): a surface added
 * to the bar is held to the same rules without editing this file.
 */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  localStorage.clear();
  seedOpenArchitecture();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const bar = () => screen.getByRole('navigation', { name: 'Workspace' });
const nameOf = (id: (typeof LIVE_PILLS)[number]) => CHROME_TAB_DEFS[id].label;
const row = () => document.querySelector<HTMLElement>('.s2-row')!;

/** Close whatever is open (the stage holds three at most; a fourth retires the oldest). */
function closeAll() {
  for (const id of LIVE_PILLS) {
    const x = screen.queryByTestId(`v3-tab-close-${id}`);
    if (x) fireEvent.click(x);
  }
}

describe('the surface bar names every surface, always (B1)', () => {
  it('shows each surface by name and icon, whichever one is open', () => {
    expect(LIVE_PILLS.length).toBeGreaterThanOrEqual(4);
    render(<V3App appStore={freshStore()} />);
    for (const focus of LIVE_PILLS) {
      fireEvent.click(screen.getByTestId(`s2-tab-${focus}`), BESIDE);
      for (const id of LIVE_PILLS) {
        const pill = within(bar()).getByRole('button', { name: nameOf(id) });
        expect(pill.querySelector('.s2-seg-l')?.textContent).toBe(nameOf(id));
        expect(pill.querySelector('svg, .s2-tabst')).not.toBeNull();
      }
    }
  });

  it('every open surface has its own ×, Terminal included; a closed one has none', () => {
    render(<V3App appStore={freshStore()} />);
    for (const id of LIVE_PILLS) {
      fireEvent.click(screen.getByTestId(`s2-tab-${id}`), BESIDE);
      const x = screen.getByTestId(`v3-tab-close-${id}`);
      expect(x.getAttribute('aria-label')).toBe(`Close ${nameOf(id)}`);
      /* The × belongs to its own pill. */
      expect(x.closest(`[data-pill="${id}"]`)).not.toBeNull();
    }
    /* Every × in the bar belongs to an open surface. */
    for (const x of bar().querySelectorAll('.s2-sp-x')) {
      expect(x.closest('.s2-sp')?.classList.contains('is-on')).toBe(true);
    }
    fireEvent.click(screen.getByTestId('v3-tab-close-terminal'));
    expect(screen.getByTestId('s2-tab-terminal').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('v3-tab-close-terminal')).toBeNull();
  });

  it('the name opens and brings forward; it never closes. Only the × closes', () => {
    render(<V3App appStore={freshStore()} />);
    const files = () => screen.getByTestId('s2-tab-files');
    expect(files().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(files());
    expect(files().getAttribute('aria-pressed')).toBe('true');
    expect(files().classList.contains('is-focused')).toBe(true);
    /* The negative control: the old pill closed the surface on a second press. */
    fireEvent.click(files());
    expect(files().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('v3-tab-close-files'));
    expect(files().getAttribute('aria-pressed')).toBe('false');
  });

  it('the × is a 24 px target centred in its pill', () => {
    const x = css.slice(css.indexOf('.s2-sp-x {'));
    const rule = x.slice(0, x.indexOf('}'));
    /* --target-min is the 24 px hit-target floor (tokens/graphite.css). */
    for (const decl of [/width: var\(--target-min\);/, /height: var\(--target-min\);/, /align-items: center;/, /justify-content: center;/]) expect(rule).toMatch(decl);
    const pill = css.slice(css.indexOf('.s2-sp {'));
    expect(pill.slice(0, pill.indexOf('}'))).toMatch(/align-items: center;/);
  });
});

describe('with no surface open the stage folds and the chat is centred (B3)', () => {
  it('the bar keeps every surface by name (round 13); the chat drops its docked width; no resize handle', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    expect(row().getAttribute('data-stage')).toBe('none');
    expect(document.querySelector('.s2-stage')).toBeNull();
    expect(bar().classList.contains('is-compact')).toBe(false);
    for (const id of LIVE_PILLS) {
      expect(within(bar()).getByRole('button', { name: nameOf(id) })).toBeTruthy();
      expect(screen.getByTestId(`s2-tab-${id}`).querySelector('.s2-seg-l')?.textContent).toBe(nameOf(id));
    }
    const chat = document.querySelector<HTMLElement>('.v3-chat-col')!;
    expect(chat.style.width).toBe('');
    expect(screen.queryByTestId('s2-chat-sizer')).toBeNull();
    /* The composer stays the same one. */
    expect(screen.getByTestId('composer-field')).toBeTruthy();
    fireEvent.click(screen.getByTestId('s2-tab-architecture'), BESIDE);
    expect(row().getAttribute('data-stage')).toBeNull();
    expect(chat.style.width).toBe('420px');
    expect(screen.getByTestId('s2-chat-sizer')).toBeTruthy();
  });

  it('centres the chat card with a max width; the pills keep their names (round 13)', () => {
    const chat = css.slice(css.indexOf(".s2-row[data-stage='none'] > .s2-chat {"));
    expect(chat.slice(0, chat.indexOf('}'))).toMatch(/justify-self: center;[\s\S]*width: min\(960px, 100%\);/);
    expect(css).not.toMatch(/\.s2-surfaces\.is-compact \.s2-seg-l \{[^}]*display: none/);
  });
});

describe('the cards (B4, Mix.dc.html)', () => {
  it('the sidebar, the chat and every pane are rounded cards on a darker ground, CARD_GAP apart', () => {
    expect(CARD_GAP).toBe(8);
    const card = css.slice(css.indexOf('.s2-panel,\n.s2-iconrail,\n.s2-chat,\n.s2-pane,\n.s2-agents {'));
    expect(card.length).toBeGreaterThan(0);
    expect(card.slice(0, card.indexOf('}'))).toMatch(/border-radius: var\(--r-18\);[\s\S]*box-shadow: var\(--b-card\);/);
    expect(css).toMatch(/\.s2\.s2-app \{\s*background: var\(--bg-ground\);/);
    expect(css).toMatch(/\.s2-row \{\s*padding: var\(--sp-8\);/);
  });

  it('R11: a card shadow never reaches its neighbour, and two cards with no sizer are 8 px apart', () => {
    const decl = /--b-card:\s*0\s+(-?\d+)px\s+(\d+)px\s+(?:(-?\d+)px\s+)?rgba/.exec(css);
    expect(decl).not.toBeNull();
    const [, dy, blur, spread] = decl!;
    /* offset + blur + spread must stay inside the 8 px of ground between two cards. */
    expect(Math.abs(Number(dy)) + Number(blur) + Number(spread ?? 0)).toBeLessThan(CARD_GAP);
    expect(css).toMatch(/\.s2-pane \+ \.s2-pane \{[^}]*margin-left: var\(--sp-8\);/);
    /* the border between two cards is fainter than the hairline */
    expect(css).toMatch(/--b-card-edge: color-mix\(in srgb, var\(--b-edge\) \d+%, transparent\)/);
    /* round 13 (S2): the bar is a quiet wash, no casting shadow */
    const bar = css.slice(css.indexOf('.s2-surfaces {'));
    expect(bar.slice(0, bar.indexOf('}'))).toMatch(/box-shadow: none;/);
  });

  it('the handles are the 8 px gaps, with a 24 px hit area', () => {
    const sizer = css.slice(css.lastIndexOf('.s2-sizer,\n.s2-divider {'));
    expect(sizer.slice(0, sizer.indexOf('}'))).toMatch(/width: var\(--sp-8\);/);
    const hit = css.slice(css.lastIndexOf('.s2-sizer::before,\n.s2-divider::before {'));
    /* 8 px of gap plus 8 px either side. */
    expect(hit.slice(0, hit.indexOf('}'))).toMatch(/left: calc\(-1 \* var\(--sp-8\)\);[\s\S]*right: calc\(-1 \* var\(--sp-8\)\);/);
  });
});

describe('the window buttons sit in the title row, sized like B icon buttons (B2)', () => {
  const host = () => {
    (window as unknown as { sequence?: unknown }).sequence = {
      openRepo: async () => null,
      shell: async () => ({ maximized: false }),
    };
  };
  afterEach(() => {
    delete (window as unknown as { sequence?: unknown }).sequence;
  });

  it('draws them in the surface bar row, after the surfaces, never over the stage', async () => {
    host();
    render(<V3App appStore={freshStore()} />);
    const ctl = await screen.findByTestId('shell-window-controls');
    const topb = ctl.closest('.s2-topb');
    expect(topb).not.toBeNull();
    expect(document.querySelector('.s2-stage')?.contains(ctl)).toBe(false);
    /* Last in the row: minimise, maximise, close. */
    expect(topb!.lastElementChild).toBe(ctl);
    expect([...ctl.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Minimise', 'Maximise', 'Close']);
  });

  it('a narrow window keeps them, in its own bar', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    host();
    render(<V3App appStore={freshStore()} />);
    const ctl = await screen.findByTestId('shell-window-controls');
    expect(ctl.closest('.s2-narrowbar')).not.toBeNull();
    expect(screen.getAllByTestId('shell-window-controls')).toHaveLength(1);
  });

  it('each is a 30 px icon button centred on the row, not a full-height strip bleeding past the edge', () => {
    const btn = css.slice(css.indexOf('.s2-topb .shell-winbtn,\n.s2-narrowbar .shell-winbtn {'));
    const rule = btn.slice(0, btn.indexOf('}'));
    expect(rule).toMatch(/width: var\(--icon-btn-lg\);/);
    expect(rule).toMatch(/height: var\(--icon-btn-lg\);/);
    expect(rule).toMatch(/border-radius: var\(--r-10\);/);
    const wrap = css.slice(css.indexOf('.s2-topb .shell-winctl,\n.s2-narrowbar .shell-winctl {'));
    const w = wrap.slice(0, wrap.indexOf('}'));
    expect(w).toMatch(/align-self: center;/);
    expect(w).toMatch(/margin-right: 0;/);
  });
});

describe('the bar scrolls when the names do not fit, fading only the side with more (round 8)', () => {
  it('names the edge with more to scroll to', async () => {
    const { scrollFade } = await import('./Shell2');
    expect(scrollFade({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toBeNull();
    expect(scrollFade({ scrollLeft: 0, scrollWidth: 600, clientWidth: 400 })).toBe('end');
    expect(scrollFade({ scrollLeft: 100, scrollWidth: 600, clientWidth: 400 })).toBe('both');
    expect(scrollFade({ scrollLeft: 200, scrollWidth: 600, clientWidth: 400 })).toBe('start');
  });

  it('with a surface open, every pill keeps its name whatever the window width', () => {
    for (const width of [1440, 1024, 900]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      const { unmount } = render(<V3App appStore={freshStore()} />);
      fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
      expect(document.querySelector("nav[aria-label=Workspace]")!.classList.contains("is-compact")).toBe(false);
      for (const id of LIVE_PILLS) expect(screen.getByTestId(`s2-tab-${id}`).querySelector('.s2-seg-l')?.textContent).toBe(nameOf(id));
      unmount();
      localStorage.clear();
      seedOpenArchitecture();
    }
  });
});

describe('round 9, asks 35 and 36: the selected surface and the top-left of the bar', () => {
  it('a closed, an open-behind and a focused name each read differently', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    const [a, b, c] = LIVE_PILLS;
    fireEvent.click(screen.getByTestId(`s2-tab-${a}`), BESIDE);
    fireEvent.click(screen.getByTestId(`s2-tab-${b}`), BESIDE);
    const state = (id: string) => bar().querySelector(`[data-pill="${id}"]`)?.getAttribute('data-state');
    expect(state(b)).toBe('focused');
    expect(state(a)).toBe('open');
    expect(state(c)).toBe('closed');
    expect(screen.getByTestId(`s2-tab-${b}`).getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId(`s2-tab-${a}`).getAttribute('aria-current')).toBeNull();
    /* The fill is one sliding indicator, not a lift of the pill. */
    expect(bar().querySelector('.s2-sp-ind')).not.toBeNull();
    const focused = css.slice(css.indexOf('.s2-sp.is-focused {'));
    expect(focused.slice(0, focused.indexOf('}'))).not.toMatch(/translateY/);
    expect(css).toMatch(/\.s2-sp-ind \{[^}]*transform: translateX\(var\(--ind-x/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.s2-surfaces\[data-ind='on'\] \.s2-sp-ind \{\s*transition: none;/);
  });

  it('the indicator follows the focused name and is gone on the home screen', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    expect(bar().hasAttribute('data-ind')).toBe(false);
    fireEvent.click(screen.getByTestId(`s2-tab-${LIVE_PILLS[1]}`));
    expect(bar().hasAttribute('data-ind')).toBe(true);
    expect(bar().style.getPropertyValue('--ind-w')).not.toBe('');
    closeAll();
    expect(bar().hasAttribute('data-ind')).toBe(false);
  });

  it('the top-left names the workspace, only while a surface is open', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    expect(screen.queryByTestId('s2-crumb')).toBeNull();
    fireEvent.click(screen.getByTestId(`s2-tab-${LIVE_PILLS[0]}`));
    const crumb = screen.getByTestId('s2-crumb');
    expect(crumb.querySelector('.s2-crumb-p')?.textContent).toBeTruthy();
    /* The drag spacer sits between them in tree order (0.1.6), so the pills' no-drag is the later window region. */
    expect(crumb.nextElementSibling?.classList.contains('s2-drag')).toBe(true);
    expect(crumb.nextElementSibling?.nextElementSibling).toBe(bar().parentElement);
  });

  it('arrow keys, Home and End walk the names', () => {
    render(<V3App appStore={freshStore()} />);
    const names = Array.from(bar().querySelectorAll<HTMLButtonElement>('.s2-sp-main'));
    names[0].focus();
    fireEvent.keyDown(names[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(names[1]);
    fireEvent.keyDown(names[1], { key: 'End' });
    expect(document.activeElement).toBe(names[names.length - 1]);
    fireEvent.keyDown(names[names.length - 1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(names[0]);
    fireEvent.keyDown(names[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(names[names.length - 1]);
    fireEvent.keyDown(names[names.length - 1], { key: 'Home' });
    expect(document.activeElement).toBe(names[0]);
  });
});

describe('the bar is a drag strip whose controls are not, and the cards stop above the status bar', () => {
  it('has explicit no-drag native controls and a gap above status', () => {
    expect(css.match(/\n\.s2-topb \{([^}]+)\}/)?.[1]).toContain('-webkit-app-region: drag;');
    expect(css.match(/\n\.s2-topb > :not\(\.s2-drag\) \{([^}]+)\}/)?.[1]).toContain('-webkit-app-region: no-drag;');
    const gaps = [...css.matchAll(/\n\.s2-row:has\(\+ \.s2-status\) \{([^}]+)\}/g)].map((m) => m[1]);
    expect(gaps.at(-1)).toMatch(/padding-bottom: var\(--sp-\d+\);/);
  });
});
