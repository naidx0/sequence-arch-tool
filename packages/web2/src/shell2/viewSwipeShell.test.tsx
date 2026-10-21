import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';

/* Swiping the main area on a phone turns Chat <-> Workspace, as the tabs do. */

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

const store = (): Store =>
  createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('data-platform', 'win');
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  setWidth(390);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  setWidth(1024);
});

const selected = () => document.querySelector('[data-testid="s2-narrow-switch"] [aria-selected="true"]')!.getAttribute('data-testid');
function swipe(el: Element, from: number, to: number, touch = true) {
  const at = (x: number) => [{ clientX: x, clientY: 400, identifier: 1, target: el }];
  act(() => {
    if (touch) {
      fireEvent.touchStart(el, { touches: at(from), changedTouches: at(from) });
      fireEvent.touchMove(el, { touches: at((from + to) / 2), changedTouches: at((from + to) / 2) });
      fireEvent.touchEnd(el, { touches: [], changedTouches: at(to) });
    } else {
      /* a mouse: pointer events only, no touch events */
      fireEvent.pointerDown(el, { pointerId: 5, pointerType: 'mouse', button: 0, clientX: from, clientY: 400 });
      fireEvent.pointerUp(el, { pointerId: 5, pointerType: 'mouse', button: 0, clientX: to, clientY: 400 });
    }
  });
}

describe('swiping between Chat and Workspace', () => {
  it('a swipe left shows the workspace, a swipe right brings the chat back', () => {
    render(<V3App appStore={store()} />);
    const row = document.querySelector('.s2-row')!;
    expect(selected()).toBe('s2-narrow-chat');
    swipe(row, 300, 100);
    expect(selected()).toBe('s2-narrow-stage');
    swipe(row, 100, 300);
    expect(selected()).toBe('s2-narrow-chat');
    /* at the end of the line, nothing further */
    swipe(row, 100, 300);
    expect(selected()).toBe('s2-narrow-chat');
  });

  it('a mouse does not swipe, and a short drag does not', () => {
    render(<V3App appStore={store()} />);
    const row = document.querySelector('.s2-row')!;
    swipe(row, 300, 100, false);
    expect(selected()).toBe('s2-narrow-chat');
    swipe(row, 200, 180);
    expect(selected()).toBe('s2-narrow-chat');
  });

  it('a swipe that starts in the message box is the text field\'s', () => {
    render(<V3App appStore={store()} />);
    swipe(screen.getByTestId('composer-field'), 300, 100);
    expect(selected()).toBe('s2-narrow-chat');
  });

  it('a wide window has no swipe (there is no switch to turn)', () => {
    setWidth(1440);
    render(<V3App appStore={store()} />);
    expect(screen.queryByTestId('s2-narrow-switch')).toBeNull();
    swipe(document.querySelector('.s2-row')!, 300, 100);
    expect(screen.queryByTestId('s2-narrow-switch')).toBeNull();
  });
});
