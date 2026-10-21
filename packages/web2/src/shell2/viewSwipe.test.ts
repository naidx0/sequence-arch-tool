import { afterEach, describe, expect, it } from 'vitest';

import { viewSwipeBlocked, viewSwipeStep } from './viewSwipe';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('which way a drag turns the view', () => {
  it('a long sideways drag turns it: left is the next tab, right the previous', () => {
    expect(viewSwipeStep(-120, 4, 300)).toBe(1);
    expect(viewSwipeStep(120, -4, 300)).toBe(-1);
  });
  it('a short, slow drag does nothing; a short quick flick does', () => {
    expect(viewSwipeStep(-30, 0, 400)).toBe(0);
    expect(viewSwipeStep(-40, 0, 60)).toBe(1);
  });
  it('a vertical or diagonal drag does nothing, however far (it is a scroll)', () => {
    expect(viewSwipeStep(-90, 140, 300)).toBe(0);
    expect(viewSwipeStep(-100, 80, 300)).toBe(0);
    expect(viewSwipeStep(0, 200, 300)).toBe(0);
  });
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="main">${html}</div>`;
  return document.getElementById('main')!;
}

describe('where a swipe is not ours', () => {
  it('plain content is free to swipe (positive control)', () => {
    const main = mount('<p id="t">hello</p>');
    expect(viewSwipeBlocked(document.getElementById('t')!, main)).toBe(false);
  });
  it('a text field, a textarea and a contenteditable keep their drag', () => {
    const main = mount('<input id="a"><textarea id="b"></textarea><div contenteditable="true"><span id="c">x</span></div>');
    for (const id of ['a', 'b', 'c']) expect(viewSwipeBlocked(document.getElementById(id)!, main), id).toBe(true);
  });
  it('a surface that took touch-action (the board canvas) keeps its drag', () => {
    /* jsdom does not carry touch-action through getComputedStyle, so the reader is handed in; a browser reads the real cascade. */
    const main = mount('<div class="board"><canvas id="t"></canvas></div>');
    const styleOf = (el: Element) => ({ getPropertyValue: (p: string) => (p === 'touch-action' && el.classList.contains('board') ? 'none' : ''), overflowX: 'visible' }) as unknown as CSSStyleDeclaration;
    expect(viewSwipeBlocked(document.getElementById('t')!, main, styleOf)).toBe(true);
    expect(viewSwipeBlocked(document.getElementById('main')!.firstElementChild!.parentElement!, null, () => styleOf(document.body))).toBe(false);
  });
  it('a horizontally scrollable region keeps its drag; one that does not overflow does not', () => {
    const main = mount('<div id="s" style="overflow-x:auto"><span id="in">wide</span></div>');
    const s = document.getElementById('s')!;
    Object.defineProperty(s, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(s, 'clientWidth', { value: 300, configurable: true });
    expect(viewSwipeBlocked(document.getElementById('in')!, main)).toBe(true);
    Object.defineProperty(s, 'scrollWidth', { value: 300, configurable: true });
    expect(viewSwipeBlocked(document.getElementById('in')!, main)).toBe(false);
  });
  it('an element marked data-no-swipe keeps its drag', () => {
    const main = mount('<div data-no-swipe><b id="t">x</b></div>');
    expect(viewSwipeBlocked(document.getElementById('t')!, main)).toBe(true);
  });
});
