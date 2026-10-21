import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { SPLIT_KEY } from './layoutPrefs';
import { seedOpenArchitecture } from './legacyDefaultTabs.testSupport';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

/*
 * ROUND 0.1.5, G2 (owner): "resizing surfaces is very not smooth". A drag used to set React state on every
 * pointer move, re-rendering the whole shell per pixel. It now writes the size straight onto the panes once per
 * animation frame and commits state once, on release.
 */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

let frames: Array<() => void> = [];
let rafCalls = 0;
beforeEach(() => {
  localStorage.clear();
  seedOpenArchitecture();
  frames = [];
  rafCalls = 0;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    rafCalls += 1;
    frames.push(() => fn(0));
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const ptr = (el: EventTarget, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true, button: 0 }));
  });
const flushFrames = () =>
  act(() => {
    const run = frames;
    frames = [];
    for (const f of run) f();
  });

describe('a split drag is one frame of work per frame', () => {
  it('writes the panes\' flex directly, coalesced per frame, and commits React state once on release', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('v3-tab-close-architecture'));
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    fireEvent.click(screen.getByTestId('s2-tab-whiteboard'), BESIDE);
    const stage = document.querySelector<HTMLElement>('.s2-stage')!;
    stage.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const panes = () => Array.from(stage.querySelectorAll<HTMLElement>(':scope > .s2-pane'));
    expect(panes().length).toBe(2);
    const divider = screen.getByTestId('s2-split-divider');
    const nowBefore = divider.getAttribute('aria-valuenow');
    const flexBefore = panes()[0]!.style.flex;
    frames = [];
    rafCalls = 0;

    ptr(divider, 'pointerdown', 500);
    for (const x of [510, 520, 530, 540, 550, 560]) ptr(window, 'pointermove', x);
    /* Six moves, one frame requested, nothing computed yet. */
    expect(rafCalls).toBe(1);
    expect(panes()[0]!.style.flex).toBe(flexBefore);

    flushFrames();
    const flexMid = panes()[0]!.style.flex;
    expect(flexMid).not.toBe(flexBefore);
    /* Mid-drag the pane moved but React did not render: the divider's own value is still the old one. */
    expect(screen.getByTestId('s2-split-divider').getAttribute('aria-valuenow')).toBe(nowBefore);

    ptr(window, 'pointermove', 600);
    ptr(window, 'pointerup', 600);
    /* Release: the pending frame is flushed, the state committed once, the size stored. */
    expect(screen.getByTestId('s2-split-divider').getAttribute('aria-valuenow')).not.toBe(nowBefore);
    expect(Number(localStorage.getItem(SPLIT_KEY))).toBeGreaterThan(0.5);
    expect(panes()[0]!.style.flex).not.toBe(flexMid);
  });
});

describe('the chat column never squeezes the surfaces below what they can show (round 0.1.5)', () => {
  it('a stored chat width wider than the open panes allow gives way for the session, not for good', () => {
    localStorage.setItem('v3.chatW', '760');
    const proto = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const w = this.classList.contains('s2-stage') ? 450 : 0;
      return { left: 0, right: w, width: w, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      render(<V3App appStore={freshStore()} />);
      fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
      /* Two panes want 240 each plus the 8 px divider: 488 against a 450 stage, so the chat gives 38 px. */
      const col = document.querySelector<HTMLElement>('.v3-chat-col')!;
      expect(col.style.width).toBe('722px');
      expect(localStorage.getItem('v3.chatW')).toBe('760');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = proto;
    }
  });
});
