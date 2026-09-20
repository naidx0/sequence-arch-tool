import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from './index.js';
import {
  buildBoardModel,
  evictForBudget,
  isDeepExpansion,
  type BoardModel,
  type PlainNode,
} from './board.js';

/**
 * Unit lock for the pure board view-model (v8 Phase B1). Everything here is a
 * hand-built ArchGraph + PlainTree so the test needs no scanner: schema has no
 * analyzer dependency, and the point is to pin the deterministic math.
 */

/**
 * A small but realistic graph: a frontend file and a backend that talks to it and
 * to a datastore, plus an intra-backend import edge.
 *   frontend/index.tsx --http--> backend/app/main.py   (cross-area)
 *   backend/app/main.py --import--> backend/app/db.py   (intra-backend)
 *   backend/app/main.py --db_access--> postgres          (cross-area)
 */
function graph(): ArchGraph {
  return {
    version: 1,
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'plainapp',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'plainapp' },
      { id: 'svc:frontend', kind: 'service', label: 'frontend', parentId: 'repo', path: 'frontend' },
      { id: 'file:frontend/index.tsx', kind: 'file', label: 'index.tsx', parentId: 'svc:frontend', path: 'frontend/index.tsx' },
      { id: 'svc:backend', kind: 'service', label: 'backend', parentId: 'repo', path: 'backend' },
      { id: 'file:backend/app/main.py', kind: 'file', label: 'main.py', parentId: 'svc:backend', path: 'backend/app/main.py' },
      { id: 'file:backend/app/db.py', kind: 'file', label: 'db.py', parentId: 'svc:backend', path: 'backend/app/db.py' },
      { id: 'ds:postgres', kind: 'datastore', label: 'postgres', parentId: 'repo', meta: { tech: 'postgres' } },
    ],
    edges: [
      {
        id: 'e:front->back', srcId: 'file:frontend/index.tsx', dstId: 'file:backend/app/main.py',
        kind: 'http', confidence: 0.9, origin: 'deterministic',
        evidence: [{ file: 'frontend/index.tsx', line: 1, snippet: 'fetch("/api")' }],
      },
      {
        id: 'e:main->db_import', srcId: 'file:backend/app/main.py', dstId: 'file:backend/app/db.py',
        kind: 'import', confidence: 1, origin: 'deterministic',
        evidence: [{ file: 'backend/app/main.py', line: 1, snippet: 'import db' }],
      },
      {
        id: 'e:main->pg', srcId: 'file:backend/app/main.py', dstId: 'ds:postgres',
        kind: 'db_access', confidence: 0.8, origin: 'deterministic',
        evidence: [{ file: 'backend/app/main.py', line: 2, snippet: 'db.query()' }],
      },
    ],
    warnings: [],
  };
}

/** A structural-style PlainTree over that graph: App → {Frontend, Backend, Data} → services → files. */
function tree(): PlainNode {
  return {
    id: 'p:repo', title: 'Plainapp', kind: 'group', sourceRefs: ['repo'],
    children: [
      {
        id: 'p:area:frontend', title: 'Frontend', kind: 'area', sourceRefs: ['svc:frontend'],
        children: [
          {
            id: 'p:svc:frontend', title: 'Frontend', kind: 'service', sourceRefs: ['svc:frontend'],
            children: [
              { id: 'p:file:frontend/index.tsx', title: 'index.tsx', kind: 'file', sourceRefs: ['file:frontend/index.tsx'], children: [] },
            ],
          },
        ],
      },
      {
        id: 'p:area:backend', title: 'Backend', kind: 'area', sourceRefs: ['svc:backend'],
        children: [
          {
            id: 'p:svc:backend', title: 'Backend service', kind: 'service', sourceRefs: ['svc:backend'],
            children: [
              { id: 'p:file:backend/app/main.py', title: 'main.py', kind: 'file', sourceRefs: ['file:backend/app/main.py'], children: [] },
              { id: 'p:file:backend/app/db.py', title: 'db.py', kind: 'file', sourceRefs: ['file:backend/app/db.py'], children: [] },
            ],
          },
        ],
      },
      {
        id: 'p:area:data', title: 'Data', kind: 'area', sourceRefs: ['ds:postgres'],
        children: [
          { id: 'p:ds:postgres', title: 'Postgres database', kind: 'data', sourceRefs: ['ds:postgres'], children: [] },
        ],
      },
    ],
  };
}

