import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WbItem } from '../../whiteboard/whiteboardModel';
import { ARCH_TOOLS, ArchCapture, ArchMarks, moveMarkTo } from './ArchDraw';

/* ══════════════════════════════════════════════════════════════════════════
   DRAWINGS ARE DRAGGABLE (round 9, ask 26)
   The Select tool picks a mark under the pointer and a drag moves it; the move
   is written once, on release, with the mark re-anchored to the card it was
   dropped on. Delete removes the picked mark.
   ══════════════════════════════════════════════════════════════════════════ */

/** jsdom's PointerEvent drops the MouseEvent geometry; a MouseEvent named pointerdown carries it (see drawRendered.test). */
function pointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  fireEvent(el, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

const CARD = { id: 'svc:a', x: 100, y: 100, w: 200, h: 100 };
const CARD_B = { id: 'svc:b', x: 600, y: 100, w: 200, h: 100 };

describe('moveMarkTo', () => {
  it('moves a free sticky by the drag delta', () => {
    const note: WbItem = { kind: 'text', sticky: true, id: 'n1', by: 'person', at: { x: 10, y: 20 }, text: 'x' };
    expect(moveMarkTo(note, 30, 40, [CARD])).toMatchObject({ id: 'n1', at: { x: 40, y: 60 } });
  });

  it('re-anchors an anchored mark to the card it lands on (offsets stay relative)', () => {
    const rect: WbItem = { kind: 'shape', id: 'r1', by: 'person', shape: 'rect', from: { x: 10, y: 10 }, to: { x: 60, y: 40 }, anchor: 'svc:a' };
    // absolute start (110,110); +500 on x lands inside card B (600..800)
    const moved = moveMarkTo(rect, 500, 0, [CARD, CARD_B]) as typeof rect;
    expect(moved.anchor).toBe('svc:b');
    expect(moved.from).toEqual({ x: 10, y: 10 });
    expect(moved.to).toEqual({ x: 60, y: 40 });
  });

  it('dropped on empty board an anchored mark becomes free, at absolute coordinates', () => {
    const rect: WbItem = { kind: 'shape', id: 'r1', by: 'person', shape: 'rect', from: { x: 10, y: 10 }, to: { x: 60, y: 40 }, anchor: 'svc:a' };
    const moved = moveMarkTo(rect, 0, 900, [CARD]) as typeof rect;
    expect(moved.anchor).toBeUndefined();
    expect(moved.from).toEqual({ x: 110, y: 1010 });
  });

  it('moves every point of a stroke and detaches a bound arrow from its targets', () => {
    const ink: WbItem = { kind: 'stroke', id: 'i1', by: 'person', width: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] };
    expect(moveMarkTo(ink, 10, 10, [])).toMatchObject({ points: [{ x: 10, y: 10 }, { x: 15, y: 15 }] });
    const arrow: WbItem = { kind: 'shape', id: 'a1', by: 'person', shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, fromId: 'svc:a', toId: 'svc:b' };
    const moved = moveMarkTo(arrow, 5, 5, []) as typeof arrow;
    expect(moved.fromId).toBeUndefined();
    expect(moved.toId).toBeUndefined();
    expect(moved.from).toEqual({ x: 5, y: 5 });
  });
});

describe('the Select tool', () => {
  afterEach(() => {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it('is in the palette', () => {
    expect(ARCH_TOOLS.map((t) => t.id)).toContain('select');
  });

  function setup() {
    const note: WbItem = { kind: 'text', sticky: true, id: 'note-1', by: 'person', at: { x: 50, y: 60 }, text: 'hello' };
    const onPut = vi.fn(() => Promise.resolve());
    const onRemove = vi.fn();
    render(
      <div className="board-scope">
        <ArchMarks items={[note]} boxOf={() => null} hittable />
        <ArchCapture
          tool="select"
          passive={false}
          toFlow={(p) => p}
          boxes={[]}
          items={[note]}
          onPut={onPut}
          onRemove={onRemove}
        />
      </div>,
    );
    const mark = document.querySelector('[data-annot-id="note-1"]') as HTMLElement;
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => mark;
    return { note, onPut, onRemove, mark, capture: screen.getByTestId('annot-capture') };
  }

  it('dragging a mark translates it live and writes ONE move on release', async () => {
    const { onPut, mark, capture } = setup();
    pointer(capture, 'pointerdown', 60, 70);
    pointer(capture, 'pointermove', 100, 130);
    pointer(capture, 'pointermove', 160, 170);
    expect(mark.style.translate).toBe('100px 100px');
    expect(onPut).not.toHaveBeenCalled();
    pointer(capture, 'pointerup', 160, 170);
    expect(onPut).toHaveBeenCalledTimes(1);
    const moved = (onPut.mock.calls[0] as unknown as [{ at: { x: number; y: number }; id: string }])[0];
    expect(moved).toMatchObject({ id: 'note-1', at: { x: 150, y: 160 } });
    await waitFor(() => expect(mark.style.translate).toBe(''));
  });

  it('a click without movement selects but writes nothing; Delete then removes the mark', () => {
    const { onPut, onRemove, mark, capture } = setup();
    pointer(capture, 'pointerdown', 60, 70);
    pointer(capture, 'pointerup', 60, 70);
    expect(onPut).not.toHaveBeenCalled();
    expect(mark.getAttribute('data-annot-selected')).toBe('true');
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith('note-1');
  });

  it('pressing empty board clears the selection', () => {
    const { mark, capture } = setup();
    pointer(capture, 'pointerdown', 60, 70);
    pointer(capture, 'pointerup', 60, 70);
    expect(mark.getAttribute('data-annot-selected')).toBe('true');
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => document.body;
    pointer(capture, 'pointerdown', 900, 900);
    expect(mark.hasAttribute('data-annot-selected')).toBe(false);
  });
});
