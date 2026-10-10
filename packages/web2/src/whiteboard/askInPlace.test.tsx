import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './whiteboard.css';
import * as snapshot from '../askInPlace/snapshot';
import type { AskPayload } from '../askInPlace/useAskInPlace';
import { Whiteboard } from './Whiteboard';
import type { WbItem, WhiteboardDoc } from './whiteboardModel';

/* The agentic loop the owner drew to plan with: Model, Tool call, and an arrow each way. */
const LOOP: WbItem[] = [
  { kind: 'shape', id: 'r1', shape: 'rect', from: { x: 40, y: 40 }, to: { x: 200, y: 110 }, label: 'Model' },
  { kind: 'shape', id: 'r2', shape: 'rect', from: { x: 320, y: 40 }, to: { x: 480, y: 110 }, label: 'Tool call' },
  { kind: 'shape', id: 'a1', shape: 'arrow', from: { x: 200, y: 75 }, to: { x: 320, y: 75 }, fromId: 'r1', toId: 'r2' },
  { kind: 'shape', id: 'a2', shape: 'arrow', from: { x: 320, y: 95 }, to: { x: 200, y: 95 }, fromId: 'r2', toId: 'r1', label: 'loop' },
];

/* jsdom cannot draw an svg to a canvas: the crop is stood in for, and what it was asked to crop is asserted. */
const CROP = new Blob(['png'], { type: 'image/png' });
vi.mock('../askInPlace/snapshot', async (orig) => ({
  ...(await orig<typeof import('../askInPlace/snapshot')>()),
  snapshotSvgRegion: vi.fn(async () => CROP),
}));

function memoryStore(items: WbItem[]) {
  const doc: WhiteboardDoc = { version: 1, items };
  const map = new Map<string, string>([['k', JSON.stringify(doc)]]);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function board(onAskInPlace?: (p: AskPayload) => void, items: WbItem[] = LOOP) {
  render(<Whiteboard repoRoot="r" storage={memoryStore(items)} storageKey="k" {...(onAskInPlace ? { onAskInPlace } : {})} />);
  return screen.getByTestId('whiteboard');
}

const markOf = (id: string): Element => {
  const g = document.querySelector(`[data-item-id="${id}"]`);
  if (!g) throw new Error(`no mark ${id}`);
  return g.querySelector('[data-testid="wb-item"]') ?? g;
};

/* jsdom's PointerEvent carries no clientX; a MouseEvent under the pointer name does. */
const fire = (el: Element, type: string, x: number, y: number, extra: MouseEventInit = {}) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...extra }));

/** A click on a mark: the select tool picks it. */
function pick(id: string, x: number, y: number) {
  const mark = markOf(id);
  fire(mark, 'pointerdown', x, y);
  fire(screen.getByTestId('wb-canvas'), 'pointerup', x, y);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ask in place on the whiteboard: hover', () => {
  it('shows Ask beside a selected box when the pointer is on it, and not before', () => {
    board(() => undefined);
    pick('r1', 100, 70);
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
    fire(markOf('r1'), 'pointermove', 100, 70, { buttons: 0 });
    expect(screen.getByTestId('ask-affordance').textContent).toBe('Ask');
  });

  it('is not shown over a box that is not selected', () => {
    board(() => undefined);
    pick('r1', 100, 70);
    fire(markOf('r2'), 'pointermove', 400, 70, { buttons: 0 });
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });

  it('opens the popover with a chip naming the box, and Send posts the words with the reference', async () => {
    const onAsk = vi.fn();
    /* A 1000 x 600 canvas, which jsdom does not lay out. */
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 600, x: 0, y: 0, width: 1000, height: 600, toJSON: () => ({}) });
    board(onAsk);
    pick('r1', 100, 70);
    fire(markOf('r1'), 'pointermove', 100, 70, { buttons: 0 });
    fireEvent.click(screen.getByTestId('ask-affordance'));
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('Model');
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'rename this to Planner' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
    expect(onAsk).toHaveBeenCalledTimes(1);
    const payload = onAsk.mock.calls[0]![0] as AskPayload;
    expect(payload.text).toBe('rename this to Planner');
    expect(payload.image).toBe(CROP);
    /* The crop is of the board around the mark, from the svg itself, capped in width. */
    const [svg, region] = vi.mocked(snapshot.snapshotSvgRegion).mock.calls.at(-1)!;
    expect(svg).toBe(screen.getByTestId('wb-canvas'));
    expect(region.w).toBeGreaterThanOrEqual(snapshot.SNAPSHOT_MIN);
    expect(payload.reference.surface).toBe('whiteboard');
    expect(payload.reference.targets).toEqual([
      { id: 'r1', kind: 'rect', label: 'Model', links: ['to r2 (Tool call)', 'from r2 (Tool call)'] },
    ]);
  });
});

