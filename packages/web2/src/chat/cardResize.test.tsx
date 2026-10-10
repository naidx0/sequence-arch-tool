// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CARD_CAP_FALLBACK, CARD_COLLAPSE_AT, CARD_FULL, CARD_MIN, cardCap, cardTitle, forgetCardMemory, readCard, resolveDrag, shownHeight } from './cardState';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ProseMessage } from './ProseMessage';

let NATURAL = 300;
const SVG = '```svg\n<svg viewBox="0 0 40 30"><rect width="20" height="10"/></svg>\n```';
const ORIGIN = { chat: 'c1', turn: 't1', repoRoot: null, at: 1 };
const saved = (id: string, name: string, title = 'Request path') => ({ ok: true, json: async () => ({ drawing: { id, title }, name, version: 1 }) });

/* jsdom has no layout: the body is NATURAL px tall unless a max-height clips it. */
beforeEach(() => {
  NATURAL = 300;
  forgetCardMemory();
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('dgm-body')) return 0;
      const mh = parseFloat(this.style.maxHeight);
      return Number.isFinite(mh) ? Math.min(mh, NATURAL) : NATURAL;
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(saved('d3', '3-request-path.svg')));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
});

const card = async (origin = ORIGIN) => {
  const r = render(<ProseMessage text={SVG} drawing={origin} />);
  const grip = await screen.findByTestId('chat-card-grip');
  await vi.waitFor(() => expect(screen.getByTestId('chat-card-title').getAttribute('title')).toMatch(/\nd3$/));
  return { ...r, grip };
};
const body = () => screen.getByTestId('chat-card-body');
/** Press the bar at y=500 and move it by dy. */
const drag = (grip: HTMLElement, dy: number, release = true) => {
  act(() => void grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 500 })));
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 500 + dy, buttons: 1 }));
  });
  if (release) act(() => void window.dispatchEvent(new MouseEvent('pointerup')));
};

describe('the rules', () => {
  it('growing is capped at the natural height, shrinking locks at the minimum, then collapses', () => {
    expect(resolveDrag(999, NATURAL)).toEqual({ h: null, collapse: false, locked: false });
    expect(resolveDrag(200, NATURAL)).toEqual({ h: 200, collapse: false, locked: false });
    expect(resolveDrag(CARD_MIN - 10, NATURAL)).toEqual({ h: CARD_MIN, collapse: false, locked: true });
    expect(resolveDrag(CARD_COLLAPSE_AT, NATURAL).collapse).toBe(false);
    expect(resolveDrag(CARD_COLLAPSE_AT - 1, NATURAL)).toEqual({ h: CARD_MIN, collapse: true, locked: true });
  });
  it('a drawing shorter than the minimum locks at its own height', () => {
    expect(resolveDrag(60, 70)).toEqual({ h: 70, collapse: false, locked: true });
    expect(resolveDrag(30, 70).collapse).toBe(true);
  });
  it('titles are capitalised and a file name or slug is never a title', () => {
    expect(cardTitle('request path', 'Drawing')).toBe('Request path');
    expect(cardTitle('14-gateway-pilot.svg', 'Drawing')).toBe('Gateway pilot');
    expect(cardTitle('d14 14-gateway-pilot', 'Drawing')).not.toMatch(/d14|\d/);
    expect(cardTitle('', 'Drawing')).toBe('Drawing');
  });
});

describe('the header', () => {
  it('shows only the title; the id and file name are in the tooltip', async () => {
    const { container } = await card();
    const bar = container.querySelector('.dgm-bar')!;
    expect(screen.getByTestId('chat-card-title').textContent).toBe('Request path');
    expect(bar.textContent).not.toMatch(/d3|3-request-path|\.svg/);
    expect(screen.getByTestId('chat-card-title').getAttribute('title')).toMatch(/\nd3$/);
  });
});

