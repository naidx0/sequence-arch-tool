import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { FOCUS_LARGE_KEY, FOCUS_SHARE, PANE_MIN_PX, focusShares, setFocusLarge } from './layoutPrefs';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

/* 0.1.6 B4 item 2: "Open new surfaces large". Off (default) the surfaces share the stage evenly as they are added;
   on, the one opened last takes FOCUS_SHARE and the others share the rest. */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}
const panes = () => [...document.querySelectorAll<HTMLElement>('.s2-pane[data-surface-pane]')];
const flex = () => panes().map((p) => Number(p.style.flex.split(' ')[0]));
const ids = () => panes().map((p) => p.getAttribute('data-surface-pane'));
const big = () => ids()[flex().indexOf(Math.max(...flex()))];
const filesShare = () => flex()[ids().indexOf('files')]!;
const boardShare = () => flex()[ids().indexOf('architecture')]!;

beforeEach(() => {
  localStorage.clear();
  setFocusLarge(false);
  document.documentElement.setAttribute('data-platform', 'win');
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setFocusLarge(false);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('focusShares', () => {
  it('gives the large pane its share and splits the rest evenly, summing to 1', () => {
    const two = focusShares(2, 1, 0);
    expect(two[1]).toBeCloseTo(FOCUS_SHARE, 6);
    expect(two[0]).toBeCloseTo(1 - FOCUS_SHARE, 6);
    const three = focusShares(3, 0, 0);
    expect(three[0]).toBeCloseTo(FOCUS_SHARE, 6);
    expect(three[1]).toBeCloseTo((1 - FOCUS_SHARE) / 2, 6);
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it('never leaves a pane under its minimum on a room too small for 75%', () => {
    const room = 900;
    const s = focusShares(3, 2, room);
    for (const x of s) expect(x * room).toBeGreaterThanOrEqual(PANE_MIN_PX - 0.01);
    expect(s[2]).toBeGreaterThan(s[0]!);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it('one pane or a bad index is the even split', () => {
    expect(focusShares(1, 0, 0)).toEqual([1]);
    expect(focusShares(2, 5, 0)).toEqual([0.5, 0.5]);
  });
});

describe('the stage with "Open new surfaces large"', () => {
  it('off: Files opens beside the board half and half (the existing behaviour, the negative control)', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(ids()).toEqual(['architecture', 'files']); // 0.1.8 C3: title order
    expect(flex()).toEqual([0.5, 0.5]);
  });

  it('on: Files, opened last, takes 75% and the board keeps the rest (Files draws first)', () => {
    setFocusLarge(true);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(ids()).toEqual(['architecture', 'files']); // 0.1.8 C3: title order
    expect(filesShare()).toBeCloseTo(0.75, 6);
    expect(boardShare()).toBeCloseTo(0.25, 6);
    expect(screen.getByRole('separator', { name: 'Resize split' }).getAttribute('aria-valuenow')).toBe('25') /* the left pane is now the board */;
  });

  it('on: opening another makes it the large one, and clicking back to an open name does too', () => {
    setFocusLarge(true);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'), BESIDE);
    expect(panes()).toHaveLength(3);
    expect(big()).toBe('whiteboard');
    expect(flex().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(big()).toBe('files');
  });

  it('on: a divider moved by hand is kept until the next surface opens', () => {
    setFocusLarge(true);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(filesShare()).toBeCloseTo(0.75, 6);
    act(() => {
      fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize split' }), { key: 'ArrowRight' });
    });
    /* The next lock frame right of 25 (the board is the left pane, so Files shrinks): two thirds. The reader's size, not the 75% rule's. */
    expect(filesShare()).toBeCloseTo(2 / 3, 3);
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'), BESIDE);
    expect(big()).toBe('whiteboard');
  });

  it('turning the setting off puts the even split back, and the choice is stored under the layout key', () => {
    setFocusLarge(true);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(filesShare()).toBeCloseTo(0.75, 6);
    expect(localStorage.getItem(FOCUS_LARGE_KEY)).toBe('1');
    act(() => setFocusLarge(false));
    expect(flex()).toEqual([0.5, 0.5]);
  });
});

describe('a divider is only a divider once it moves (review B4 1 and 2)', () => {
  const press = (el: Element, button: number, moveTo?: number) => {
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button, clientX: 500 }));
    });
    if (moveTo !== undefined) {
      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: moveTo }));
      });
    }
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: moveTo ?? 500 }));
    });
  };
  const stageWide = () =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.classList.contains('s2-stage') ? 1000 : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: w, bottom: 0, width: w, height: 0, toJSON: () => ({}) };
    });

  it('a plain click or a right-click on the divider keeps the 75% layout', () => {
    setFocusLarge(true);
    stageWide();
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    const divider = screen.getByRole('separator', { name: 'Resize split' });
    press(divider, 0);
    expect(filesShare()).toBeCloseTo(0.75, 6);
    press(divider, 2);
    expect(filesShare()).toBeCloseTo(0.75, 6);
  });

  it('a real drag keeps the sized layout, and a reload shows it (and the large surface) again', () => {
    setFocusLarge(true);
    stageWide();
    const first = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    press(screen.getByRole('separator', { name: 'Resize split' }), 0, 700);
    const dragged = filesShare()!;
    expect(dragged).toBeLessThan(0.7);
    first.unmount();
    render(<V3App appStore={freshStore()} />);
    expect(filesShare()).toBeCloseTo(dragged, 3);
    expect(JSON.parse(localStorage.getItem('s2.openLarge.state') ?? '{}').manual).toBe(true);
  });

  it('three panes: a hand-sized layout survives a reload; an unsized one comes back 75%', () => {
    setFocusLarge(true);
    const first = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'), BESIDE);
    const before = flex();
    first.unmount();
    render(<V3App appStore={freshStore()} />);
    expect(flex()).toEqual(before);
    expect(big()).toBe('whiteboard');
    act(() => {
      fireEvent.keyDown(screen.getByTestId('s2-pane-divider-0'), { key: 'ArrowRight' });
    });
    const sized = flex();
    cleanup();
    render(<V3App appStore={freshStore()} />);
    expect(flex()).toEqual(sized);
  });
});
