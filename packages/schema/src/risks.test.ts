import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchEdge, EdgeKind } from './index.js';
import { computeImpact } from './impact.js';
import { computeRisks, riskFocusTarget, rankableNodeCount, MIN_BLAST, DEFAULT_TOP_N } from './risks.js';
import type { RiskNode } from './risks.js';

/**
 * System-risk advisor lock (vision.md §2 layer 3). These pin that the advisor
 * builds HONESTLY on r11: every reported blast-radius count equals the real
 * `computeImpact(...).impactedBy.length`, a clear datastore SPOF ranks first, a
 * leaf produces no risk, and a flat graph yields the empty "no SPOF" state.
 */

function edge(srcId: string, dstId: string, kind: EdgeKind = 'db_access'): ArchEdge {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    confidence: 1,
    origin: 'deterministic',
    evidence: [{ file: 'f', line: 1, snippet: 's' }],
  };
}

// Six services all read/write one shared datastore; one isolated leaf service.
//   a,b,c,d,e,f ──▶ ds:postgres      leaf: (no edges)
// So ds:postgres' blast radius = {a..f} = 6 (the classic shared-DB SPOF), and
// `leaf` (and the individual services) break nothing.
const SPOF_NODES: RiskNode[] = [
  { id: 'repo', kind: 'repo', label: 'shop' },
  { id: 'ds:postgres', kind: 'datastore', label: 'postgres' },
  { id: 'svc:a', kind: 'service', label: 'a' },
  { id: 'svc:b', kind: 'service', label: 'b' },
  { id: 'svc:c', kind: 'service', label: 'c' },
  { id: 'svc:d', kind: 'service', label: 'd' },
  { id: 'svc:e', kind: 'service', label: 'e' },
  { id: 'svc:f', kind: 'service', label: 'f' },
  { id: 'svc:leaf', kind: 'service', label: 'leaf' },
];
const SPOF_EDGES: ArchEdge[] = [
  edge('svc:a', 'ds:postgres'),
  edge('svc:b', 'ds:postgres'),
  edge('svc:c', 'ds:postgres'),
  edge('svc:d', 'ds:postgres'),
  edge('svc:e', 'ds:postgres'),
  edge('svc:f', 'ds:postgres'),
];

// Build a graph where one hub has EXACTLY `deps` dependents among `fillers`
// unrelated leaf nodes, so its blast fraction can be tuned across the severity
// thresholds (critical .5 / high .3 / moderate .15).
function hubGraph(deps: number, fillers: number): { nodes: RiskNode[]; edges: ArchEdge[] } {
  const nodes: RiskNode[] = [
    { id: 'repo', kind: 'repo', label: 'r' },
    { id: 'hub', kind: 'service', label: 'hub' },
  ];
  const edges: ArchEdge[] = [];
  for (let i = 0; i < deps; i++) {
    nodes.push({ id: `dep${i}`, kind: 'service', label: `dep${i}` });
    edges.push(edge(`dep${i}`, 'hub', 'http'));
  }
  for (let i = 0; i < fillers; i++) nodes.push({ id: `fill${i}`, kind: 'service', label: `fill${i}` });
  return { nodes, edges };
}

test('computeRisks — reports a hub whose fraction lands in [0.15, 0.3) as MODERATE', () => {
  // hub broken by 2 of 13 rankable nodes → 2/13 ≈ 0.154 → moderate (≥ 0.15).
  const { nodes, edges } = hubGraph(2, 10); // total rankable = hub + 2 deps + 10 fillers = 13
  const risks = computeRisks(edges, nodes);
  const hub = risks.find((r) => r.nodeId === 'hub');
  assert.ok(hub !== undefined);
  assert.strictEqual(hub!.blastRadius, 2);
  assert.strictEqual(hub!.blastRadius, computeImpact(edges, 'hub').impactedBy.length); // grounded
  assert.strictEqual(hub!.total, 13);
  assert.strictEqual(hub!.severity, 'moderate');
});

