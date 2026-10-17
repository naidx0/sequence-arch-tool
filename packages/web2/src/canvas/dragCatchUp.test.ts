import { describe, expect, it } from 'vitest';

import { NODE_DRAG_THRESHOLD, dragCatchUp } from './boardKeys';

describe('a dragged card stays under the pointer', () => {
  it('owes the distance the pointer had travelled when the renderer started the drag, in flow units', () => {
    expect(dragCatchUp({ x: 100, y: 100 }, { x: 105, y: 102 }, 1)).toEqual({ x: 5, y: 2 });
    /* At half zoom the same screen distance is twice the flow distance. */
    expect(dragCatchUp({ x: 100, y: 100 }, { x: 105, y: 102 }, 0.5)).toEqual({ x: 10, y: 4 });
  });
  it('is at least the threshold on the axis that crossed it, and zero with no press or a bad zoom', () => {
    const c = dragCatchUp({ x: 0, y: 0 }, { x: NODE_DRAG_THRESHOLD + 1, y: 0 }, 1);
    expect(c.x).toBeGreaterThan(NODE_DRAG_THRESHOLD);
    expect(dragCatchUp(null, { x: 9, y: 9 }, 1)).toEqual({ x: 0, y: 0 });
    expect(dragCatchUp({ x: 0, y: 0 }, { x: 9, y: 9 }, 0)).toEqual({ x: 0, y: 0 });
  });
});
