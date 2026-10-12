import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { mermaidSequence, projectEdges } from './index.js';

/**
 * Locks for HANDOFF §8.4 (owner: "really bad right now, but it's on the right
 * track") — participant naming, real call-depth ordering, an honestly-counted
 * volume cap, delimiter escaping, self-calls, cycles, and the empty graph.
 * Matches the `graph()` fixture-builder style already used by index.test.ts /
 * scope.test.ts in this package.
 */
function graph(nodes: Partial<ArchNode>[], edges: Partial<ArchEdge>[], mode?: 'scan' | 'design'): ArchGraph {
  return {
    version: 1,
    ...(mode ? { mode } : {}),
    scannedAt: '',
    repoRoot: '',
    repoName: 'x',
    nodes: nodes as ArchNode[],
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      srcId: e.srcId!,
      dstId: e.dstId!,
      kind: e.kind!,
      confidence: e.confidence ?? 1,
      origin: e.origin ?? 'design',
      evidence: e.evidence ?? [],
      detail: e.detail,
    })) as ArchEdge[],
    warnings: [],
  };
}

/**
 * Structural validator — not a full Mermaid grammar, but the invariants the
 * task calls out explicitly: a `sequenceDiagram` header, every actor a
 * message references was declared with a `participant` line, and no raw `;`
 * (Mermaid's statement terminator) survives inside any label/alias to split
 * one statement into a dangling second one.
 */
function assertStructurallyValidSequence(seq: string, label: string): void {
  assert.match(seq, /^sequenceDiagram\n/, `${label}: starts with sequenceDiagram`);
  const lines = seq.split('\n').filter(Boolean);
  const declared = new Set<string>();
  for (const line of lines) {
    const m = /^ {4}participant (\S+)/.exec(line);
    if (m) declared.add(m[1]);
  }
  let sawMessage = false;
  for (const line of lines) {
    const m = /^ {4}(\S+)->>(\S+):/.exec(line);
    if (!m) continue;
    sawMessage = true;
    assert.ok(declared.has(m[1]), `${label}: src actor '${m[1]}' undeclared in: ${line}`);
    assert.ok(declared.has(m[2]), `${label}: dst actor '${m[2]}' undeclared in: ${line}`);
  }
  for (const line of lines) {
    if (line.trim().startsWith('%%')) continue;
    assert.ok(!line.includes(';'), `${label}: raw ';' would terminate the statement in: ${line}`);
  }
  if (declared.size > 0) assert.ok(sawMessage || lines.some((l) => /->>/.test(l)), `${label}: has content`);
}

// ---- fixtures --------------------------------------------------------------

// z is the true entry (nothing calls it); a is alphabetically first but is
// TWO hops downstream. A scan-order or alphabetical diagram would put a's
// arrow first; a real story puts z's arrow first.
const depthGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:z', kind: 'service', label: 'z', parentId: 'repo' },
    { id: 'svc:m', kind: 'service', label: 'm', parentId: 'repo' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
  ],
  [
    { srcId: 'svc:z', dstId: 'svc:m', kind: 'http', detail: { method: 'GET', pathPattern: '/m' } },
    { srcId: 'svc:m', dstId: 'svc:a', kind: 'http', detail: { method: 'GET', pathPattern: '/a' } },
  ],
  'design'
);

// order.created / order-created both tokenize to `order_created`.
const collisionGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:gw', kind: 'service', label: 'gateway', parentId: 'repo' },
    { id: 'svc:a', kind: 'service', label: 'order.created', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'order-created', parentId: 'repo' },
  ],
  [
    { srcId: 'svc:gw', dstId: 'svc:a', kind: 'http', detail: { method: 'GET', pathPattern: '/a' } },
    { srcId: 'svc:gw', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/b' } },
  ],
  'design'
);

// a1.ts calling a2.ts within the SAME service `a` is a real self-call once
// lifted; `a` also calls a separate service `b` so the fixture exercises both
// a self-message and a normal cross-service one together.
const selfCallGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'file:a1', kind: 'file', label: 'a1.ts', parentId: 'svc:a' },
    { id: 'file:a2', kind: 'file', label: 'a2.ts', parentId: 'svc:a' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  ],
  [
    { srcId: 'file:a1', dstId: 'file:a2', kind: 'http', detail: { method: 'POST', pathPattern: '/internal/retry' } },
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/things' } },
  ]
);

// a real cycle: a calls b, b calls a.
const cycleGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b', parentId: 'repo' },
  ],
  [
    { srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/b' } },
    { srcId: 'svc:b', dstId: 'svc:a', kind: 'http', detail: { method: 'GET', pathPattern: '/a' } },
  ],
  'design'
);

const escapingGraph = graph(
  [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:a', kind: 'service', label: 'a', parentId: 'repo' },
    { id: 'svc:b', kind: 'service', label: 'b;drop', parentId: 'repo' },
  ],
  [{ srcId: 'svc:a', dstId: 'svc:b', kind: 'http', detail: { method: 'GET', pathPattern: '/x;y' } }],
  'design'
);

function fanOutGraph(n: number): ArchGraph {
  const nodes: Partial<ArchNode>[] = [
    { id: 'repo', kind: 'repo', label: 'x' },
    { id: 'svc:entry', kind: 'service', label: 'entry', parentId: 'repo' },
  ];
  const edges: Partial<ArchEdge>[] = [];
  for (let i = 0; i < n; i++) {
    const id = `svc:s${i}`;
    nodes.push({ id, kind: 'service', label: `s${i}`, parentId: 'repo' });
    edges.push({ srcId: 'svc:entry', dstId: id, kind: 'http', detail: { method: 'GET', pathPattern: `/s${i}` } });
  }
  return graph(nodes, edges, 'design');
}