describe('the header actions are quiet', () => {
  it('View source, Copy and Open are icons with a name (aria-label and tooltip), and no text takes width from the title', async () => {
    const { container } = await card();
    const acts = container.querySelector('.dgm-bar .dgm-acts')!;
    expect(acts).toBeTruthy();
    for (const id of ['chat-diagram-toggle', 'chat-visual-copy', 'chat-visual-open']) {
      const b = screen.getByTestId(id);
      expect(b.closest('.dgm-acts')).toBe(acts);
      expect(b.textContent).toBe('');
      expect(b.querySelector('svg')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('data-tip')).toBe(b.getAttribute('aria-label'));
    }
    expect(screen.getByTestId('chat-diagram-toggle').getAttribute('aria-label')).toBe('View source');
    fireEvent.click(screen.getByTestId('chat-diagram-toggle'));
    expect(screen.getByTestId('chat-diagram-toggle').getAttribute('aria-label')).toBe('View drawing');
    expect(container.querySelector('.dgm-bar')!.textContent).toBe('Request path');
  });
  it('the title tooltip holds the whole title, then the id (never the file name)', async () => {
    await card();
    expect(screen.getByTestId('chat-card-title').getAttribute('title')).toBe('Request path\nd3');
  });
});

describe('resize, snap, collapse', () => {
  it('dragging up shrinks the body (clipped at 1:1, never scaled), dragging down grows it back and no further', async () => {
    const { grip } = await card();
    drag(grip, -100);
    expect(body().style.maxHeight).toBe('200px');
    expect(body().getAttribute('data-scaled')).toBeNull();
    expect(body().getAttribute('data-clipped')).toBe('true');
    drag(grip, +40);
    expect(body().style.maxHeight).toBe('240px');
    drag(grip, +900);
    expect(body().style.maxHeight).toBe(''); // natural again, never taller
  });
  it('past the snap threshold it locks at the minimum height', async () => {
    const { grip, container } = await card();
    drag(grip, -(NATURAL - CARD_MIN + 20));
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`);
    expect(container.querySelector('.dgm')!.getAttribute('data-locked')).toBe('true');
    expect(grip.getAttribute('aria-valuetext')).toBe('Minimum height');
    expect(screen.queryByTestId('chat-card-row')).toBeNull();
  });
  it('further up it only previews the collapse while the pointer is down, and collapses on release into a one-line row', async () => {
    const { grip } = await card();
    drag(grip, -NATURAL, false);
    expect(body().getAttribute('data-preview-collapse')).toBe('true');
    expect(screen.queryByTestId('chat-card-row')).toBeNull();
    act(() => void window.dispatchEvent(new MouseEvent('pointerup')));
    const row = screen.getByTestId('chat-card-row');
    expect(row.textContent).toBe('Request path');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(body().hidden).toBe(true);
    expect(document.activeElement).toBe(row);
    fireEvent.click(row);
    expect(screen.queryByTestId('chat-card-row')).toBeNull();
    expect(body().hidden).toBe(false);
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`); // back at the height it had
  });
});

