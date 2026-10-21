import { describe, expect, it } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';

import { docSessionReduce, EMPTY_DOC_SESSION } from './docSession';
import { isDrawnId, rebaseNote, rebaseWithDrawn } from './promoteDrawn';
import { seqdFromGraph } from './seqdFromGraph';

/* ══════════════════════════════════════════════════════════════════════════
   A DRAWN EDGE MEETS THE NEXT SCAN
   The fixture has the shopfront's shape (packages/analyzer/test/fixtures/
   shopfront/ground-truth.json): gateway -> orders is in the code,
   gateway -> postgres is not.
   ══════════════════════════════════════════════════════════════════════════ */

const ev = (file: string) => [{ file, line: 3, snippet: 's' }];

function shop(withGatewayOrders: boolean, ids: 'plain' | 'renamed' = 'plain'): GetArchGraphResponse {
  const idOf = (n: string) => (ids === 'renamed' ? `svc:${n.toUpperCase()}` : `svc:${n}`);
  return {
    repoName: 'shopfront',
    scannedAt: '2026-10-12T00:00:00.000Z',
    nodes: [
      { id: idOf('gateway'), label: 'gateway', kind: 'service', path: 'gateway/src/index.ts', line: 1 },
      { id: idOf('orders'), label: 'orders', kind: 'service', path: 'orders/src/index.ts', line: 1 },
      { id: 'ds:postgres', label: 'postgres', kind: 'datastore', path: 'docker-compose.yml', line: 1 },
    ],
    edges: withGatewayOrders
      ? [{ id: 'h1', srcId: idOf('gateway'), dstId: idOf('orders'), kind: 'http', confidence: 1, origin: 'deterministic', evidence: ev('gateway/src/orders.ts') }]
      : [],
    nodeDetail: {},
  } as unknown as GetArchGraphResponse;
}

const docOf = (g: GetArchGraphResponse) => seqdFromGraph(g, g.nodeDetail);
const ID = (doc: ReturnType<typeof docOf>, label: string) => doc.nodes.find((n) => n.label === label)!.id;

/** The first scan has no gateway -> orders edge; the reader draws it, and one to postgres. */
function drawn(first = docOf(shop(false))) {
  let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: first });
  s = docSessionReduce(s, { type: 'doc/add-edge', id: 'draw:e1', from: ID(first, 'gateway'), to: ID(first, 'orders'), family: 'call' });
  s = docSessionReduce(s, { type: 'doc/add-edge', id: 'draw:e2', from: ID(first, 'gateway'), to: ID(first, 'postgres'), family: 'call' });
  return s;
}

