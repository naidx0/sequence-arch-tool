import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshWorkflowBlocks } from '@sequence/schema';

import { PREVIEW_OPEN_MS, WorkflowPreviewHover } from './WorkflowPreview';

/*
 * contract change (0.1.8.4 UX2): the hover card used to be clamped inside the pane that clipped it (popLeftWithin, popTopBelow).
 * It is now drawn in the top-layer popover root on document.body and placed against the WINDOW (rail/railPopover placePopover,
 * tested on its own in rail/railPopover.test.ts): it may spill over the chat or the canvas and never leaves the window.
 */
const rect = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t, toJSON: () => ({}) }) as DOMRect;
const CARD = { w: 320, h: 150 };
const realW = window.innerWidth;
const realH = window.innerHeight;

function mockLayout(o: { host: [number, number, number, number]; group?: [number, number, number, number]; win?: [number, number] }) {
  Object.defineProperty(window, 'innerWidth', { value: o.win?.[0] ?? 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: o.win?.[1] ?? 900, configurable: true });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('rail-pop')) return rect(0, 0, CARD.w, CARD.h);
    if (this.classList.contains('wfp-host')) return rect(...o.host);
    if (this.hasAttribute('data-wfp-anchor') && o.group) return rect(...o.group);
    return rect(0, 0, 0, 0);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: realW, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: realH, configurable: true });
});

const hover = (el: HTMLElement) => {
  fireEvent.pointerEnter(el);
  act(() => void vi.advanceTimersByTime(PREVIEW_OPEN_MS + 10));
};
const row = (onOpen = true) => (
  <WorkflowPreviewHover name="Review loop" blocks={freshWorkflowBlocks()} onLaunch={() => undefined} {...(onOpen ? { onOpen: () => undefined } : {})}>
    <button type="button">Review loop</button>
  </WorkflowPreviewHover>
);
const pop = () => document.querySelector<HTMLElement>('.rail-pop[data-kind="card"]')!;

describe('the hover card is a top-layer popover, placed against the window', () => {
  it('renders in the portal root on the body, not inside the row or the pane that holds it', () => {
    mockLayout({ host: [0, 100, 232, 130] });
    render(<section data-testid="pane" style={{ overflow: 'hidden' }}>{row()}</section>);
    hover(screen.getByTestId('wfp-host'));
    const card = screen.getByTestId('wfp-card');
    const root = card.closest('[data-testid="rail-pop-root"]');
    expect(root).toBeTruthy();
    expect(root!.parentElement).toBe(document.body);
    expect(screen.getByTestId('pane').contains(card)).toBe(false);
    expect(screen.getByTestId('wfp-host').contains(card)).toBe(false);
  });

  it('in a list it opens to the right of the row, top aligned, and flips to the left at the window edge', () => {
    mockLayout({ host: [0, 100, 232, 130] });
    render(row());
    hover(screen.getByTestId('wfp-host'));
    expect(pop().style.left).toBe('238px');
    expect(pop().style.top).toBe('100px');
    expect(pop().getAttribute('data-side')).toBe('right');
    cleanup();
    mockLayout({ host: [1200, 100, 1432, 130] });
    render(row());
    hover(screen.getByTestId('wfp-host'));
    expect(pop().getAttribute('data-side')).toBe('left');
    expect(pop().style.left).toBe(`${1200 - 6 - CARD.w}px`);
  });

  it('a shelf chip opens its card under the whole shelf, and the card is not clamped inside its narrow pane', () => {
    /* the pane is 1014 to 1200 wide; the chip is at 1100; the card is 320 wide, so it spills past the pane's edge, inside the window. */
    mockLayout({ host: [1100, 30, 1190, 60], group: [1014, 20, 1200, 120] });
    render(
      <div style={{ overflowX: 'hidden' }}>
        <section data-wfp-anchor="">{row()}</section>
      </div>,
    );
    hover(screen.getByTestId('wfp-host'));
    expect(pop().getAttribute('data-side')).toBe('below');
    expect(pop().style.left).toBe('1100px');
    expect(1100 + CARD.w).toBeGreaterThan(1200);
    expect(pop().style.top).toBe('126px');
  });

  it('never leaves the window: a chip at the far right is pulled in by the inset', () => {
    mockLayout({ host: [1400, 30, 1430, 60], group: [1014, 20, 1432, 120] });
    render(<section data-wfp-anchor="">{row()}</section>);
    hover(screen.getByTestId('wfp-host'));
    expect(pop().style.left).toBe(`${1440 - 8 - CARD.w}px`);
  });
});

describe('closing the hover card, and the keyboard path through it', () => {
  it('Escape closes it and focus returns to the row it came from', () => {
    render(row());
    const r = screen.getByText('Review loop');
    act(() => r.focus());
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
    act(() => screen.getByTestId('wfp-launch').focus());
    fireEvent.keyDown(screen.getByTestId('wfp-launch'), { key: 'Escape' });
    expect(screen.queryByTestId('wfp-card')).toBeNull();
    expect(document.activeElement).toBe(r);
    /* putting focus back is not the focus that opens the card again */
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('wfp-card')).toBeNull();
  });

  it('a press outside closes it; a press inside the card does not', () => {
    render(row());
    hover(screen.getByTestId('wfp-host'));
    fireEvent.pointerDown(screen.getByTestId('wfp-card'));
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('wfp-card')).toBeNull();
  });

  it('the card is in the body, not after the row, so Tab from the row goes into it and Tab off its end returns to the row', () => {
    render(row());
    const r = screen.getByText('Review loop');
    act(() => r.focus());
    fireEvent.keyDown(r, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('wfp-open'));
    act(() => screen.getByTestId('wfp-launch').focus());
    fireEvent.keyDown(screen.getByTestId('wfp-launch'), { key: 'Tab' });
    expect(document.activeElement).toBe(r);
    act(() => screen.getByTestId('wfp-open').focus());
    fireEvent.keyDown(screen.getByTestId('wfp-open'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(r);
  });

  it('keeps the hover-intent delays: a quick pass does not open it, and the pointer can cross to the card without it closing', () => {
    render(row());
    const h = screen.getByTestId('wfp-host');
    fireEvent.pointerEnter(h);
    act(() => void vi.advanceTimersByTime(PREVIEW_OPEN_MS - 50));
    expect(screen.queryByTestId('wfp-card')).toBeNull();
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
    fireEvent.pointerLeave(h);
    fireEvent.pointerEnter(pop());
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
  });
});