describe('a drag that ends badly', () => {
  const move = (dy: number, buttons = 1) => act(() => void window.dispatchEvent(new MouseEvent('pointermove', { clientY: 500 + dy, buttons })));
  it('released outside the window (no pointerup reaches the page): the next move with no button down ends it', async () => {
    const { grip, container } = await card();
    drag(grip, -100, false);
    move(-120, 0); // the pointer comes back with the button already up
    expect(container.querySelector('.dgm')!.getAttribute('data-dragging')).toBeNull();
    expect(body().style.maxHeight).toBe('200px'); // where it was let go, not where it came back
    move(-200);
    expect(body().style.maxHeight).toBe('200px'); // no longer following the pointer
  });
  it('cancelled, or the window loses focus: dropped with nothing changed or remembered', async () => {
    const { grip, container } = await card();
    drag(grip, -100, false);
    act(() => void window.dispatchEvent(new MouseEvent('pointercancel')));
    expect(container.querySelector('.dgm')!.getAttribute('data-dragging')).toBeNull();
    expect(body().style.maxHeight).toBe('');
    drag(grip, -100, false);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(body().style.maxHeight).toBe('');
    expect(readCard('c1', 'd3')).toEqual({ h: null, c: false });
  });
  it('the card unmounts mid-drag (a list re-renders under it): its window listeners go with it', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { grip, unmount } = await card();
    drag(grip, -100, false);
    const added = add.mock.calls.filter(([t]) => String(t).startsWith('pointer') || t === 'blur').map(([t, f]) => [t, f]);
    expect(added.length).toBeGreaterThanOrEqual(3);
    unmount();
    for (const [t, f] of added) expect(remove.mock.calls.some(([rt, rf]) => rt === t && rf === f)).toBe(true);
    move(-150); // nothing throws, nothing is written
    act(() => void window.dispatchEvent(new MouseEvent('pointerup')));
    expect(readCard('c1', 'd3')).toEqual({ h: null, c: false });
  });
  it('a second finger does not start a second drag', async () => {
    const { grip } = await card();
    drag(grip, -100, false);
    const second = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 300 });
    Object.defineProperty(second, 'isPrimary', { value: false });
    act(() => void grip.dispatchEvent(second));
    move(-60);
    act(() => void window.dispatchEvent(new MouseEvent('pointerup')));
    expect(body().style.maxHeight).toBe('240px');
  });
});

describe('keyboard', () => {
  it('the bar is focusable; arrows resize, Home locks, End returns to natural, Enter collapses, the row opens with Enter', async () => {
    const { grip } = await card();
    expect(grip.getAttribute('tabindex')).toBe('0');
    expect(grip.getAttribute('role')).toBe('slider');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(body().style.maxHeight).toBe(`${NATURAL - 24}px`);
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(body().style.maxHeight).toBe('');
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`);
    fireEvent.keyDown(grip, { key: 'End' });
    expect(body().style.maxHeight).toBe('');
    fireEvent.keyDown(grip, { key: 'Enter' });
    const row = screen.getByTestId('chat-card-row');
    expect(document.activeElement).toBe(row);
    fireEvent.click(row);
    expect(document.activeElement).toBe(screen.getByTestId('chat-card-grip'));
  });
  it('PageUp and PageDown take the big step; PageUp stops at the minimum and never collapses', async () => {
    const { grip } = await card();
    fireEvent.keyDown(grip, { key: 'PageUp' });
    expect(body().style.maxHeight).toBe(`${NATURAL - 96}px`);
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(grip, { key: 'PageUp' });
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`);
    expect(screen.queryByTestId('chat-card-row')).toBeNull();
    fireEvent.keyDown(grip, { key: 'PageDown' });
    expect(body().style.maxHeight).toBe(`${CARD_MIN + 96}px`);
  });
  it('arrowing up past the locked minimum collapses', async () => {
    const { grip } = await card();
    fireEvent.keyDown(grip, { key: 'Home' });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(screen.getByTestId('chat-card-row')).toBeTruthy();
  });
});