describe('rebaseWithDrawn', () => {
  it('a drawn edge matched by the scan becomes grounded', () => {
    const s = drawn();
    const next = docOf(shop(true));
    const out = rebaseWithDrawn(s.doc!, next);
    expect(out.promoted).toEqual(['draw:e1']);
    /* It is the SCANNED edge now: solid, with its evidence, and no dashed twin. */
    const pair = out.doc.edges.filter((e) => e.from === ID(next, 'gateway') && e.to === ID(next, 'orders'));
    expect(pair).toHaveLength(1);
    expect(pair[0]!.evidenceRef).toBeTruthy();
    expect(out.doc.edges.some((e) => e.id === 'draw:e1')).toBe(false);
  });

  it('an unmatched drawn edge is kept dashed (ungrounded)', () => {
    const out = rebaseWithDrawn(drawn().doc!, docOf(shop(true)));
    expect(out.kept).toEqual(['draw:e2']);
    const claim = out.doc.edges.find((e) => e.id === 'draw:e2')!;
    expect(claim.evidenceRef).toBeUndefined();
    expect(claim.to).toBe('ds:postgres');
  });

  it('shopfront shape: Gateway->Orders exists, Gateway->Postgres does not: 1 promoted, 1 kept', () => {
    const out = rebaseWithDrawn(drawn().doc!, docOf(shop(true)));
    expect([out.promoted.length, out.kept.length]).toEqual([1, 1]);
    expect(rebaseNote(1, 1)).toBe('1 drawn connection is now in the code; 1 is still a claim.');
  });

  it('ids that drifted between scans still match, by normalised id and then by label', () => {
    const s = drawn();
    const byId = rebaseWithDrawn(s.doc!, docOf(shop(true, 'renamed')));
    expect(byId.promoted).toEqual(['draw:e1']);
    const next = docOf(shop(true));
    const gw = ID(next, 'gateway');
    const relabelled = {
      ...next,
      nodes: next.nodes.map((n) => (n.id === gw ? { ...n, id: 'svc:edge-gw' } : n)),
      edges: next.edges.map((e) => ({ ...e, from: e.from === gw ? 'svc:edge-gw' : e.from })),
    };
    expect(rebaseWithDrawn(s.doc!, relabelled).promoted).toEqual(['draw:e1']);
  });

  it('only edges between SCANNED nodes are promoted: a drawn box keeps its edge a claim', () => {
    let s = drawn();
    s = docSessionReduce(s, { type: 'doc/add-node', id: 'draw:10-10', label: 'orders', kind: 'service' });
    s = docSessionReduce(s, { type: 'doc/add-edge', id: 'draw:e3', from: ID(docOf(shop(false)), 'gateway'), to: 'draw:10-10', family: 'call' });
    const out = rebaseWithDrawn(s.doc!, docOf(shop(true)));
    expect(out.promoted).not.toContain('draw:e3');
    expect(out.kept).toContain('draw:e3');
    /* the box it hangs on travels with it, so nothing dangles */
    expect(out.doc.nodes.some((n) => n.id === 'draw:10-10')).toBe(true);
  });

  it('an edge to a service the scan no longer has is dropped, not left dangling', () => {
    const s = drawn();
    const full = docOf(shop(true));
    const gone = { ...full, nodes: full.nodes.filter((n) => n.label !== 'postgres') };
    const out = rebaseWithDrawn(s.doc!, gone);
    expect(out.kept).toEqual([]);
    expect(out.dropped).toEqual(['draw:e2']);
    expect(rebaseNote(0, 0, 1)).toBe('1 drawn connection was removed because a service they joined is no longer in the scan.');
    const ids = new Set(out.doc.nodes.map((n) => n.id));
    expect(out.doc.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });

  it('nothing drawn: the new scan comes back untouched', () => {
    const next = docOf(shop(true));
    expect(rebaseWithDrawn(docOf(shop(false)), next).doc).toBe(next);
    expect(isDrawnId('draw:e1')).toBe(true);
    expect(isDrawnId('svc:a')).toBe(false);
  });

  it('the note counts and agrees with the numbers', () => {
    expect(rebaseNote(2, 1)).toBe('2 drawn connections are now in the code; 1 is still a claim.');
    expect(rebaseNote(0, 2)).toBe('2 drawn connections are still a claim.');
    expect(rebaseNote(1, 0)).toBe('1 drawn connection is now in the code.');
    expect(rebaseNote(0, 0)).toBeNull();
  });
});

describe('doc/rebase through the session', () => {
  it('taking the held scan promotes the matched edge and says so', () => {
    const held = docSessionReduce(drawn(), { type: 'doc/base', doc: docOf(shop(true)) });
    expect(held.baseChanged).toBe(true);
    const s = docSessionReduce(held, { type: 'doc/rebase' });
    expect(s.baseChanged).toBe(false);
    expect(s.lastNote).toBe('1 drawn connection is now in the code; 1 is still a claim.');
    expect(s.doc!.edges.find((e) => e.id === 'draw:e1')).toBeUndefined();
    expect(s.doc!.edges.find((e) => e.id === 'draw:e2')).toBeTruthy();
    /* the surviving claim is an unsaved edit, so the NEXT rescan is held too */
    expect(s.edits).toBe(1);
  });
});
