import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import cssRaw from './shell2.css?raw';

/* The sidebar drawn over a phone's chat is a menu: choosing something in it, tapping the dim behind it or swiping
   it left puts it away. (Owner-seat sweep: the drawer stayed over the chat after New chat.) */

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

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}
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

const drawer = () => document.querySelector<HTMLElement>('.v3-rail-slot')!;
const isOpen = () => drawer().classList.contains('is-overlay');
const openDrawer = () => {
  fireEvent.click(screen.getByTestId('s2-sidebar-open'));
  expect(isOpen()).toBe(true);
};

describe('the drawer over a narrow chat', () => {
  it('sits on a dim, and a tap on the dim puts it away', () => {
    render(<V3App appStore={freshStore()} />);
    openDrawer();
    const scrim = document.querySelector<HTMLElement>('.s2-rail-scrim')!;
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim);
    expect(isOpen()).toBe(false);
    expect(document.querySelector('.s2-rail-scrim')).toBeNull();
  });

  it('the dim is the scrim token, not a literal', () => {
    const css = cssRaw.replace(/\r\n/g, '\n');
    const at = css.indexOf('\n.s2-rail-scrim {');
    expect(css.slice(at, css.indexOf('}', at))).toContain('background: var(--scrim)');
  });

  it('New chat dismisses it', () => {
    render(<V3App appStore={freshStore()} />);
    openDrawer();
    fireEvent.click(screen.getByTestId('s2-new-chat'));
    expect(isOpen()).toBe(false);
  });

  it('a swipe left on the drawer dismisses it; a swipe right does not', () => {
    render(<V3App appStore={freshStore()} />);
    openDrawer();
    const swipe = (from: number, to: number) => {
      const base = { pointerId: 3, pointerType: 'touch', button: 0, clientY: 300 };
      const el = drawer();
      act(() => {
        fireEvent.pointerDown(el, { ...base, clientX: from });
        for (let i = 1; i <= 4; i++) fireEvent.pointerMove(el, { ...base, clientX: from + ((to - from) * i) / 4 });
        fireEvent.pointerUp(el, { ...base, clientX: to });
      });
    };
    swipe(200, 280);
    expect(isOpen()).toBe(true);
    swipe(220, 60);
    expect(isOpen()).toBe(false);
  });

  it('a wide window has no drawer behaviour to dismiss', () => {
    setWidth(1440);
    render(<V3App appStore={freshStore()} />);
    expect(screen.queryByTestId('s2-sidebar-open')).toBeNull();
    expect(isOpen()).toBe(false);
  });
});