describe('persistence', () => {
  it('is kept per drawing id and chat, and survives a remount and a reload', async () => {
    const first = await card();
    drag(first.grip, -100);
    fireEvent.keyDown(screen.getByTestId('chat-card-grip'), { key: 'Home' });
    expect(JSON.parse(localStorage.getItem('seq.cards.v1:c1')!)).toEqual({ d3: { h: CARD_MIN, c: false } });
    first.unmount();
    forgetCardMemory(); // a reload: only storage remains
    await card();
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`);
    cleanup();
    await card({ ...ORIGIN, chat: 'c2' }); // another chat's d3 is its own
    expect(body().style.maxHeight).toBe('');
  });
  it('a card restored from a reload shows its lock and its slider value before anyone touches it', async () => {
    const first = await card();
    fireEvent.keyDown(first.grip, { key: 'Home' });
    first.unmount();
    forgetCardMemory();
    const { grip, container } = await card();
    expect(body().style.maxHeight).toBe(`${CARD_MIN}px`);
    expect(container.querySelector('.dgm')!.getAttribute('data-locked')).toBe('true');
    expect(grip.getAttribute('aria-valuenow')).toBe(String(Math.round((CARD_MIN / NATURAL) * 100)));
    expect(grip.getAttribute('aria-valuetext')).toBe('Minimum height');
  });
  it('storage that throws on access (sandboxed, site data blocked) is not an error: the card still works this session', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); } });
    try {
      forgetCardMemory();
      const { grip } = await card();
      drag(grip, -100);
      expect(body().style.maxHeight).toBe('200px');
      expect(readCard('c1', 'd3').h).toBe(200);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
  it('a collapsed card stays collapsed after it scrolls out (unmount) and after a reload', async () => {
    const first = await card();
    fireEvent.keyDown(first.grip, { key: 'Enter' });
    first.unmount();
    await screen.findByText('', {}, { timeout: 1 }).catch(() => undefined);
    render(<ProseMessage text={SVG} drawing={ORIGIN} />);
    expect(await screen.findByTestId('chat-card-row')).toBeTruthy();
    cleanup();
    forgetCardMemory();
    render(<ProseMessage text={SVG} drawing={ORIGIN} />);
    expect(await screen.findByTestId('chat-card-row')).toBeTruthy();
    expect(readCard('c1', 'd3').c).toBe(true);
  });
  it('still works when storage is blocked', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { grip } = await card();
    drag(grip, -100);
    expect(body().style.maxHeight).toBe('200px');
    set.mockRestore();
  });
});

describe('motion', () => {
  it('every card transition is switched off under reduced motion', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${__dirname}/diagramBlock.css`, 'utf8');
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*\.dgm\[data-state='drawn'\] \.dgm-body,[\s\S]*?transition: none/.exec(css);
    expect(reduced).not.toBeNull();
  });
});

const CAP = CARD_CAP_FALLBACK;

