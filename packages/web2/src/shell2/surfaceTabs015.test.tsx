import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { BoardTabs } from '../canvas/boards/BoardTabs';
import boardsCss from '../canvas/boards/boards.css?raw';
import { ARCH_BOARD_ID } from '../canvas/boards/boardsModel';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import cssRaw from './shell2.css?raw';
import { applyOrder, moveTo, slotAt, SURFACE_ORDER_KEY } from './surfaceOrder';

const css = cssRaw.replace(/\r\n/g, '\n');

/*
 * ROUND 0.1.5, G2 (owner, installed app): "the surfaces and the tabs you can't select, you can't drag, you literally
 * can't navigate it". And the narrow-window repro: a "Whiteboard" pill cut off at the header's right edge while the
 * panel below shows a second Whiteboard tab.
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
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const bar = () => screen.getByTestId('s2-surfaces');
/** jsdom has no PointerEvent: a MouseEvent under the pointer name carries the coordinate. */
const ptr = (el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true, button: 0 }));
  });
/* The bar writes its scroll once per frame (0.1.6): let frames run. */
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
  }
};
const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
const order = () => Array.from(bar().querySelectorAll<HTMLElement>('.s2-sp[data-pill]')).map((p) => p.dataset.pill);

/** jsdom has no layout: give every pill a 100 px slot in its current order. */
function layOut() {
  const pills = Array.from(bar().querySelectorAll<HTMLElement>('.s2-sp[data-pill]'));
  pills.forEach((p, i) => {
    p.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 40, height: 40, x: i * 100, y: 0, toJSON() {} }) as DOMRect;
  });
}

