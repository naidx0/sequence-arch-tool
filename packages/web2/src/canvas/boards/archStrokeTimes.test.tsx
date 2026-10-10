import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WbItem, WbStroke } from '../../whiteboard/whiteboardModel';
import { ArchCapture, anchorTo } from './ArchDraw';
import { shiftItem } from './boardsModel';

/* The architecture board's Draw pen records the same pen times the whiteboard
   does, and moving or re-anchoring a stroke keeps them. */

function at(el: Element, type: string, x: number, y: number, timeStamp: number) {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  fireEvent(el, ev);
}

describe('stroke point times on the architecture board', () => {
  it('a pen stroke is stored with whole milliseconds since pen-down', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onPut = vi.fn();
    render(<ArchCapture tool="pen" toFlow={(p) => p} boxes={[]} items={[]} onPut={onPut} onRemove={() => undefined} />);
    const cap = screen.getByTestId('annot-capture');
    at(cap, 'pointerdown', 10, 10, 5000);
    at(cap, 'pointermove', 30, 40, 5016.7);
    at(cap, 'pointermove', 60, 20, 5033.4);
    at(cap, 'pointerup', 90, 60, 5050);
    const item = onPut.mock.calls[0]![0] as WbStroke;
    expect(item.kind).toBe('stroke');
    expect(item.points.map((p) => p.t)).toEqual([0, 17, 33]);
    vi.unstubAllGlobals();
  });

  it('shifting and anchoring keep every point time', () => {
    const s: WbItem = { kind: 'stroke', id: 'p', width: 2, points: [{ x: 5, y: 6, t: 0 }, { x: 65, y: 76, t: 40 }] };
    expect((shiftItem(s, 10, 10) as WbStroke).points.map((p) => p.t)).toEqual([0, 40]);
    expect((anchorTo(s, { id: 'n', x: 1, y: 1, w: 10, h: 10 }) as WbStroke).points.map((p) => p.t)).toEqual([0, 40]);
  });
});