test('computeRisks — drops a hub just BELOW the moderate floor even though it clears MIN_BLAST', () => {
  // same 2 dependents, but 14 rankable nodes → 2/14 ≈ 0.143 < 0.15 → not a risk.
  const { nodes, edges } = hubGraph(2, 11); // total rankable = hub + 2 deps + 11 fillers = 14
  assert.ok(MIN_BLAST <= 2); // the blast floor is met…
  const risks = computeRisks(edges, nodes);
  assert.strictEqual(risks.find((r) => r.nodeId === 'hub'), undefined); // …but the fraction floor drops it
});

test('computeRisks — the shared datastore ranks first with the correct blast radius + severity', () => {
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  assert.ok(risks.length > 0);
  const top = risks[0];
  assert.strictEqual(top.nodeId, 'ds:postgres');
  assert.strictEqual(top.kind, 'datastore');
  // 6 services depend on it → blast radius 6.
  assert.strictEqual(top.blastRadius, 6);
  assert.strictEqual(top.directDependents, 6);
  // total = 8 rankable nodes (9 minus the repo root); 6/8 = 0.75 → critical.
  assert.strictEqual(top.total, 8);
  assert.ok(Math.abs(top.fraction - 0.75) < 1e-5);
  assert.strictEqual(top.severity, 'critical');
  // The datastore is called out as a shared-store SPOF, grounded in real counts.
  assert.ok(top.reason.includes('shared datastore'));
  assert.ok(top.reason.includes('6 of 8 nodes break'));
});

test('computeRisks — GROUNDING: every cited count equals the real computeImpact blast radius', () => {
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  for (const r of risks) {
    const real = computeImpact(SPOF_EDGES, r.nodeId);
    assert.strictEqual(r.blastRadius, real.impactedBy.length);
    assert.deepStrictEqual(r.impactedBy, real.impactedBy);
    assert.strictEqual(r.directDependents, real.impactedByDirect.length);
  }
});

test('computeRisks — a leaf (and the individual dependents) produce no risk', () => {
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  const ids = risks.map((r) => r.nodeId);
  // Only the shared datastore is a SPOF here; nothing depends on the services.
  assert.deepStrictEqual(ids, ['ds:postgres']);
  assert.ok(!ids.includes('svc:leaf'));
  assert.ok(!ids.includes('svc:a'));
});

test('computeRisks — the repo root is never ranked and never counted in the denominator', () => {
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  assert.strictEqual(risks.some((r) => r.kind === 'repo'), false);
  assert.strictEqual(risks[0].total, SPOF_NODES.filter((n) => n.kind !== 'repo').length);
});

test('computeRisks — ranks a deeper chain by blast radius (transitive dependents count)', () => {
  // A ▶ B ▶ C ▶ store  (+ B ▶ D). store blast {A,B,C}=3, C blast {A,B}=2.
  const nodes: RiskNode[] = [
    { id: 'store', kind: 'datastore', label: 'store' },
    { id: 'C', kind: 'service', label: 'C' },
    { id: 'B', kind: 'service', label: 'B' },
    { id: 'A', kind: 'service', label: 'A' },
    { id: 'D', kind: 'service', label: 'D' },
  ];
  const edges = [edge('A', 'B', 'http'), edge('B', 'C', 'http'), edge('C', 'store'), edge('B', 'D', 'http')];
  const risks = computeRisks(edges, nodes);
  assert.strictEqual(risks[0].nodeId, 'store');
  assert.strictEqual(risks[0].blastRadius, 3);
  // C also clears MIN_BLAST (2) and the moderate floor (2/5 = 0.4 → high).
  const c = risks.find((r) => r.nodeId === 'C');
  assert.strictEqual(c?.blastRadius, 2);
  assert.strictEqual(c?.severity, 'high');
});

test('computeRisks — caps the list at top N', () => {
  // 8 datastores + 8 services, every service depends on every datastore
  // (shared blast radius): each datastore breaks all 8 services → 8/16 = 0.5,
  // so all 8 are critical SPOFs, but only DEFAULT_TOP_N are surfaced.
  const nodes: RiskNode[] = [];
  const edges: ArchEdge[] = [];
  for (let i = 0; i < 8; i++) nodes.push({ id: `ds:${i}`, kind: 'datastore', label: `ds${i}` });
  for (let j = 0; j < 8; j++) {
    const sid = `svc:${j}`;
    nodes.push({ id: sid, kind: 'service', label: sid });
    for (let i = 0; i < 8; i++) edges.push(edge(sid, `ds:${i}`));
  }
  const risks = computeRisks(edges, nodes);
  assert.strictEqual(risks.length, DEFAULT_TOP_N);
  assert.strictEqual(risks.every((r) => r.severity === 'critical'), true);
  const risks3 = computeRisks(edges, nodes, { topN: 3 });
  assert.strictEqual(risks3.length, 3);
});

