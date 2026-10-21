import { describe, expect, it } from 'vitest';
import type { ArchGraph, SeqDiagramV1 } from '@sequence/schema';

import { BOX_BUDGET, boxesWithoutBudget, compositeDocument, evidenceFor } from './composite';
import {
  DEFAULT_VIEW_STATE,
  collapse,
  decodeId,
  encodeId,
  expandWithBudget,
  fromHash,
  isBoardHash,
  neighbourhood,
  toHash,
  tracePath,
  type BoardViewState,
} from './viewState';

describe('the view state in the URL hash', () => {
  it('writes the spec example and reads it back', () => {
    const state: BoardViewState = {
      ...DEFAULT_VIEW_STATE,
      focus: 'svc:orders',
      proximity: 1,
      expanded: ['svc:orders', 'svc:payments'],
    };
    expect(toHash(state)).toBe('#map.f-svc_orders.p1.x-svc_orders+svc_payments');
    expect(fromHash(toHash(state))).toEqual(state);
  });

  it('round-trips every field and ids with the separator characters in them', () => {
    const state: BoardViewState = {
      view: 'grid',
      expanded: ['mod:analyzer/0', 'topic:order.created', 'svc:a_b+c', 'file:x%y.ts'],
      focus: 'svc:api-types',
      proximity: 3,
      hidden: ['ds:redis'],
      showImports: true,
      dir: 'TB',
      agentOverlay: false,
      opened: ['svc:analyzer', 'mod:analyzer/0'],
    };
    expect(fromHash(toHash(state))).toEqual(state);
    for (const id of state.expanded) expect(decodeId(encodeId(id))).toBe(id);
  });

  it('the default board is the bare view, and an unknown hash opens the default', () => {
    expect(toHash(DEFAULT_VIEW_STATE)).toBe('#map');
    expect(fromHash('')).toEqual(DEFAULT_VIEW_STATE);
    expect(fromHash('#map.zz.q9')).toEqual(DEFAULT_VIEW_STATE);
    expect(isBoardHash('#map.i')).toBe(true);
    expect(isBoardHash('#settings')).toBe(false);
  });
});

/* A repository shaped like codeforge: 11 groups, each with modules, each
   module with files. Sizes vary so the budget is reached by different
   sequences. Seeded, so a failure is reproducible. */
function codeforgeLike(seed = 7) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const nodes: Array<{ id: string; kind: string; label: string; parentId?: string }> = [];
  const edges: Array<{ id: string; srcId: string; dstId: string; kind: string; confidence: number; origin: string; evidence: Array<{ file: string; line: number; snippet: string }> }> = [];
  const services = Array.from({ length: 11 }, (_, i) => `svc:s${i}`);
  for (const s of services) nodes.push({ id: s, kind: 'service', label: s });
  const files: string[] = [];
  services.forEach((s, i) => {
    const modules = 2 + Math.floor(rand() * 20);
    for (let m = 0; m < modules; m += 1) {
      const mod = `mod:s${i}/${m}`;
      nodes.push({ id: mod, kind: 'module', label: mod, parentId: s });
      const count = 1 + Math.floor(rand() * 15);
      for (let f = 0; f < count; f += 1) {
        const file = `file:s${i}/${m}/${f}.ts`;
        nodes.push({ id: file, kind: 'file', label: file, parentId: mod });
        files.push(file);
      }
    }
  });
  for (let k = 0; k < 400; k += 1) {
    const a = files[Math.floor(rand() * files.length)]!;
    const b = files[Math.floor(rand() * files.length)]!;
    edges.push({ id: `e${k}`, srcId: a, dstId: b, kind: k % 5 === 0 ? 'http' : 'import', confidence: 1, origin: 'deterministic', evidence: [{ file: a, line: k + 1, snippet: '' }] });
  }
  const graph = { version: 1, scannedAt: '', repoRoot: '', repoName: 'cf', warnings: [], nodes, edges } as unknown as ArchGraph;
  const base = {
    version: 1,
    kind: 'service-flow',
    title: 'cf',
    grounded: { graphId: 'cf' },
    nodes: services.map((id) => ({ id, label: id, kind: 'service' })),
    edges: [],
  } as unknown as SeqDiagramV1;
  return { graph, base, rand };
}

