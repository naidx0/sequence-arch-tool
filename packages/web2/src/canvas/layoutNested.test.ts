import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';

import { GROUP_PAD, elkGraphFor, placeEdges, positionsFrom, sizesFrom } from './layout';
import { CARD_FLOOR } from './cardBox';
import { nestedBoxes } from './nestedBoxes';
import { presentationFor } from './kinds';
import type { BoardEdge } from './Board';
import type { BoardNode } from './NodeCard';

/* COMPOSITE BOARD LAYOUT — an expanded group is an ELK compound node; its
   members come back relative to it, and the board turns them into absolute
   boxes inside the group's frame. */

/* The real resting card (CARD_FLOOR: the two-line title row, Decision 48), so
   the laid-out frame and the board's own boxes describe the same card. */
const box = (id: string) => ({ id, x: 0, y: 0, w: 160, h: CARD_FLOOR });
const e = (id: string, source: string, target: string): BoardEdge => ({ id, source, target, proof: 'traced' });
const parentOf = { a1: 'A', a2: 'A', a3: 'A' };
const boxes = [box('A'), box('B'), box('a1'), box('a2'), box('a3'), box('C')];
const edges = [e('e1', 'a1', 'B'), e('e2', 'a1', 'a2'), e('e3', 'B', 'C')];

describe('nested layout', () => {
  it('places each edge in the lowest group holding both ends, lifted to its direct members', () => {
    const placed = placeEdges(edges, new Set(boxes.map((b) => b.id)), parentOf);
    expect(placed.get('')!.map((x) => `${x.source}->${x.target}`)).toEqual(['A->B', 'B->C']);
    expect(placed.get('A')!.map((x) => `${x.source}->${x.target}`)).toEqual(['a1->a2']);
  });

  it('makes the group a compound node and returns members relative to it', async () => {
    const graph = elkGraphFor(boxes, edges, { width: 900, height: 600 }, { parentOf });
    expect(graph.children.map((c) => c.id)).toEqual(['A', 'B', 'C']);
    const group = graph.children[0]!;
    expect(group.children!.map((c) => c.id)).toEqual(['a1', 'a2', 'a3']);

    const laid = await new ELK().layout(graph as never);
    const positions = positionsFrom(laid as never);
    const sizes = sizesFrom(laid as never);
    expect(sizes.A!.w).toBeGreaterThanOrEqual(160);
    /* Relative to the group: inside its frame, below its header. */
    for (const id of ['a1', 'a2', 'a3']) {
      expect(positions[id]!.x).toBeGreaterThanOrEqual(GROUP_PAD.side - 0.5);
      expect(positions[id]!.y).toBeGreaterThanOrEqual(GROUP_PAD.top - 0.5);
      expect(positions[id]!.x + 160).toBeLessThanOrEqual(sizes.A!.w + 0.5);
    }

    /* The board's absolute boxes put every member inside its group's frame. */
    const node = (id: string, parent?: string, group?: boolean): BoardNode => ({
      id,
      label: id,
      subtitle: null,
      present: presentationFor({ id, kind: 'service', label: id } as never),
      schemaKind: 'service',
      provenance: null,
      count: null,
      ...(parent ? { parentId: parent } : {}),
      ...(group ? { group: { shown: 3, total: 3 } } : {}),
    });
    const nodes = [node('A', undefined, true), node('B'), node('C'), node('a1', 'A'), node('a2', 'A'), node('a3', 'A')];
    const abs = nestedBoxes(nodes, positions, sizes, (_id, p) => p, 1, false, null);
    const frame = abs.find((b) => b.id === 'A')!;
    expect(frame.container).toBe(true);
    for (const m of abs.filter((b) => b.id.startsWith('a'))) {
      expect(m.x).toBeGreaterThanOrEqual(frame.x);
      expect(m.y).toBeGreaterThanOrEqual(frame.y);
      expect(m.x + m.w).toBeLessThanOrEqual(frame.x + frame.w + 0.5);
      expect(m.y + m.h).toBeLessThanOrEqual(frame.y + frame.h + 0.5);
    }
  });

  it('is a pure function of the graph: the same input lays out the same', async () => {
    const lay = async () =>
      positionsFrom((await new ELK().layout(elkGraphFor(boxes, edges, { width: 900, height: 600 }, { parentOf }) as never)) as never);
    expect(await lay()).toEqual(await lay());
  });
});