describe('the surface bar can be driven (round 0.1.5)', () => {
  it('no window-drag region sits over the pills: the spacers carry none, the pills cut their own hole', () => {
    render(<V3App appStore={freshStore()} />);
    const topb = bar().closest('.s2-topb')!;
    /* The spacers exist (they are why the later drag region used to win over the pills)... */
    expect(topb.querySelectorAll(':scope > .s2-drag').length).toBeGreaterThan(0);
    /* ...and the stylesheet's last word on them is drag (0.1.6: never \`none\`, which Chromium computes as no-drag and
       so cut holes), they sit BEFORE the pills' wrap in tree order so the wrap's no-drag is the later region, and the
       wrap and all inside say no-drag. */
    const rules = [...css.matchAll(/\.s2-topb > \.s2-drag \{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.at(-1)).toMatch(/app-region: drag/);
    expect(css).not.toMatch(/app-region: none/);
    const kids = [...topb.children];
    const wrapAt = kids.findIndex((k) => k.classList.contains('s2-surfaces-wrap'));
    for (const [i, k] of kids.entries()) if (k.classList.contains('s2-drag')) expect(i).toBeLessThan(wrapAt);
    /* The bar is ONE no-drag box: a hit-box after the names, the visible bar's size (0.1.6), not a hole per name. */
    expect(css).toMatch(/\.s2-surfaces-wrap > \.s2-bar-hit \{[^}]*app-region: no-drag/);
    expect(topb.querySelector('.s2-surfaces-wrap > nav + .s2-bar-hit')).not.toBeNull();
    expect(css).not.toMatch(/\.s2-surfaces-wrap \*,/);
  });

  it('a click selects a surface and brings it forward', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'));
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    expect(screen.getByTestId('s2-tab-whiteboard').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('s2-tab-files').getAttribute('aria-current')).toBeNull();
  });

  it('a pointer press-and-release on a pill still clicks it (a drag under 4 px is a click)', () => {
    render(<V3App appStore={freshStore()} />);
    const pill = screen.getByTestId('s2-tab-terminal');
    ptr(pill, 'pointerdown', 10);
    ptr(pill, 'pointermove', 12);
    ptr(pill, 'pointerup', 12);
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-current')).toBe('true');
  });

  it('dragging a name across its neighbours reorders it, remembers the order, and does not click it', () => {
    render(<V3App appStore={freshStore()} />);
    const before = order();
    /* 0.1.8 C3: the bar starts in title order, so where Files sits is read, not assumed. */
    const at = before.indexOf('files');
    expect(at).toBeGreaterThanOrEqual(0);
    layOut();
    const pill = screen.getByTestId('s2-tab-files');
    const x = at * 100 + 50;
    ptr(pill, 'pointerdown', x);
    ptr(bar(), 'pointermove', x + 40);
    ptr(bar(), 'pointermove', x + 110);
    const after = order();
    expect(after[at + 1]).toBe('files');
    expect(after[at]).toBe(before[at + 1]);
    ptr(bar(), 'pointerup', x + 110);
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-current')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SURFACE_ORDER_KEY)!)).toEqual(after);
  });

  it('a saved order is honoured on the next mount', () => {
    localStorage.setItem(SURFACE_ORDER_KEY, JSON.stringify(['agents', 'terminal']));
    render(<V3App appStore={freshStore()} />);
    expect(order().slice(0, 2)).toEqual(['agents', 'terminal']);
    expect(new Set(order()).size).toBe(order().length);
  });

  it('Alt+Arrow moves the focused name and keeps focus on it', () => {
    render(<V3App appStore={freshStore()} />);
    const pill = screen.getByTestId('s2-tab-files');
    pill.focus();
    const at = order().indexOf('files');
    fireEvent.keyDown(pill, { key: 'ArrowRight', altKey: true });
    expect(order().indexOf('files')).toBe(at + 1);
    expect(document.activeElement).toBe(screen.getByTestId('s2-tab-files'));
  });

  it('plain arrows still walk the names', () => {
    render(<V3App appStore={freshStore()} />);
    const names = Array.from(bar().querySelectorAll<HTMLButtonElement>('.s2-sp-main'));
    names[0]!.focus();
    fireEvent.keyDown(names[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(names[1]);
  });

  it('a mouse wheel scrolls an overflowing bar sideways, easing there; a bar that fits is left alone', async () => {
    motion(false);
    render(<V3App appStore={freshStore()} />);
    const b = bar();
    Object.defineProperty(b, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(b, 'clientWidth', { configurable: true, value: 400 });
    b.scrollLeft = 0;
    const ev = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    act(() => {
      b.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    /* Eased (0.1.6): the first frame is part of the way, not all of it, and it arrives. */
    await frames(1);
    expect(b.scrollLeft).toBeGreaterThan(0);
    expect(b.scrollLeft).toBeLessThan(120);
    await frames(45);
    expect(b.scrollLeft).toBe(120);
    Object.defineProperty(b, 'scrollWidth', { configurable: true, value: 300 });
    const calm = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    act(() => {
      b.dispatchEvent(calm);
    });
    expect(calm.defaultPrevented).toBe(false);
  });

  it('under reduced motion a wheel notch lands at once', () => {
    motion(true);
    render(<V3App appStore={freshStore()} />);
    const b = bar();
    Object.defineProperty(b, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(b, 'clientWidth', { configurable: true, value: 400 });
    b.scrollLeft = 0;
    act(() => {
      b.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true }));
    });
    expect(b.scrollLeft).toBe(120);
  });

  it('an overflowing bar drag-scrolls instead of reordering', async () => {
    motion(true);
    render(<V3App appStore={freshStore()} />);
    const b = bar();
    Object.defineProperty(b, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(b, 'clientWidth', { configurable: true, value: 400 });
    const was = order();
    const pill = screen.getByTestId('s2-tab-files');
    ptr(pill, 'pointerdown', 300);
    ptr(b, 'pointermove', 200);
    /* One write per frame, not one per pointer event (0.1.6). */
    expect(b.scrollLeft).toBe(0);
    await frames(2);
    expect(b.scrollLeft).toBe(100);
    ptr(b, 'pointerup', 200);
    expect(order()).toEqual(was);
  });

  it('each name says what it opens, and the bar says what surfaces are', () => {
    render(<V3App appStore={freshStore()} />);
    expect(bar().getAttribute('title')).toMatch(/Surfaces/);
    expect(screen.getByTestId('s2-tab-whiteboard').getAttribute('title')).toMatch(/sketch/);
    expect(screen.getByTestId('s2-tab-architecture').getAttribute('title')).toMatch(/map of your code/);
  });
});

describe('the order helpers', () => {
  it('apply a save over the base without losing or doubling a surface', () => {
    expect(applyOrder(['a', 'b', 'c'], ['c', 'x', 'c', 'a'])).toEqual(['c', 'a', 'b']);
    expect(applyOrder(['a', 'b'], null)).toEqual(['a', 'b']);
  });
  it('move one place and clamp', () => {
    expect(moveTo(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
    expect(moveTo(['a', 'b', 'c'], 'c', -3)).toEqual(['c', 'a', 'b']);
  });
  it('slotAt counts the other centres left of the pointer', () => {
    expect(slotAt([50, 150, 250], 0, 200)).toBe(1);
    expect(slotAt([50, 150, 250], 2, 10)).toBe(0);
  });
});

/* The owner's narrow-window repro: a "Whiteboard" pill cut off at the header's right edge. */
describe('the header pills are never left half-cut when there is room (round 0.1.5)', () => {
  const sizes = (topb: number, bar: number) => {
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('s2-topb') ? topb : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('s2-surfaces') ? bar : 0;
      },
    });
    return () => {
      if (w) Object.defineProperty(HTMLElement.prototype, 'clientWidth', w);
      if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
    };
  };

  it('too wide for the centre, short of the free room: the pills slide off the crumb instead of scrolling', () => {
    const undo = sizes(750, 558);
    try {
      render(<V3App appStore={freshStore()} />);
      const wrap = bar().parentElement!;
      /* 750 wide: the crumb keeps 136 on the left, 4 on the right; the 558 px of names fit in the 610 between. */
      expect(wrap.style.left).toBe('136px');
      expect(wrap.style.maxWidth).toBe('610px');
      cleanup();
    } finally {
      undo();
    }
  });

  it("with room to spare they stay on the bar's centre", () => {
    const undo = sizes(1000, 558);
    try {
      render(<V3App appStore={freshStore()} />);
      expect(bar().parentElement!.style.left).toBe('221px');
      cleanup();
    } finally {
      undo();
    }
  });

  it('the names take less padding in a tight column, and the bar does not snap (0.1.6: snap points turned a 42 px scroll into two stops)', () => {
    expect(css).toMatch(/@container s2main \(max-width: 760px\) \{\s*\.s2-sp-main \{\s*padding: 0 var\(--sp-10\)/);
    expect(css).not.toMatch(/scroll-snap-type/);
    expect(css).not.toMatch(/scroll-snap-align/);
  });
});

describe('the strip below the bar says it lists boards, so the same word is not two copies of one tab (round 0.1.5)', () => {
  it('the board strip carries a "Boards" caption, hidden from the accessibility tree and folded away in a narrow pane', () => {
    const noop = () => undefined;
    render(<BoardTabs index={null} current={ARCH_BOARD_ID} onOpen={noop} onCreate={noop} onRename={noop} onDelete={noop} />);
    const cap = document.querySelector('.btag-cap')!;
    expect(cap.textContent).toBe('Boards');
    expect(cap.getAttribute('aria-hidden')).toBe('true');
    expect(boardsCss.replace(/\r\n/g, '\n')).toMatch(/@container s2pane \(max-width: 559px\) \{\s*\.board-tabs \.btag-cap \{ display: none; \}/);
    cleanup();
  });
});

describe('the bar glide stops (0.1.6)', () => {
  it('a scrollLeft that rounds to whole pixels cannot keep the frame loop running', async () => {
    motion(false);
    render(<V3App appStore={freshStore()} />);
    const b = bar();
    Object.defineProperty(b, 'scrollWidth', { configurable: true, value: 492 });
    Object.defineProperty(b, 'clientWidth', { configurable: true, value: 450 });
    let pos = 0;
    Object.defineProperty(b, 'scrollLeft', { configurable: true, get: () => pos, set: (v: number) => { pos = Math.round(v); } });
    let frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames++; return raf(cb); });
    act(() => {
      b.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, cancelable: true, bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 900));
    const settled = frames;
    await new Promise((r) => setTimeout(r, 400));
    expect(frames).toBe(settled);
    expect(pos).toBe(30);
  });
});