const emptyGraph = graph([{ id: 'repo', kind: 'repo', label: 'x' }], [], 'design');

// ---- tests ------------------------------------------------------------------

test('depth ordering: participants and messages read as a story from the entry point, not alpha/scan order', () => {
  const seq = mermaidSequence(depthGraph);
  const lines = seq.split('\n');
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const zDecl = idx(/^ {4}participant z$/);
  const mDecl = idx(/^ {4}participant m$/);
  const aDecl = idx(/^ {4}participant a$/);
  assert.ok(zDecl >= 0 && mDecl >= 0 && aDecl >= 0, 'all three participants declared');
  assert.ok(zDecl < mDecl && mDecl < aDecl, 'declared in call-depth order (z, then m, then a), not alphabetical (a, m, z)');
  const zm = idx(/^ {4}z->>m:/);
  const ma = idx(/^ {4}m->>a:/);
  assert.ok(zm >= 0 && ma >= 0 && zm < ma, 'z calls m before m calls a, matching the real chain');
});

test('participant aliasing: two labels colliding on the same Mermaid token stay distinct actors', () => {
  const seq = mermaidSequence(collisionGraph);
  assert.match(seq, /participant order_created as order-created/, 'first occurrence keeps the plain token');
  assert.match(seq, /participant order_created_2 as order\.created/, 'collision gets a deterministic suffix');
  // arrows still route to the CORRECT participant, not whichever collided token "won"
  assert.match(seq, /gateway->>order_created: GET \/b/);
  assert.match(seq, /gateway->>order_created_2: GET \/a/);
});

test('self-calls render as a Mermaid self-message instead of being silently dropped', () => {
  const seq = mermaidSequence(selfCallGraph);
  assert.match(seq, /a->>a: POST \/internal\/retry/, 'a real self-call renders');
  assert.match(seq, /a->>b: GET \/things/, 'the ordinary cross-service call still renders too');
  // the shared projection used by the flow/matrix exports still drops the
  // self-loop as noise — this addition is scoped to the sequence diagram only
  assert.ok(!projectEdges(selfCallGraph).some((e) => e.src === e.dst), 'flow/matrix projection unaffected');
});

test('a cycle renders both arrows and terminates instead of breaking the layout', () => {
  const seq = mermaidSequence(cycleGraph);
  assert.match(seq, /a->>b: GET \/b/);
  assert.match(seq, /b->>a: GET \/a/);
  assert.strictEqual(seq.split('\n').filter((l) => /->>/.test(l)).length, 2, 'both edges of the cycle appear exactly once');
});

test('escaping: a semicolon in a label cannot terminate the Mermaid statement early', () => {
  const seq = mermaidSequence(escapingGraph);
  assert.ok(!seq.includes(';'), 'no raw semicolon survives into the document');
  assert.match(seq, /participant b_drop as b,drop/);
  assert.match(seq, /a->>b_drop: GET \/x,y/);
});

test('volume cap: a large fan-out is capped and the cap is counted honestly, never silently dropped', () => {
  const g = fanOutGraph(45);
  const seq = mermaidSequence(g);
  const messageLines = seq.split('\n').filter((l) => /->>/.test(l));
  assert.strictEqual(messageLines.length, 40, 'capped to the 40-message limit');
  assert.match(seq, /^sequenceDiagram\n {4}%% 40 of 45 calls shown — closest to entry: entry\n/, 'the cap states shown/total and the entry point, not a silent truncation');
  // every declared participant is referenced by a shown message — capping
  // never leaves a dangling swimlane for a message that got cut
  const declared = [...seq.matchAll(/^ {4}participant (\S+)/gm)].map((m) => m[1]);
  assert.ok(declared.length > 0);
  for (const token of declared) {
    assert.ok(seq.includes(`${token}->>`) || seq.includes(`->>${token}:`), `declared participant ${token} is referenced by a shown message`);
  }
});

test('volume cap: a graph under the limit is never capped and carries no cap comment', () => {
  const seq = mermaidSequence(fanOutGraph(5));
  assert.ok(!seq.includes('%%'), 'no cap comment below the limit');
  assert.strictEqual(seq.split('\n').filter((l) => /->>/.test(l)).length, 5);
});

test('an empty graph states its own emptiness rather than a silent bare header', () => {
  const seq = mermaidSequence(emptyGraph);
  assert.strictEqual(seq, 'sequenceDiagram\n    %% no service-level interactions found in this scan\n');
});

test('structural invariants hold across every fixture shape: header, declared-before-used, no raw delimiter', () => {
  const cases: [string, ArchGraph][] = [
    ['depth', depthGraph],
    ['collision', collisionGraph],
    ['self-call', selfCallGraph],
    ['cycle', cycleGraph],
    ['escaping', escapingGraph],
    ['fan-out (capped)', fanOutGraph(45)],
    ['fan-out (uncapped)', fanOutGraph(5)],
  ];
  for (const [label, g] of cases) {
    assertStructurallyValidSequence(mermaidSequence(g), label);
  }
  // the empty graph is structurally valid too (header + comment, no messages)
  assert.match(mermaidSequence(emptyGraph), /^sequenceDiagram\n/);
});