const ids = (m: BoardModel): string[] => m.nodes.map((n) => n.id);
const edgeKey = (m: BoardModel) =>
  m.edges.map((e) => `${e.src}->${e.dst}:${e.kind}${e.crossArea ? '*' : ''}`).sort();

/* ============================================================ visibility ==== */

test('board: default view shows the app root + areas, features hidden', () => {
  const m = buildBoardModel(tree(), graph(), { expanded: new Set(), direction: 'tree' });
  assert.deepStrictEqual(ids(m), ['p:repo', 'p:area:frontend', 'p:area:backend', 'p:area:data']);
  const back = m.nodes.find((n) => n.id === 'p:area:backend')!;
  assert.strictEqual(back.depth, 1);
  assert.strictEqual(back.hasChildren, true);
  assert.strictEqual(back.isExpanded, false, 'areas are collapsed by default');
  const root = m.nodes.find((n) => n.id === 'p:repo')!;
  assert.strictEqual(root.depth, 0);
  assert.strictEqual(root.isExpanded, true, 'the root is always open');
  assert.strictEqual(root.parentId, undefined);
  assert.strictEqual(back.parentId, 'p:repo');
});

test('board: expanding drills correctly (area → service → files)', () => {
  const m1 = buildBoardModel(tree(), graph(), { expanded: new Set(['p:area:backend']), direction: 'tree' });
  assert.ok(ids(m1).includes('p:svc:backend'), 'expanding Backend reveals its service');
  assert.ok(!ids(m1).includes('p:file:backend/app/main.py'), 'files stay hidden until the service expands');

  const m2 = buildBoardModel(tree(), graph(), {
    expanded: new Set(['p:area:backend', 'p:svc:backend']),
    direction: 'tree',
  });
  assert.ok(ids(m2).includes('p:file:backend/app/main.py'), 'expanding the service reveals its files');
  assert.ok(ids(m2).includes('p:file:backend/app/db.py'));
});

/* ============================================================ edge lift ===== */

test('board: edges lift to the nearest visible ancestor; self-loops dropped; cross-area marked', () => {
  // Default: everything collapsed. The front→back and main→pg edges lift to the
  // AREA cards; the intra-backend import edge is internal to Backend → dropped.
  const m = buildBoardModel(tree(), graph(), { expanded: new Set(), direction: 'tree' });
  assert.deepStrictEqual(edgeKey(m), [
    'p:area:backend->p:area:data:db_access*',
    'p:area:frontend->p:area:backend:http*',
  ]);
  for (const e of m.edges) assert.strictEqual(e.crossArea, true, 'both surviving edges cross areas');
});

test('board: an edge internal to a fully-expanded area appears and is NOT cross-area', () => {
  const m = buildBoardModel(tree(), graph(), {
    expanded: new Set(['p:area:backend', 'p:svc:backend']),
    direction: 'tree',
  });
  const imp = m.edges.find((e) => e.kind === 'import');
  assert.ok(imp, 'the intra-backend import edge now connects the two visible files');
  assert.strictEqual(imp!.src, 'p:file:backend/app/main.py');
  assert.strictEqual(imp!.dst, 'p:file:backend/app/db.py');
  assert.strictEqual(imp!.crossArea, false, 'both files live under the same area');
  // The frontend→backend http edge now lands ON the visible main.py file (still cross-area).
  const http = m.edges.find((e) => e.kind === 'http')!;
  assert.strictEqual(http.dst, 'p:file:backend/app/main.py');
  assert.strictEqual(http.crossArea, true);
});

