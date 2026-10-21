import { describe, expect, it } from 'vitest';
import { openableIds } from './openableIds';

type N = { id: string; parentId?: string | null };

/** The form this replaced, kept as the oracle. */
function oldOpenable(nodes: N[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) if (nodes.some((c) => c.parentId === n.id)) ids.add(n.id);
  return ids;
}

/** A codeforge-sized tree: 2,773 nodes, services > folders > files, some orphans and dangling parents. */
function bigGraph(): N[] {
  const nodes: N[] = [];
  for (let s = 0; s < 12; s++) {
    nodes.push({ id: `svc:${s}` });
    for (let d = 0; d < 20; d++) {
      nodes.push({ id: `dir:${s}/${d}`, parentId: `svc:${s}` });
      for (let f = 0; f < 10; f++) nodes.push({ id: `file:${s}/${d}/${f}`, parentId: `dir:${s}/${d}` });
    }
  }
  nodes.push({ id: 'orphan:a', parentId: null }, { id: 'orphan:b', parentId: 'gone:x' });
  while (nodes.length < 2773) nodes.push({ id: `loose:${nodes.length}` });
  return nodes;
}

describe('openableIds', () => {
  it('equals the quadratic form on a real-scale graph', () => {
    const nodes = bigGraph();
    expect(nodes.length).toBe(2773);
    const fast = openableIds(nodes);
    expect([...fast].sort()).toEqual([...oldOpenable(nodes)].sort());
    expect(fast.size).toBe(12 + 12 * 20); // services and folders, no files, no dangling parent
  });

  it('is linear: 2,773 nodes in well under the 204 ms the quadratic form took', () => {
    const nodes = bigGraph();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) openableIds(nodes);
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });

  it('handles nothing', () => {
    expect(openableIds([]).size).toBe(0);
  });
});