test('computeRisks — a flat graph with NO SPOF → empty risks', () => {
  // Two independent one-hop pairs: max blast radius is 1 (< MIN_BLAST) → no SPOF.
  const nodes: RiskNode[] = [
    { id: 'x', kind: 'service', label: 'x' },
    { id: 'y', kind: 'service', label: 'y' },
    { id: 'p', kind: 'service', label: 'p' },
    { id: 'q', kind: 'service', label: 'q' },
  ];
  const risks = computeRisks([edge('x', 'y', 'http'), edge('p', 'q', 'http')], nodes);
  assert.deepStrictEqual(risks, []);
});

test('computeRisks — MIN_BLAST is the SPOF floor: a single-dependent node is not a risk', () => {
  const nodes: RiskNode[] = [
    { id: 'only', kind: 'datastore', label: 'only' },
    { id: 'one', kind: 'service', label: 'one' },
  ];
  // one ▶ only: only's blast radius is exactly 1 → below MIN_BLAST.
  assert.strictEqual(MIN_BLAST, 2);
  assert.deepStrictEqual(computeRisks([edge('one', 'only')], nodes), []);
});

test('computeRisks — empty graph → empty, never throws', () => {
  assert.deepStrictEqual(computeRisks([], []), []);
});

test('computeRisks — single node → empty (nothing can depend on it), never throws', () => {
  assert.deepStrictEqual(computeRisks([], [{ id: 'solo', kind: 'service', label: 'solo' }]), []);
});

test('rankableNodeCount — equals computeRisks(...)[0].total — the SAME repo-excluded universe the reasons cite', () => {
  // The RisksPanel prints "N nodes analyzed" from this count; each risk's reason
  // prints "K of TOTAL nodes break" from `risk.total`. They MUST be the same
  // number, or the panel disagrees with its own list by 1 (the repo root).
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  assert.strictEqual(rankableNodeCount(SPOF_NODES), risks[0].total);
  // And explicitly: it is the non-repo node count, NOT the full node count.
  assert.strictEqual(rankableNodeCount(SPOF_NODES), SPOF_NODES.length - 1); // one repo root dropped
  assert.notStrictEqual(rankableNodeCount(SPOF_NODES), SPOF_NODES.length);
});

test('rankableNodeCount — drops the repo root + dedupes ids + tolerates junk elements (total)', () => {
  const nodes = [
    { id: 'repo', kind: 'repo' as const },
    { id: 'svc:a', kind: 'service' as const },
    { id: 'svc:a', kind: 'service' as const }, // dup id
    null as unknown as { id: string; kind: 'service' },
    { id: 123 as unknown as string, kind: 'service' as const }, // non-string id
  ];
  assert.strictEqual(rankableNodeCount(nodes), 1); // only the single unique non-repo svc:a
});

test('riskFocusTarget — maps a risk to the node id that drives the r11 blast-radius highlight', () => {
  const risks = computeRisks(SPOF_EDGES, SPOF_NODES);
  assert.strictEqual(riskFocusTarget(risks[0]), 'ds:postgres');
  // The selected id, fed back through computeImpact, lights up exactly the
  // dependents the risk cited (no duplicated overlay — the same r11 path).
  const impact = computeImpact(SPOF_EDGES, riskFocusTarget(risks[0]));
  assert.deepStrictEqual(impact.impactedBy, risks[0].impactedBy);
});

