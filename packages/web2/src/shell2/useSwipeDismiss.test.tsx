import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SWIPE_DISTANCE, swipeReleases, useSwipeDismiss } from './useSwipeDismiss';

/* Decision 52: swipe to close. Past the distance (or a quick flick) closes through the caller's exit path,
   a short drag springs back, and a mouse on a desktop-width window is ignored. */

/* jsdom has no PointerEvent: a MouseEvent that carries the two fields the hook reads. */
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
beforeAll(() => vi.stubGlobal('PointerEvent', FakePointerEvent));

let clock = 0;
const now = () => clock;

function Sheet({ onDismiss, axis }: { onDismiss: () => void; axis?: 'y' | 'x' }) {
  const ref = useRef<HTMLDivElement>(null);
  const h = useSwipeDismiss(ref, onDismiss, { now, ...(axis ? { axis } : {}) });
  return (
    <div ref={ref} data-testid="sheet" {...h}>
      <input data-testid="field" />
    </div>
  );
}

const media = (narrow: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: narrow && q.includes('max-width: 720px'), media: q, addEventListener() {}, removeEventListener() {} }));

function drag(target: Element, type: string, from: [number, number], to: [number, number], over = 200) {
  clock = 0;
  const base = { pointerId: 7, pointerType: type, button: 0 };
  fireEvent.pointerDown(target, { ...base, clientX: from[0], clientY: from[1] });
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    clock = (over * i) / steps;
    fireEvent.pointerMove(target, { ...base, clientX: from[0] + ((to[0] - from[0]) * i) / steps, clientY: from[1] + ((to[1] - from[1]) * i) / steps });
  }
  fireEvent.pointerUp(target, { ...base, clientX: to[0], clientY: to[1] });
}

afterEach(() => vi.stubGlobal('matchMedia', undefined));

describe('useSwipeDismiss', () => {
  it('a touch drag past the distance follows the finger and then closes through onDismiss (positive control)', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId('sheet');
    clock = 0;
    const base = { pointerId: 7, pointerType: 'touch', button: 0 };
    fireEvent.pointerDown(sheet, { ...base, clientX: 50, clientY: 100 });
    clock = 100;
    fireEvent.pointerMove(sheet, { ...base, clientX: 50, clientY: 140 });
    expect(sheet.style.transform).toBe('translateY(40px)');
    expect(sheet.getAttribute('data-dragging')).toBe('true');
    clock = 200;
    fireEvent.pointerMove(sheet, { ...base, clientX: 50, clientY: 100 + SWIPE_DISTANCE + 10 });
    fireEvent.pointerUp(sheet, { ...base, clientX: 50, clientY: 100 + SWIPE_DISTANCE + 10 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(sheet.getAttribute('data-swiped')).toBe('y');
    expect(sheet.style.transform).toBe(`translateY(${SWIPE_DISTANCE + 10}px)`);
  });

  it('a short, slow drag springs back and does not close (negative control)', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId('sheet');
    drag(sheet, 'touch', [50, 100], [50, 130], 600);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
    expect(sheet.style.transition).toContain('var(--dur-3)');
    expect(sheet.hasAttribute('data-swiped')).toBe(false);
    expect(sheet.hasAttribute('data-dragging')).toBe(false);
  });

  it('a quick flick that has gone a little way closes', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    drag(screen.getByTestId('sheet'), 'touch', [50, 100], [50, 140], 40);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a mouse at desktop width is ignored: no follow, no close', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId('sheet');
    drag(sheet, 'mouse', [50, 100], [50, 400], 100);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
    expect(sheet.hasAttribute('data-dragging')).toBe(false);
  });

  it('a mouse in a narrow window drags (the v3 breakpoint)', () => {
    media(true);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    drag(screen.getByTestId('sheet'), 'mouse', [50, 100], [50, 300], 100);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('upward and sideways drags are not a dismissal, and a drag that starts in a field is left to the field', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} />);
    const sheet = screen.getByTestId('sheet');
    drag(sheet, 'touch', [50, 300], [50, 100], 100);
    drag(sheet, 'touch', [50, 100], [300, 120], 100);
    drag(screen.getByTestId('field'), 'touch', [50, 100], [50, 300], 100);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('the side axis pulls right', () => {
    media(false);
    const onDismiss = vi.fn();
    render(<Sheet onDismiss={onDismiss} axis="x" />);
    const sheet = screen.getByTestId('sheet');
    drag(sheet, 'touch', [50, 100], [200, 100], 100);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(sheet.getAttribute('data-swiped')).toBe('x');
  });

  it('release rule: far enough, or fast and a little way; neither otherwise', () => {
    expect(swipeReleases(SWIPE_DISTANCE, 0)).toBe(true);
    expect(swipeReleases(30, 1)).toBe(true);
    expect(swipeReleases(10, 5)).toBe(false);
    expect(swipeReleases(SWIPE_DISTANCE - 1, 0.1)).toBe(false);
  });
});