describe('the 50-box budget (§3.2)', () => {
  it('never draws more than 50 boxes after any expand sequence', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { graph, base, rand } = codeforgeLike(seed);
      const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
      const parentOf = (id: string) => parent.get(id);
      let expanded: string[] = [];
      for (let step = 0; step < 40; step += 1) {
        const doc = compositeDocument(base, graph, expanded).doc;
        const expandable = doc.nodes.filter((n) => graph.nodes.some((c) => c.parentId === n.id));
        const pick = expandable[Math.floor(rand() * expandable.length)];
        if (!pick) break;
        expanded =
          rand() < 0.15
            ? collapse(expanded, pick.id, parentOf)
            : expandWithBudget(expanded, pick.id, parentOf, (list) => boxesWithoutBudget(base, graph, list));
        expect(compositeDocument(base, graph, expanded).doc.nodes.length).toBeLessThanOrEqual(BOX_BUDGET);
      }
    }
  });

  it('collapses the least recently expanded sibling first', () => {
    const { graph, base } = codeforgeLike(3);
    const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
    const parentOf = (id: string) => parent.get(id);
    /* A budget the first three groups' modules overflow. */
    const count = (list: readonly string[]) => boxesWithoutBudget(base, graph, list);
    const budget = count(['svc:s0', 'svc:s1']) + 1;
    let list = expandWithBudget([], 'svc:s0', parentOf, count, budget);
    list = expandWithBudget(list, 'svc:s1', parentOf, count, budget);
    list = expandWithBudget(list, 'svc:s2', parentOf, count, budget);
    expect(list[0]).not.toBe('svc:s0');
    expect(list).toContain('svc:s2');
  });

  it('collapsing a group collapses what is expanded inside it', () => {
    const parentOf = (id: string) => ({ 'mod:a': 'svc:a', 'mod:b': 'svc:a' } as Record<string, string>)[id];
    expect(collapse(['svc:a', 'mod:a', 'svc:b', 'mod:b'], 'svc:a', parentOf)).toEqual(['svc:b']);
  });
});

describe('edge lifting (§3.2)', () => {
  it("a lifted line's count is the sum of the scanned edges under it, and its evidence lists each", () => {
    const { graph, base } = codeforgeLike(11);
    const c = compositeDocument(base, graph, ['svc:s0']);
    const ids = c.doc.nodes.map((n) => n.id);
    for (const edge of c.doc.edges) {
      const n = c.merged[edge.id];
      if (n === undefined) continue;
      const under = evidenceFor(graph, ids, edge.from, edge.to, false, 10_000);
      /* Per family: count the scanned edges of this kind between the pair. */
      const lifted = graph.edges.filter((g) => g.kind !== 'import').length;
      expect(lifted).toBeGreaterThan(0);
      expect(under.total).toBeGreaterThanOrEqual(n);
    }
    const total = Object.values(c.merged).reduce((a, b) => a + b, 0);
    const touching = graph.edges.filter((g) => {
      if (g.kind === 'import') return false;
      const lift = (id: string) => {
        let cur: string | undefined = id;
        while (cur && !ids.includes(cur)) cur = graph.nodes.find((x) => x.id === cur)?.parentId;
        return cur;
      };
      const a = lift(g.srcId);
      const b = lift(g.dstId);
      if (!a || !b || a === b) return false;
      const inside = (id: string) => c.parentOf[id] !== undefined || id === 'svc:s0';
      return inside(a) || inside(b);
    }).length;
    expect(total).toBe(touching);
  });
});

describe('focus and path tracing', () => {
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'cd', source: 'c', target: 'd' },
    { id: 'xd', source: 'x', target: 'd' },
  ];

  it('the neighbourhood grows one hop per proximity step', () => {
    expect([...neighbourhood('b', edges, 1)].sort()).toEqual(['a', 'b', 'c']);
    expect([...neighbourhood('b', edges, 2)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('traces the shortest directed path, and an undirected one when no directed path exists', () => {
    expect(tracePath('a', 'd', edges)).toEqual({ nodeIds: ['a', 'b', 'c', 'd'], edgeIds: ['ab', 'bc', 'cd'], directed: true });
    expect(tracePath('x', 'a', edges)?.directed).toBe(false);
    expect(tracePath('a', 'zzz', edges)).toBeNull();
  });
});