/* ============================================================ stability ===== */

test('board: output is byte-stable across runs', () => {
  // v18 Wave 1: the web renders ONE direction — the top-to-bottom pyramid ('tree'
  // → ELK DOWN). buildBoardModel keeps the BoardDirection param for schema compat
  // and faithfully echoes whatever it is given; the app always passes 'tree'.
  const opts = { expanded: new Set(['p:area:backend']), direction: 'tree' as const };
  const a = buildBoardModel(tree(), graph(), { expanded: new Set(opts.expanded), direction: opts.direction });
  const b = buildBoardModel(tree(), graph(), { expanded: new Set(opts.expanded), direction: opts.direction });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.strictEqual(a.direction, 'tree');
});

test('board: overlays never reference a node that is not on the board', () => {
  const m = buildBoardModel(tree(), graph(), { expanded: new Set(['p:area:backend']), direction: 'tree' });
  const present = new Set(ids(m));
  for (const e of m.edges) {
    assert.ok(present.has(e.src), `edge src ${e.src} must be a visible node`);
    assert.ok(present.has(e.dst), `edge dst ${e.dst} must be a visible node`);
  }
});

/* ======================================================= deep-expansion ===== */

test('isDeepExpansion: true only when a child itself has children', () => {
  const t = tree();
  assert.strictEqual(isDeepExpansion(t), true, 'root: areas have children');
  const frontendArea = t.children[0];
  assert.strictEqual(isDeepExpansion(frontendArea), true, 'area: its service has a file child');
  const backendSvc = t.children[1].children[0];
  assert.strictEqual(isDeepExpansion(backendSvc), false, 'service: children are leaf files');
  const file = backendSvc.children[0];
  assert.strictEqual(isDeepExpansion(file), false, 'file: no children');
});

/* ============================================================== LRU budget == */

test('evictForBudget: opening past the budget evicts the least-recently-touched', () => {
  const r1 = evictForBudget([], 'a', 3);
  assert.deepStrictEqual(r1, { open: ['a'], evicted: [] });
  const r2 = evictForBudget(['a'], 'b', 3);
  const r3 = evictForBudget(['a', 'b'], 'c', 3);
  assert.deepStrictEqual(r3.open, ['a', 'b', 'c']);
  // Opening a 4th past budget 3 evicts 'a' (the oldest).
  const r4 = evictForBudget(['a', 'b', 'c'], 'd', 3);
  assert.deepStrictEqual(r4, { open: ['b', 'c', 'd'], evicted: ['a'] });
  assert.ok(r2.evicted.length === 0);
});

test('evictForBudget: re-touching an open id moves it to most-recent (not evicted next)', () => {
  // 'a' is oldest; re-touch it, then open 'd' at budget 3 → 'b' (now oldest) is evicted, not 'a'.
  const touched = evictForBudget(['a', 'b', 'c'], 'a', 3);
  assert.deepStrictEqual(touched.open, ['b', 'c', 'a'], 're-touch moves a to the back');
  assert.deepStrictEqual(touched.evicted, []);
  const opened = evictForBudget(touched.open, 'd', 3);
  assert.deepStrictEqual(opened.open, ['c', 'a', 'd']);
  assert.deepStrictEqual(opened.evicted, ['b'], 'the least-recently-touched (b) is evicted, a survives');
});

test('evictForBudget: a tighter budget evicts multiple oldest, in order; deterministic', () => {
  const r = evictForBudget(['a', 'b', 'c', 'd'], 'e', 2);
  assert.deepStrictEqual(r.open, ['d', 'e']);
  assert.deepStrictEqual(r.evicted, ['a', 'b', 'c'], 'evicted oldest-first');
  // Same inputs → same outputs.
  const again = evictForBudget(['a', 'b', 'c', 'd'], 'e', 2);
  assert.deepStrictEqual(again, r);
});
