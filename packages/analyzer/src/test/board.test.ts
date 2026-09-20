import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildStructuralTree } from '../explain/explain.js';
import { buildBoardModel, isDeepExpansion, type PlainNode } from '@sequence/schema';

/**
 * Integration lock: the pure board view-model (in @sequence/schema) over a REAL
 * scanned repo + the real structural PlainTree. The exhaustive unit coverage of
 * the math lives in schema/src/board.test.ts; this proves the two layers compose
 * honestly on real deterministic data (the plainapp fixture).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

/** Collect every plain-node id → node, for source-ref honesty checks. */
function index(root: PlainNode): Map<string, PlainNode> {
  const m = new Map<string, PlainNode>();
  const walk = (n: PlainNode) => {
    m.set(n.id, n);
    n.children.forEach(walk);
  };
  walk(root);
  return m;
}

test('buildBoardModel over a real scan: honest nodes, cross-area overlay, deterministic', async () => {
  const graph = await scanRepo(PLAINAPP, { cluster: true });
  const tree = buildStructuralTree(graph);

  // Default view: the app root + the plain-English areas are on the board.
  const m = buildBoardModel(tree, graph, { expanded: new Set(), direction: 'tree' });
  const titles = m.nodes.map((n) => n.title);
  assert.ok(m.nodes.some((n) => n.depth === 0), 'the app root card is present');
  assert.ok(titles.includes('Frontend') && titles.includes('Backend'), 'areas visible by default');

  // Every board node traces to a real source (honesty): its sourceRefs are all
  // real graph node ids or paths — the board never invents structure.
  const validRefs = new Set<string>();
  for (const n of graph.nodes) {
    validRefs.add(n.id);
    if (n.path) validRefs.add(n.path);
  }
  for (const bn of m.nodes) {
    for (const ref of bn.sourceRefs) {
      assert.ok(validRefs.has(ref), `board node ${bn.id} sourceRef ${ref} must be real`);
    }
  }

  // Overlays reference only visible board nodes and only real edge kinds.
  const present = new Set(m.nodes.map((n) => n.id));
  const realKinds = new Set(graph.edges.map((e) => e.kind));
  for (const e of m.edges) {
    assert.ok(present.has(e.src) && present.has(e.dst), 'overlay endpoints are on the board');
    assert.ok(realKinds.has(e.kind), 'overlay kind is a real edge kind');
  }
  // The frontend→backend http call crosses areas and shows as a cross-area overlay.
  assert.ok(
    m.edges.some((e) => e.kind === 'http' && e.crossArea),
    'the frontend→backend HTTP call is a cross-area overlay'
  );

  // Deterministic: same inputs → byte-identical model.
  const again = buildBoardModel(tree, graph, { expanded: new Set(), direction: 'tree' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m)), JSON.parse(JSON.stringify(again)));

  // The root App is a deep expansion (its areas have children); a leaf file is not.
  assert.strictEqual(isDeepExpansion(tree), true);
});
