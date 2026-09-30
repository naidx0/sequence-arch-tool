/**
 * The ask digest must sample the graph by IMPORTANCE, not by array position.
 *
 * `buildDigest` caps the edge list at `MAX_EDGES = 300` (explain.ts:766) and took
 * that cap with `graph.edges.slice(0, MAX_EDGES)` (explain.ts:853) — the first 300
 * edges in whatever order the scanner happened to append them. On any repo larger
 * than the cap that silently decides what the assistant can see.
 *
 * MEASURED on this repository before the fix, by scanning it and reproducing the
 * slice (1318 nodes, 2309 edges):
 *
 *     whole graph   web 1545 · analyzer 593 · schema 106 · export 37 · gateway 15
 *                   · mcp 5 · acp 4 · desktop 2 · ink 2
 *     digest sees   analyzer 296 · acp 4
 *     packages/web  1545 edges in the graph  ->  0 reaching the assistant
 *
 * Two thirds of the codebase — and the entire product surface — contributed
 * nothing to the grounded context. The assistant was not wrong about `web`; it
 * could not see `web`.
 *
 * The ranking signal already existed and was thrown away: `pageRank()` is called
 * once per scan (scan.ts:824) and written to every file node as `meta.pageRank`
 * (scan.ts:950), and a repo-wide search found ZERO reads of that property. The fix
 * spends what the scanner was already computing.
 *
 * This test asserts the INVARIANT — importance beats position — rather than the
 * expression that implements it, so a future rewrite that swaps pageRank for a
 * better centrality measure keeps passing on merit instead of needing an edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchGraph, ArchNode, ArchEdge } from '@sequence/schema';
import { buildDigest } from '../explain/explain.js';

/** A file node carrying an explicit pageRank, which is what ranking reads. */
function fileNode(id: string, rank: number): ArchNode {
  return {
    id,
    kind: 'file',
    label: id.slice(id.lastIndexOf('/') + 1),
    path: id,
    meta: { language: 'ts', loc: 100, pageRank: rank },
  } as ArchNode;
}

function importEdge(from: string, to: string): ArchEdge {
  return {
    id: `${from}->${to}`,
    srcId: from,
    dstId: to,
    kind: 'import',
    confidence: 1,
    origin: 'deterministic',
    evidence: [],
  } as ArchEdge;
}

/**
 * A graph whose UNIMPORTANT edges come first and whose IMPORTANT ones come last —
 * the shape a scanner produces when it walks directories alphabetically and the
 * interesting package sorts late. `noise` alone exceeds the cap.
 */
function graphWithLateImportantEdges(): ArchGraph {
  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];

  const NOISE = 320; // deliberately more than MAX_EDGES on its own
  for (let i = 0; i < NOISE + 1; i++) nodes.push(fileNode(`noise/f${i}.ts`, 0.0001));
  for (let i = 0; i < NOISE; i++) edges.push(importEdge(`noise/f${i}.ts`, `noise/f${i + 1}.ts`));

  const CORE = 40;
  for (let i = 0; i < CORE + 1; i++) nodes.push(fileNode(`core/f${i}.ts`, 0.9));
  for (let i = 0; i < CORE; i++) edges.push(importEdge(`core/f${i}.ts`, `core/f${i + 1}.ts`));

  return {
    version: 1,
    mode: 'scan',
    scannedAt: new Date(0).toISOString(),
    repoRoot: '/tmp/fixture',
    repoName: 'fixture',
    nodes,
    edges,
    warnings: [],
  };
}

const from = (e: { from: string }) => e.from;

test('the digest does not drop a whole package because its edges sort late', () => {
  // The defect in one assertion. `core` holds the highest-ranked files in the
  // graph; position-slicing cannot see any of them, because `noise` fills the cap
  // before `core` is reached.
  const digest = buildDigest(graphWithLateImportantEdges());
  const core = digest.edges.filter((e) => from(e).startsWith('core/'));

  assert.ok(
    core.length > 0,
    `the digest carried ${digest.edges.length} edges and NONE came from core/, whose ` +
      `files hold the highest pageRank in the graph. The sample is being taken by ` +
      `array position, so the assistant cannot see the part of the repo that matters most.`,
  );
});

test('the cap still holds — ranking selects, it does not enlarge', () => {
  // Guards the obvious wrong fix: raising or removing MAX_EDGES to make the first
  // test pass would blow up the prompt instead of choosing better.
  const graph = graphWithLateImportantEdges();
  const digest = buildDigest(graph);

  assert.ok(digest.edges.length <= 300, `digest carried ${digest.edges.length} edges, cap is 300`);
  assert.ok(graph.edges.length > 300, 'the fixture must exceed the cap or it proves nothing');
});

test('a graph under the cap keeps every edge, in graph order', () => {
  // Ranking must not reorder or drop anything when there is nothing to choose
  // between — the small-repo case, which is most of them.
  const nodes = [fileNode('a.ts', 0.5), fileNode('b.ts', 0.4), fileNode('c.ts', 0.3)];
  const edges = [importEdge('a.ts', 'b.ts'), importEdge('b.ts', 'c.ts')];
  const digest = buildDigest({
    version: 1,
    mode: 'scan',
    scannedAt: new Date(0).toISOString(),
    repoRoot: '/tmp/small',
    repoName: 'small',
    nodes,
    edges,
    warnings: [],
  });

  assert.deepEqual(
    digest.edges.map(from),
    ['a.ts', 'b.ts'],
    'every edge survives, and the order is unchanged, when the graph fits the cap',
  );
});