describe('the default height cap', () => {
  it('is one value from the tokens: --col-min, 420px, the narrowest the chat column goes', () => {
    expect(CAP).toBe(420);
    const tokens = readFileSync(join(__dirname, '..', 'tokens', 'graphite.css'), 'utf8');
    expect(tokens).toMatch(/--col-min:\s*420px/);
    expect(cardCap(null)).toBe(420);
    const host = document.createElement('div');
    host.style.setProperty('--col-min', '400px');
    document.body.appendChild(host);
    expect(cardCap(host)).toBe(400);
    host.remove();
  });
  it('the rules: taller than the cap opens at the cap; growing to the natural height is remembered as full', () => {
    expect(shownHeight(null, 300, CAP)).toBeNull();
    expect(shownHeight(null, 900, CAP)).toBe(CAP);
    expect(shownHeight(500, 900, CAP)).toBe(500);
    expect(shownHeight(CARD_FULL, 900, CAP)).toBeNull();
    expect(resolveDrag(999, 900, CAP)).toEqual({ h: CARD_FULL, collapse: false, locked: false });
    expect(resolveDrag(999, 300, CAP)).toEqual({ h: null, collapse: false, locked: false });
    expect(resolveDrag(CAP, 900, CAP)).toEqual({ h: CAP, collapse: false, locked: false });
  });
  it('a tall card opens at the cap with its bar showing there is more; a short card is not touched', async () => {
    NATURAL = 900;
    const tall = await card();
    expect(body().style.maxHeight).toBe(`${CAP}px`);
    expect(tall.container.querySelector('.dgm')!.getAttribute('data-capped')).toBe('true');
    expect(body().getAttribute('data-scaled')).toBeNull();
    expect(body().getAttribute('data-clipped')).toBe('true');
    expect(tall.grip.getAttribute('aria-valuenow')).toBe(String(Math.round((CAP / 900) * 100)));
    expect(tall.grip.getAttribute('aria-valuetext')).toMatch(/Default height/);
    cleanup();
    NATURAL = 300;
    const short = await card();
    expect(body().style.maxHeight).toBe('');
    expect(short.container.querySelector('.dgm')!.getAttribute('data-capped')).toBeNull();
  });
  it('the bar drags a capped card bigger, up to the natural height and no further', async () => {
    NATURAL = 900;
    const { grip, container } = await card();
    drag(grip, +100);
    expect(body().style.maxHeight).toBe(`${CAP + 100}px`);
    expect(container.querySelector('.dgm')!.getAttribute('data-capped')).toBeNull();
    drag(grip, +2000);
    expect(body().style.maxHeight).toBe(''); // natural, never taller
    expect(grip.getAttribute('aria-valuenow')).toBe('100');
    expect(grip.getAttribute('aria-valuetext')).toBe('Full height');
  });
  it('dragging a capped card smaller starts from the cap, not from the natural height', async () => {
    NATURAL = 900;
    const { grip } = await card();
    drag(grip, -100);
    expect(body().style.maxHeight).toBe(`${CAP - 100}px`);
  });
  it('the keyboard reaches the natural height (End) and returns to the cap size with Home/Up', async () => {
    NATURAL = 900;
    const { grip } = await card();
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(body().style.maxHeight).toBe(`${CAP + 24}px`);
    fireEvent.keyDown(grip, { key: 'End' });
    expect(body().style.maxHeight).toBe('');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(body().style.maxHeight).toBe(`${900 - 24}px`);
  });
  it('the cap state persists like the rest: the default stores nothing, a bigger size and "full" survive a reload', async () => {
    NATURAL = 900;
    const first = await card();
    expect(localStorage.getItem('seq.cards.v1:c1')).toBeNull(); // the default is not written
    drag(first.grip, +100);
    first.unmount();
    forgetCardMemory();
    const second = await card();
    expect(body().style.maxHeight).toBe(`${CAP + 100}px`);
    drag(second.grip, +2000);
    expect(JSON.parse(localStorage.getItem('seq.cards.v1:c1')!)).toEqual({ d3: { h: CARD_FULL, c: false } });
    second.unmount();
    forgetCardMemory();
    await card();
    expect(body().style.maxHeight).toBe('');
  });
  it('a collapsed tall card opens again at the cap', async () => {
    NATURAL = 900;
    const { grip } = await card();
    fireEvent.keyDown(grip, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('chat-card-row'));
    expect(body().style.maxHeight).toBe(`${CAP}px`);
  });
  it('every drawing card (svg, html, mermaid, kit) is drawn by the one VisualCard that owns the cap', () => {
    for (const f of ['DiagramBlock.tsx', 'VisualBlock.tsx']) expect(readFileSync(join(__dirname, f), 'utf8')).toMatch(/<VisualCard\b/);
    expect(readFileSync(join(__dirname, 'VisualKitBlock.tsx'), 'utf8')).toMatch(/DiagramBlock/);
  });
});

describe('wide content scales to the column and never scrolls sideways', () => {
  const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('no drawing surface scrolls on the x axis, and there is no "scroll sideways" hint', () => {
    expect(css).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(css).not.toMatch(/dgm-hint/);
    expect(readFileSync(join(__dirname, 'DiagramBlock.tsx'), 'utf8')).not.toMatch(/Scroll sideways/);
  });
  it('a mermaid drawing wider than the column is scaled to fit, with no floor that would leave it scrolling', async () => {
    const { fitDiagramScale, DIAGRAM_MIN_SCALE } = await import('./DiagramBlock');
    expect(fitDiagramScale(2215, 440)).toBeCloseTo(440 / 2215, 5);
    expect(fitDiagramScale(300, 440)).toBe(1);
    expect(DIAGRAM_MIN_SCALE).toBeLessThan(0.1);
  });
});