// ---------------------------------------------------------------------------
// r11/r12 PERF REWORK — equivalence + characterization locks.
//
// `computeRisks` used to call `computeImpact` once per rankable node, and
// `computeImpact` rebuilt the full adjacency from `links` on EVERY call, making
// the whole thing O(N·(N+E)). Measured against the built dist on synthetic
// graphs: 1,141 nodes / 4,585 edges took 1,870 ms and 11,501 nodes / 46,x00
// edges did not finish in 30+ minutes — and real user repos are thousands of
// nodes (this repo self-scans to only 115, which is why nobody noticed).
//
// It now scans the links once and derives every node's blast radius from a
// single SCC-condensation + bitset-propagation pass. The tests below are the
// anti-regression that matters: they pin the NEW result to a NAIVE, fully
// self-contained reference implementation of the OLD algorithm, deep-equal
// including ordering and the raw (unrounded) `fraction` values.
// ---------------------------------------------------------------------------

/**
 * The OLD algorithm, written out from scratch (it deliberately does NOT call
 * `computeImpact`, so a shared-helper regression in impact.ts cannot make both
 * sides wrong in the same way): rebuild adjacency per node, DFS the reverse
 * edges, rank, slice.
 */
function naiveComputeRisks(
  links: Iterable<{ srcId: string; dstId: string }>,
  nodes: Iterable<RiskNode>,
  opts?: { topN?: number }
) {
  const topN = opts?.topN ?? DEFAULT_TOP_N;
  const ranked = new Map<string, RiskNode>();
  for (const n of nodes) {
    if (!n || n.kind === 'repo' || typeof n.id !== 'string') continue;
    if (!ranked.has(n.id)) ranked.set(n.id, n);
  }
  const total = ranked.size;
  if (total === 0) return [];
  const linkList = [...links];

  const naiveImpactedBy = (nodeId: string) => {
    // Rebuilt from the raw link list on every single call — the old cost model.
    const inn = new Map<string, Set<string>>();
    for (const e of linkList) {
      if (!e) continue;
      const { srcId: s, dstId: d } = e;
      if (typeof s !== 'string' || typeof d !== 'string') continue;
      if (s === d) continue;
      if (!inn.has(d)) inn.set(d, new Set());
      inn.get(d)!.add(s);
    }
    const seen = new Set<string>();
    const stack = [...(inn.get(nodeId) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === nodeId || seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of inn.get(cur) ?? []) if (nxt !== nodeId && !seen.has(nxt)) stack.push(nxt);
    }
    return { all: [...seen].sort(), direct: [...(inn.get(nodeId) ?? [])].sort() };
  };

  const risks = [] as ReturnType<typeof computeRisks>;
  for (const node of ranked.values()) {
    const { all, direct } = naiveImpactedBy(node.id);
    const blastRadius = all.length;
    if (blastRadius < MIN_BLAST) continue;
    const fraction = blastRadius / total;
    const severity =
      fraction >= 0.5 ? 'critical' : fraction >= 0.3 ? 'high' : fraction >= 0.15 ? 'moderate' : undefined;
    if (!severity) continue;
    const noun =
      node.kind === 'datastore'
        ? 'shared datastore — single point of failure'
        : 'single point of failure';
    risks.push({
      nodeId: node.id,
      label: node.label,
      kind: node.kind,
      blastRadius,
      impactedBy: all,
      directDependents: direct.length,
      total,
      fraction,
      severity,
      reason: `${noun}: ${blastRadius} of ${total} ${blastRadius === 1 ? 'node' : 'nodes'} break if it fails`,
    });
  }
  risks.sort(
    (a, b) => b.blastRadius - a.blastRadius || b.fraction - a.fraction || a.nodeId.localeCompare(b.nodeId)
  );
  return risks.slice(0, topN);
}

type EqCase = { name: string; links: { srcId: string; dstId: string }[]; nodes: RiskNode[] };

function svc(id: string, kind: RiskNode['kind'] = 'service'): RiskNode {
  return { id, kind, label: id };
}

