/**
 * SeqDraw unit tests — campus map demo + wire conversion.
 */
import { describe, expect, it } from 'vitest';

import {
  appendAgentItems,
  blurryBoardSummary,
  boardWireToWbItem,
  buildCampusMapDemo,
} from './seqDraw';
import { EMPTY_WHITEBOARD } from '../whiteboard/whiteboardModel';

describe('SeqDraw', () => {
  it('converts board wire items into whiteboard items', () => {
    const text = boardWireToWbItem({
      kind: 'text',
      id: 'n1',
      at: { x: 10, y: 20 },
      text: 'Hello',
    });
    expect(text).toEqual({ kind: 'text', id: 'n1', at: { x: 10, y: 20 }, text: 'Hello' });

    const shape = boardWireToWbItem({
      kind: 'shape',
      id: 's1',
      shape: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 40, y: 40 },
    });
    expect(shape.kind).toBe('shape');
  });

  it('appends agent items by id without replacing the human document', () => {
    const human = appendAgentItems(EMPTY_WHITEBOARD, [
      { kind: 'text', id: 'h1', at: { x: 0, y: 0 }, text: 'mine' },
    ]);
    const next = appendAgentItems(human, [
      { kind: 'text', id: 'h1', at: { x: 9, y: 9 }, text: 'dup' },
      { kind: 'text', id: 'a1', at: { x: 1, y: 1 }, text: 'agent' },
    ]);
    expect(next.items).toHaveLength(2);
    expect(next.items.find((i) => i.id === 'h1' && i.kind === 'text')).toMatchObject({ text: 'mine' });
    expect(next.items.some((i) => i.id === 'a1')).toBe(true);
  });

  it('builds a campus-map demo the agent style (notes, frames, arrows)', () => {
    const doc = buildCampusMapDemo();
    expect(doc.items.length).toBeGreaterThanOrEqual(8);
    expect(doc.items.some((i) => i.kind === 'shape' && i.shape === 'arrow')).toBe(true);
    expect(doc.items.some((i) => i.kind === 'text' && i.text.includes('campus'))).toBe(true);
    const blurry = blurryBoardSummary(doc);
    expect(blurry).toContain('Dorm');
    expect(blurry).toContain('Gate');
  });
});