describe('a file name is never shown in the chat', () => {
  it('no text, title, aria-label or tooltip on the card holds the file name; Copy file name puts it on the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    const { container } = await card();
    const everything = [container.textContent ?? '', ...Array.from(container.querySelectorAll('*')).flatMap((n) => Array.from(n.attributes).map((a) => a.value))].join('\n');
    expect(everything).not.toMatch(/3-request-path|\.svg\b/);
    const b = screen.getByTestId('chat-visual-copy-name');
    expect(b.getAttribute('aria-label')).toBe('Copy file name');
    expect(b.getAttribute('data-tip')).toBe('Copy file name');
    fireEvent.click(b);
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('3-request-path.svg'));
  });
  it('the header never wraps: title and actions stay on one line at any width', () => {
    const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const bar = [...css.matchAll(/\.dgm-bar \{([^}]*)\}/g)].map((m) => m[1]).join(';');
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar).toMatch(/white-space:\s*nowrap/);
    expect(bar).not.toMatch(/flex-wrap:\s*wrap\b/);
    const title = /\.dgm-title \{([^}]*)\}/.exec(css)![1]!;
    expect(title).toMatch(/white-space:\s*nowrap/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
    expect(/\.dgm-row \.dgm-title \{([^}]*)\}/.exec(css)![1]).toMatch(/white-space:\s*nowrap/);
  });
  it('a title that is a file name is humanised, and a long one is the same single line', async () => {
    expect(cardTitle('3-request-path.svg', 'Drawing')).toBe('Request path');
    expect(cardTitle('A very long title '.repeat(12), 'Drawing').includes('\n')).toBe(false);
  });
});

describe('the drag handle is easy to hit and plainly there', () => {
  const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the strip is 20px (it was 12), 24px under a finger, tints and grows its pill on hover, and shows at rest when capped', () => {
    expect(/\.dgm-grip \{([^}]*)\}/.exec(css)![1]).toMatch(/height:\s*var\(--sp-20\)/);
    expect(/\.dgm-grip \{([^}]*)\}/.exec(css)![1]).toMatch(/cursor:\s*ns-resize/);
    expect(css).toMatch(/\.dgm-grip:hover \{\s*background: color-mix\(in srgb, var\(--b-ink1\) \d% , ?transparent\)|\.dgm-grip:hover \{\s*background: color-mix\(in srgb, var\(--b-ink1\) \d+%, transparent\)/);
    expect(css).toMatch(/\.dgm \.dgm-grip:hover \.dgm-grip-pill[^{]*\{[^}]*width: 40px/);
    expect(css).toMatch(/\.dgm\[data-capped='true'\] \.dgm-grip-pill \{\s*opacity: 0\.45/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.dgm-grip \{\s*height: var\(--target-min\)/);
  });
  it('everything stays transparent: the card, the strip at rest and the pill have no solid fill', () => {
    expect(/\.dgm \{([^}]*)\}/.exec(css)![1]).toMatch(/background:\s*transparent/);
    expect(/\.dgm-grip \{([^}]*)\}/.exec(css)![1]).toMatch(/background:\s*transparent/);
    expect(css).not.toMatch(/\.dgm-grip:hover \{[^}]*background: var\(--surface/);
  });
});

