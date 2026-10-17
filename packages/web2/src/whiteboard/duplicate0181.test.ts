import { describe, expect, it } from 'vitest';

import { whiteboardEdit, type WbItem, type WhiteboardDoc } from './whiteboardModel';

/* Review N1 on 0.1.8.1 C7: Duplicate keeps a copied connector joined to the copied ends; one copied alone stays on the originals. */
const box = (id: string, x: number): WbItem => ({ kind: 'shape', id, shape: 'rect', from: { x, y: 0 }, to: { x: x + 40, y: 30 } }) as WbItem;
const arrow = (id: string): WbItem => ({ kind: 'shape', id, shape: 'arrow', from: { x: 40, y: 15 }, to: { x: 100, y: 15 }, fromId: 'a', toId: 'b' }) as WbItem;
const doc: WhiteboardDoc = { version: 1, items: [box('a', 0), box('b', 100), arrow('c')] };
const ends = (d: WhiteboardDoc, id: string) => {
  const it = d.items.find((i) => i.id === id) as { fromId?: string; toId?: string };
  return [it.fromId, it.toId];
};

describe('wb/duplicate (review N1)', () => {
  it('a connector duplicated with both its ends joins the copies', () => {
    const next = whiteboardEdit(doc, { type: 'wb/duplicate', ids: ['a', 'b', 'c'], dx: 16, dy: 16, idFor: { a: 'a2', b: 'b2', c: 'c2' } });
    expect(ends(next, 'c2')).toEqual(['a2', 'b2']);
    expect(ends(next, 'c')).toEqual(['a', 'b']);
  });
  it('a connector duplicated alone, or with one end, keeps the ends that were not copied', () => {
    expect(ends(whiteboardEdit(doc, { type: 'wb/duplicate', ids: ['c'], dx: 16, dy: 16, idFor: { c: 'c2' } }), 'c2')).toEqual(['a', 'b']);
    expect(ends(whiteboardEdit(doc, { type: 'wb/duplicate', ids: ['a', 'c'], dx: 16, dy: 16, idFor: { a: 'a2', c: 'c2' } }), 'c2')).toEqual(['a2', 'b']);
  });
});