const EQUIVALENCE_CASES: EqCase[] = [
  { name: 'empty graph (no nodes, no links)', links: [], nodes: [] },
  { name: 'nodes but no links (flat / no SPOF)', links: [], nodes: ['a', 'b', 'c'].map((i) => svc(i)) },
  {
    name: 'links but no rankable nodes (repo root only)',
    links: [{ srcId: 'a', dstId: 'b' }],
    nodes: [{ id: 'repo', kind: 'repo', label: 'repo' }],
  },
  { name: 'the shipped SPOF fixture', links: SPOF_EDGES, nodes: SPOF_NODES },
  {
    // a→b→c→a is one SCC; d and e hang off it. Every cycle member must exclude
    // ITSELF from its own blast radius even though the cycle reaches it.
    name: 'cyclic graph (3-cycle + tails)',
    links: [
      { srcId: 'a', dstId: 'b' },
      { srcId: 'b', dstId: 'c' },
      { srcId: 'c', dstId: 'a' },
      { srcId: 'd', dstId: 'a' },
      { srcId: 'e', dstId: 'd' },
      { srcId: 'b', dstId: 'e' },
    ],
    nodes: ['a', 'b', 'c', 'd', 'e'].map((i) => svc(i)),
  },
  {
    name: 'disconnected graph (two islands + an orphan)',
    links: [
      { srcId: 'a1', dstId: 'a2' },
      { srcId: 'a3', dstId: 'a2' },
      { srcId: 'a4', dstId: 'a3' },
      { srcId: 'b1', dstId: 'b2' },
      { srcId: 'b3', dstId: 'b2' },
    ],
    nodes: ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'orphan'].map((i) => svc(i)),
  },
  {
    name: 'duplicate edges + self-loops + a self-loop-only node',
    links: [
      { srcId: 'a', dstId: 'db' },
      { srcId: 'a', dstId: 'db' }, // exact duplicate
      { srcId: 'b', dstId: 'db' },
      { srcId: 'c', dstId: 'db' },
      { srcId: 'db', dstId: 'db' }, // self-loop: never in its own blast radius
      { srcId: 'a', dstId: 'a' },
      { srcId: 'lonely', dstId: 'lonely' }, // endpoint that has no real adjacency
    ],
    nodes: [svc('db', 'datastore'), svc('a'), svc('b'), svc('c'), svc('lonely')],
  },
  {
    // Every node depends on the one below it: blast radii are 0,1,2,…,n-1, which
    // walks the whole severity ladder and every MIN_BLAST/threshold boundary.
    name: 'deep chain (walks every severity threshold + the topN cut)',
    links: Array.from({ length: 19 }, (_, i) => ({ srcId: `n${i}`, dstId: `n${i + 1}` })),
    nodes: Array.from({ length: 20 }, (_, i) => svc(`n${i}`)),
  },
  {
    // Two hubs with IDENTICAL blast radii ⇒ pins the id tie-break ordering.
    name: 'tied blast radii (locks the localeCompare tie-break)',
    links: [
      { srcId: 'x', dstId: 'hubB' },
      { srcId: 'y', dstId: 'hubB' },
      { srcId: 'z', dstId: 'hubB' },
      { srcId: 'x', dstId: 'hubA' },
      { srcId: 'y', dstId: 'hubA' },
      { srcId: 'z', dstId: 'hubA' },
    ],
    nodes: ['hubA', 'hubB', 'x', 'y', 'z'].map((i) => svc(i)),
  },
  {
    name: 'links referencing ids that are not rankable nodes',
    links: [
      { srcId: 'ghost1', dstId: 'db' },
      { srcId: 'ghost2', dstId: 'db' },
      { srcId: 'ghost3', dstId: 'db' },
      { srcId: 'known', dstId: 'db' },
    ],
    nodes: [svc('db', 'datastore'), svc('known')],
  },
];

test('computeRisks — identical to the naive per-node reference on every graph shape', () => {
  for (const c of EQUIVALENCE_CASES) {
    assert.deepStrictEqual(
      computeRisks(c.links, c.nodes),
      naiveComputeRisks(c.links, c.nodes),
      `mismatch on: ${c.name}`
    );
    // And at non-default topN, so the cut is not accidentally load-bearing.
    for (const topN of [1, 3, 1000]) {
      assert.deepStrictEqual(
        computeRisks(c.links, c.nodes, { topN }),
        naiveComputeRisks(c.links, c.nodes, { topN }),
        `mismatch on: ${c.name} @ topN=${topN}`
      );
    }
  }
});