describe('ask in place on the whiteboard: right-click', () => {
  it('on a box selects it and offers Ask about this', () => {
    board(() => undefined);
    const notPrevented = fireEvent.contextMenu(markOf('r2'), { clientX: 400, clientY: 70 });
    expect(notPrevented).toBe(false);
    expect(screen.getByTestId('ask-menu-ask').textContent).toBe('Ask about this');
    expect(document.querySelector('[data-item-id="r2"] [data-selected="true"]') ?? document.querySelector('[data-item-id="r2"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ask-menu-ask'));
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('Tool call');
  });

  it('on bare ground leaves the browser menu', () => {
    board(() => undefined);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('wb-canvas'), { clientX: 600, clientY: 400 });
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('ask-menu')).toBeNull();
  });

  it('on an arrow names what it joins', async () => {
    const onAsk = vi.fn();
    board(onAsk);
    fireEvent.contextMenu(markOf('a1'), { clientX: 260, clientY: 75 });
    fireEvent.click(screen.getByTestId('ask-menu-ask'));
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'make this a dashed line' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ask-pop-send'));
    });
    const payload = onAsk.mock.calls[0]![0] as AskPayload;
    expect(payload.reference.targets[0]).toMatchObject({ id: 'a1', kind: 'arrow', links: ['from r1 (Model)', 'to r2 (Tool call)'] });
    expect(payload.reference.block).toContain('a1 | arrow');
  });
});

describe('ask in place on the whiteboard: a marquee selection', () => {
  it('asks about every mark the Shift-marquee touched, in one chip', async () => {
    const onAsk = vi.fn();
    board(onAsk);
    const canvas = screen.getByTestId('wb-canvas');
    fire(canvas, 'pointerdown', 0, 0, { shiftKey: true });
    fire(canvas, 'pointermove', 520, 150, { shiftKey: true });
    fire(canvas, 'pointerup', 520, 150, { shiftKey: true });
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'Enter', ctrlKey: true });
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('4 items: Model, Tool call, arrow, +1 more');
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'tidy this loop' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    const payload = onAsk.mock.calls[0]![0] as AskPayload;
    expect(payload.reference.targets.map((t) => t.id).sort()).toEqual(['a1', 'a2', 'r1', 'r2']);
    expect(payload.reference.block.split('\n')[0]).toContain('whiteboard selection: 4 items');
  });
});

describe('ask in place on the whiteboard: the key', () => {
  it('/ with a mark selected opens the popover; Escape closes it and the mark stays selected', () => {
    board(() => undefined);
    pick('r1', 100, 70);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: '/' });
    expect(screen.getByTestId('ask-pop')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Escape' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
    expect(document.querySelector('[data-item-id="r1"] [data-selected="true"]')).toBeTruthy();
  });

  it('does nothing with nothing selected', () => {
    board(() => undefined);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: '/' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });
});

describe('ask in place on the whiteboard: after the send', () => {
  it('the referenced marks glow briefly', async () => {
    vi.useFakeTimers();
    board(() => undefined);
    pick('r1', 100, 70);
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: '/' });
    expect(document.querySelector('[data-item-id="r1"]')!.getAttribute('data-ask-target')).toBe('true');
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    expect(document.querySelector('[data-item-id="r1"]')!.getAttribute('data-ask-flash')).toBe('true');
    expect(document.querySelector('[data-item-id="r2"]')!.getAttribute('data-ask-flash')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector('[data-item-id="r1"]')!.getAttribute('data-ask-flash')).toBeNull();
  });
});

describe('ask in place on the whiteboard: with nowhere to send', () => {
  it('offers none of it', () => {
    board(undefined);
    pick('r1', 100, 70);
    fire(markOf('r1'), 'pointermove', 100, 70, { buttons: 0 });
    const notPrevented = fireEvent.contextMenu(markOf('r1'));
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: '/' });
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('ask-menu')).toBeNull();
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });
});
