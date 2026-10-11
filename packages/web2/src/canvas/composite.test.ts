import { describe, expect, it } from 'vitest';
import type { ArchGraph, SeqDiagramV1 } from '@sequence/schema';

import { BOX_BUDGET, compositeDocument, evidenceFor, importEdges } from './composite';

const node = (id: string, kind: string, parentId?: string) => ({ id, kind, label: id, ...(parentId ? { parentId } : {}) });
const edge = (id: string, srcId: string, dstId: string, kind: string, file = 'a.ts', line = 1) => ({
  id,
  srcId,
  dstId,
  kind,
  confidence: 1,
  origin: 'deterministic',
  evidence: [{ file, line, snippet: '' }],
});

/* orders (modules api, db; files under each) calls payments; db module writes postgres. */
function graph(): ArchGraph {
  return {
    version: 1,
    scannedAt: '',
    repoRoot: '',
    repoName: 't',
    warnings: [],
    nodes: [
      node('svc:orders', 'service'),
      node('svc:payments', 'service'),
      node('ds:pg', 'datastore'),
      node('mod:api', 'module', 'svc:orders'),
      node('mod:db', 'module', 'svc:orders'),
      node('f:api.ts', 'file', 'mod:api'),
      node('f:db.ts', 'file', 'mod:db'),
      node('f:pay.ts', 'file', 'svc:payments'),
    ],
    edges: [
      edge('e1', 'f:api.ts', 'svc:payments', 'http', 'orders/api.ts', 12),
      edge('e2', 'f:db.ts', 'ds:pg', 'db_write', 'orders/db.ts', 22),
      edge('i1', 'f:api.ts', 'f:pay.ts', 'import', 'orders/api.ts', 1),
      edge('i2', 'f:api.ts', 'f:pay.ts', 'import', 'orders/api.ts', 2),
      edge('i3', 'f:api.ts', 'f:pay.ts', 'import', 'orders/api.ts', 3),
      edge('i4', 'f:api.ts', 'f:db.ts', 'import', 'orders/api.ts', 4),
    ],
  } as unknown as ArchGraph;
}

const base: SeqDiagramV1 = {
  version: 1,
  kind: 'service-flow' as SeqDiagramV1['kind'],
  title: 't',
  grounded: { graphId: 't' } as SeqDiagramV1['grounded'],
  nodes: [
    { id: 'svc:orders', label: 'orders', kind: 'service' },
    { id: 'svc:payments', label: 'payments', kind: 'service' },
    { id: 'ds:pg', label: 'pg', kind: 'datastore' },
  ],
  edges: [
    { id: 'b1', from: 'svc:orders', to: 'svc:payments', family: 'http' },
    { id: 'b2', from: 'svc:orders', to: 'ds:pg', family: 'db' },
  ],
};

describe('the composite board', () => {
  it('draws the document unchanged when nothing is expanded', () => {
    expect(compositeDocument(base, graph(), []).doc).toBe(base);
  });

  it('draws an expanded group\'s members inside it and lifts each edge to the member that holds it', () => {
    const c = compositeDocument(base, graph(), ['svc:orders']);
    expect(c.parentOf).toEqual({ 'mod:api': 'svc:orders', 'mod:db': 'svc:orders' });
    expect(c.groups).toEqual([{ id: 'svc:orders', memberIds: ['mod:api', 'mod:db'], total: 2, tests: 0 }]);
    const pairs = c.doc.edges.map((e) => `${e.from}->${e.to}:${e.family}`).sort();
    expect(pairs).toEqual(['mod:api->svc:payments:http', 'mod:db->ds:pg:db']);
    /* The lifted line keeps the file:line it came from. */
    expect(c.doc.edges.find((e) => e.from === 'mod:api')?.evidenceRef).toBe('scan:orders/api.ts:12');
  });

  it('nests one level further when a member is expanded too', () => {
    const c = compositeDocument(base, graph(), ['svc:orders', 'mod:api']);
    expect(c.parentOf['f:api.ts']).toBe('mod:api');
    expect(c.doc.edges.some((e) => e.from === 'f:api.ts' && e.to === 'svc:payments')).toBe(true);
  });

  it('never draws more than the budget, and says how many it left out', () => {
    const g = graph();
    for (let i = 0; i < 80; i += 1) (g.nodes as unknown[]).push(node(`mod:m${i}`, 'module', 'svc:payments'));
    const c = compositeDocument(base, g, ['svc:payments']);
    expect(c.doc.nodes.length).toBeLessThanOrEqual(BOX_BUDGET);
    const group = c.groups[0]!;
    expect(group.total).toBe(80);
    expect(group.memberIds.length).toBe(BOX_BUDGET - base.nodes.length);
  });
});

describe('imports, counted and lifted to what is drawn', () => {
  it('counts imports between drawn groups and drops pairs under the floor', () => {
    const lifted = importEdges(graph(), ['svc:orders', 'svc:payments', 'ds:pg']);
    expect(lifted.map((d) => `${d.source}->${d.target} ${d.label}`)).toEqual(['svc:orders->svc:payments 3 imports']);
  });

  it('never draws a member importing its own group', () => {
    const c = compositeDocument(base, graph(), ['svc:orders']);
    const ids = c.doc.nodes.map((n) => n.id);
    const lifted = importEdges(graph(), ids, c.parentOf, 1);
    expect(lifted.map((d) => `${d.source}->${d.target}`).sort()).toEqual(['mod:api->mod:db', 'mod:api->svc:payments']);
  });

  it('lists the file:line evidence under a drawn line', () => {
    const ev = evidenceFor(graph(), ['svc:orders', 'svc:payments', 'ds:pg'], 'svc:orders', 'svc:payments', true);
    expect(ev.total).toBe(3);
    expect(ev.evidence.map((e) => `${e.file}:${e.line}`)).toEqual(['orders/api.ts:1', 'orders/api.ts:2', 'orders/api.ts:3']);
  });
});