describe('the cap never scales content (round 4)', () => {
  const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('there is no rule that scales a drawing to the card height: no max-height on the svg, no data-scaled', () => {
    expect(css).not.toMatch(/data-scaled/);
    expect(css).not.toMatch(/\.dgm-art svg[^{]*\{[^}]*max-height/);
    expect(readFileSync(join(__dirname, 'VisualCard.tsx'), 'utf8')).not.toMatch(/data-scaled/);
  });
  it('a clipped body fades its bottom edge instead, and stays transparent', () => {
    const r = /\.dgm-body\[data-clipped='true'\] \{([^}]*)\}/.exec(css)![1]!;
    expect(r).toMatch(/mask-image:\s*linear-gradient\(to bottom, black calc\(100% - var\(--sp-24\)\), transparent\)/);
    expect(r).not.toMatch(/background/);
  });
  it('a capped card clips; the drawing inside keeps its size (the inline svg is untouched)', async () => {
    NATURAL = 900;
    await card();
    expect(body().getAttribute('data-clipped')).toBe('true');
    const svg = body().querySelector('svg')!;
    expect(svg.style.maxHeight).toBe('');
    expect(svg.style.height).toBe('');
  });
});

describe('one title, shown once, never "Visual"', () => {
  it('reads the title a drawing carries: an svg <title>, a mermaid front-matter title, a mermaid title line', async () => {
    const { drawingTitle } = await import('./DiagramBlock');
    expect(drawingTitle('svg', '<svg><title>AI feature gateway at 1,000 users</title></svg>')).toBe('AI feature gateway at 1,000 users');
    expect(drawingTitle('mermaid', '---\ntitle: Request flow\n---\nflowchart LR\nA-->B')).toBe('Request flow');
    expect(drawingTitle('mermaid', 'pie\n  title Pets\n  "a": 1')).toBe('Pets');
    expect(drawingTitle('mermaid', 'flowchart LR\nA-->B')).toBe('');
  });
  it('detects a drawing that draws its own title as its first text', async () => {
    const { drawsTitle } = await import('./DiagramBlock');
    const host = document.createElement('div');
    host.innerHTML = '<svg><title>Where a request spends its time</title><g><text>Where a request spends its time</text><text>CDN</text></g></svg>';
    expect(drawsTitle(host, 'Where a request spends its time')).toBe(true);
    expect(drawsTitle(host, 'Something else')).toBe(false);
    host.innerHTML = '<svg><text>CDN</text></svg>';
    expect(drawsTitle(host, 'Where a request spends its time')).toBe(false);
  });
  it('a card with a drawn heading shows the title once: the header title is for assistive tech and the row, the actions sit in the corner', async () => {
    const kit = '```svg\n<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><title>Gateway load</title><text x="0" y="14">Gateway load</text><rect y="30" width="20" height="10"/></svg>\n```';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(saved('d3', '3-gateway-load.svg', 'Gateway load')));
    const { container } = render(<ProseMessage text={kit} drawing={ORIGIN} />);
    await screen.findByTestId('chat-diagram-art');
    await vi.waitFor(() => expect(container.querySelector('.dgm')!.getAttribute('data-own-title')).toBe('true'));
    expect(screen.getByTestId('chat-card-title').textContent).toBe('Gateway load');
    expect(screen.getByTestId('chat-card-title').className).toContain('dgm-title-own');
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(saved('d4', '4-request-path.svg', 'Request path')));
    const plain = '```svg\n<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><title>Request path</title><rect width="20" height="10"/></svg>\n```';
    const r2 = render(<ProseMessage text={plain} drawing={ORIGIN} />);
    await screen.findByTestId('chat-diagram-art');
    expect(r2.container.querySelector('.dgm')!.getAttribute('data-own-title')).toBeNull();
    expect(screen.getByTestId('chat-card-title').textContent).toBe('Request path');
  });
  it('the css puts the actions in the corner and takes the bar out of the flow for such a card', () => {
    const css = readFileSync(join(__dirname, 'diagramBlock.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.dgm\[data-own-title='true'\] > \.dgm-bar \{[^}]*position: absolute/);
    expect(readFileSync(join(__dirname, 'VisualKitBlock.tsx'), 'utf8')).not.toMatch(/>Visual</);
    expect(readFileSync(join(__dirname, 'VisualKitBlock.tsx'), 'utf8')).not.toMatch(/label="Visual"/);
  });
});
