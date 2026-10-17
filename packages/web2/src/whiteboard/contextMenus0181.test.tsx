import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ASK_AGENT_LABEL } from '../askInPlace/useAskInPlace';
import { BoardMenu } from '../canvas/BoardMenu';
import { Whiteboard } from './Whiteboard';

/*
 * 0.1.8.1 C7 (audit P2-3: "Minimal right-click menu, with duplicate Ask items"). Exactly one "Ask agent about this";
 * Duplicate, Delete, Bring to front, Copy as image and Explain are there; the empty board has a menu too; no context
 * menu has two rows with the same words.
 */

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
function drag(el: Element, a: { x: number; y: number }, b: { x: number; y: number }) {
  const fire = (type: string, p: { x: number; y: number }) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
  fire('pointerdown', a);
  fire('pointermove', b);
  fire('pointerup', b);
}
const labels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((b) => b.textContent?.trim() ?? '');
function expectNoDuplicateLabels(menu: HTMLElement) {
  const l = labels(menu).map((x) => x.toLowerCase());
  expect(new Set(l).size, l.join(' | ')).toBe(l.length);
}

afterEach(cleanup);

function boardWithOneBox(withAsk = true) {
  render(<Whiteboard repoRoot="r" storage={memoryStore()} {...(withAsk ? { onAskInPlace: vi.fn(), onAsk: vi.fn() } : {})} />);
  fireEvent.click(screen.getByTestId('wb-shapes-main'));
  drag(screen.getByTestId('wb-canvas'), { x: 20, y: 20 }, { x: 120, y: 90 });
  return screen.getAllByTestId('wb-item')[0]!;
}
const shapes = () => screen.queryAllByTestId('wb-item');

describe('the Spaces board right-click menus (C7)', () => {
  it('on a mark: one Ask agent about this, then Explain, Find callers, Write a test, Refactor, Duplicate, Bring to front, Copy as image, Delete', () => {
    const item = boardWithOneBox();
    fireEvent.contextMenu(item);
    const menu = screen.getByTestId('ask-menu');
    expect(labels(menu)).toEqual([ASK_AGENT_LABEL, 'Explain', 'Find callers', 'Write a test', 'Refactor', 'Duplicate', 'Bring to front', 'Copy as image', 'Delete']);
    expect(labels(menu).filter((l) => /ask/i.test(l))).toEqual(['Ask agent about this']);
    expectNoDuplicateLabels(menu);
  });

  it('Duplicate adds a copy; Delete removes it; both are one undo each', () => {
    const item = boardWithOneBox();
    fireEvent.contextMenu(item);
    fireEvent.click(screen.getByTestId('ask-menu-duplicate'));
    expect(shapes()).toHaveLength(2);
    fireEvent.contextMenu(shapes()[1]!);
    fireEvent.click(screen.getByTestId('ask-menu-delete'));
    expect(shapes()).toHaveLength(1);
    fireEvent.click(screen.getByTestId('wb-undo'));
    expect(shapes()).toHaveLength(2);
  });

  it('Bring to front puts the mark last in the stacking order', () => {
    const idOf = (el: Element) => el.closest('[data-item-id]')?.getAttribute('data-item-id') ?? null;
    const firstId = idOf(boardWithOneBox());
    expect(firstId).not.toBeNull();
    fireEvent.click(screen.getByTestId('wb-shapes-main'));
    drag(screen.getByTestId('wb-canvas'), { x: 220, y: 20 }, { x: 320, y: 90 });
    expect(idOf(shapes().at(-1)!)).not.toBe(firstId);
    fireEvent.contextMenu(shapes()[0]!);
    fireEvent.click(screen.getByTestId('ask-menu-front'));
    expect(idOf(shapes().at(-1)!)).toBe(firstId);
  });

  it('the empty board has a menu of its own, with no repeated words', () => {
    boardWithOneBox();
    fireEvent.contextMenu(screen.getByTestId('wb-canvas'));
    const menu = screen.getByTestId('ask-menu');
    expect(labels(menu)).toEqual(['Ask agent about this board', 'Fit to drawing', 'Reset view', 'Show grid', 'Clear board']);
    expectNoDuplicateLabels(menu);
  });

  it('a board with nowhere to ask still has its menu, without an ask row', () => {
    const item = boardWithOneBox(false);
    fireEvent.contextMenu(item);
    const menu = screen.getByTestId('ask-menu');
    expect(labels(menu)).toEqual(['Duplicate', 'Bring to front', 'Copy as image', 'Delete']);
  });
});

describe('the architecture node menu (C7)', () => {
  const target = { nodeId: 'svc:orders', label: 'orders', openable: true, x: 0, y: 0 };
  it('with the in-place ask: one "Ask agent about this" and Explain, no repeated words', () => {
    render(<BoardMenu target={target} onRename={() => {}} onDelete={() => {}} onClose={() => {}} onAskHere={() => {}} onOpen={() => {}} onAnatomy={() => {}} />);
    const menu = screen.getByTestId('board-menu');
    const l = labels(menu);
    expect(l.filter((x) => x === ASK_AGENT_LABEL)).toHaveLength(1);
    expect(l.filter((x) => /ask/i.test(x))).toEqual([ASK_AGENT_LABEL]);
    expect(l).toContain('Explain');
    expectNoDuplicateLabels(menu);
  });
  it('without it: the agent run is the one ask row', () => {
    render(<BoardMenu target={target} onRename={() => {}} onDelete={() => {}} onClose={() => {}} />);
    const l = labels(screen.getByTestId('board-menu'));
    expect(l.filter((x) => /ask/i.test(x))).toEqual([ASK_AGENT_LABEL]);
    expectNoDuplicateLabels(screen.getByTestId('board-menu'));
  });
});