test('computeRisks — identical to the naive reference on the REAL archgraph.json', async () => {
  const { readFileSync } = await import('node:fs');
  /*
   * A PINNED REAL SCAN, NOT A MACHINE ARTIFACT. This test used to read the
   * repo root's archgraph.json — a scan by-product that exists only on a
   * machine that happens to have run the app, so the schema gate was red on
   * a fresh checkout (measured 2026-08-29). The fixture is a full scan of
   * this monorepo (1,233 nodes, 1,725 edges), checked in, with the machine
   * path scrubbed. Refresh it from a running app's /archgraph.json when the
   * scanner's output shape changes.
   */
  // dist/risks.test.js → ../test/fixtures = packages/schema/test/fixtures.
  const raw = readFileSync(new URL('../test/fixtures/archgraph.real.json', import.meta.url), 'utf8');
  const graph = JSON.parse(raw) as { nodes: RiskNode[]; edges: { srcId: string; dstId: string }[] };
  assert.ok(graph.nodes.length > 50, 'archgraph fixture should be a real scan, not a stub');
  assert.deepStrictEqual(computeRisks(graph.edges, graph.nodes), naiveComputeRisks(graph.edges, graph.nodes));
  assert.deepStrictEqual(
    computeRisks(graph.edges, graph.nodes, { topN: 100 }),
    naiveComputeRisks(graph.edges, graph.nodes, { topN: 100 })
  );
});

/** Deterministic pseudo-random graph generator (no dependence on Math.random). */
function synthGraph(nNodes: number, fanout: number, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const nodes: RiskNode[] = [{ id: 'repo', kind: 'repo', label: 'repo' }];
  for (let i = 0; i < nNodes; i++) nodes.push(svc(`n${i}`, i % 11 === 0 ? 'datastore' : 'service'));
  const links: { srcId: string; dstId: string }[] = [];
  for (let i = 0; i < nNodes; i++) {
    for (let k = 0; k < fanout; k++) {
      const j = Math.floor(rnd() * nNodes);
      if (j === i) continue;
      // Mostly layered (low index depends on high) so blast radii are large.
      links.push({ srcId: `n${Math.min(i, j)}`, dstId: `n${Math.max(i, j)}` });
    }
  }
  // A sprinkling of back-edges ⇒ real SCCs, not a pure DAG.
  for (let i = 0; i < nNodes / 50; i++) {
    const a = Math.floor(rnd() * nNodes);
    const b = Math.floor(rnd() * nNodes);
    if (a !== b) links.push({ srcId: `n${Math.max(a, b)}`, dstId: `n${Math.min(a, b)}` });
  }
  return { nodes, links };
}

test('computeRisks — identical to the naive reference on a large synthetic graph (cycles + dupes)', () => {
  // Big enough to exercise the SCC condensation and multi-word bitsets, small
  // enough that the quadratic reference still finishes quickly.
  const { nodes, links } = synthGraph(400, 4);
  assert.deepStrictEqual(computeRisks(links, nodes), naiveComputeRisks(links, nodes));
  assert.deepStrictEqual(
    computeRisks(links, nodes, { topN: 50 }),
    naiveComputeRisks(links, nodes, { topN: 50 })
  );
});

test('computeRisks — stays fast at 2,000 nodes (guards the quadratic regression)', () => {
  // MEASURED (node --test on the built dist, this machine):
  //   old per-node computeImpact loop : 1,141 nodes →     1,870 ms
  //                                     2,000 nodes →     6,083 ms
  //                                    11,501 nodes →   393,701 ms  (6.6 minutes)
  //   new single SCC+bitset pass      : 1,141 nodes →        28 ms
  //                                     2,000 nodes →        19 ms
  //                                    11,501 nodes →       198 ms  (~2,000x)
  //                                   100,000 nodes →     7,022 ms  (was hours)
  // Both implementations return byte-identical results at every size (locked by
  // the equivalence tests above).
  // The 500 ms bar is ~30x the new cost (generous for a slow/loaded CI box) and
  // ~10x under the old cost, so it can only trip on a real algorithmic regression.
  const { nodes, links } = synthGraph(2000, 4);
  const t0 = performance.now();
  const risks = computeRisks(links, nodes);
  const elapsed = performance.now() - t0;
  assert.ok(risks.length > 0, 'the synthetic graph should surface real SPOFs');
  assert.ok(risks[0].blastRadius > 100, 'and they should be genuine large-blast hubs');
  assert.ok(elapsed < 500, `computeRisks on 2,000 nodes took ${elapsed.toFixed(0)}ms (budget 500ms)`);
});
