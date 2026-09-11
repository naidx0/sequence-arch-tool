import assert from 'node:assert';
import { test } from 'node:test';
import type { ArchGraph } from './index.js';
import { buildBoardModel, type PlainNode } from './board.js';
import {
  DESIGN_ROOT_ID,
  DESIGN_ID_PREFIX,
  addDesignChild,
  autoSortDesign,
  classifyDesignNode,
  findDesignNode,
  isDesignBucket,
  moveDesignNode,
  newDesign,
  removeDesignNode,
  renameDesignNode,
} from './design.js';

/**
 * Unit lock for the from-scratch DESIGN tree (v8 Phase B2). All pure functions —
 * no server, no AI — so the deterministic id derivation, the mutation ops, and
 * the auto-sort organization are pinned here. Honesty: every designed node lives
 * in the `d:` namespace with EMPTY sourceRefs (design intent, not a scan).
 */

/** Deep, order-preserving snapshot for byte-stability assertions. */
function snap(n: PlainNode): unknown {
  return JSON.parse(JSON.stringify(n));
}

/** Assert every node in the tree is an honest designed node: `d:` id, empty sourceRefs. */
function assertDesigned(n: PlainNode): void {
  assert.ok(n.id.startsWith(DESIGN_ID_PREFIX), `id ${n.id} must be in the d: namespace`);
  assert.deepStrictEqual(n.sourceRefs, [], `designed node ${n.id} must have empty sourceRefs`);
  n.children.forEach(assertDesigned);
}

test('newDesign: one editable root block, group kind, empty sourceRefs', () => {
  const root = newDesign('Pet App');
  assert.strictEqual(root.id, DESIGN_ROOT_ID);
  assert.strictEqual(root.title, 'Pet App');
  assert.strictEqual(root.kind, 'group');
  assert.deepStrictEqual(root.sourceRefs, []);
  assert.deepStrictEqual(root.children, []);
});

test('addDesignChild: adds a connected child in the d: namespace, empty sourceRefs, unique sibling ids', () => {
  const root = newDesign('app');
  const a = addDesignChild(root, DESIGN_ROOT_ID, { title: 'Login page', kind: 'feature' });
  assert.ok(a.id.startsWith('d:'));
  assert.notStrictEqual(a.id, DESIGN_ROOT_ID);
  const child = findDesignNode(a.root, a.id)!;
  assert.strictEqual(child.title, 'Login page');
  assert.strictEqual(child.kind, 'feature');
  assert.deepStrictEqual(child.sourceRefs, []);

  // Same title again → a DIFFERENT, unique id among siblings.
  const b = addDesignChild(a.root, DESIGN_ROOT_ID, { title: 'Login page', kind: 'feature' });
  assert.notStrictEqual(b.id, a.id);
  assert.strictEqual(b.root.children.length, 2);

  // The original tree is untouched (no in-place mutation).
  assert.strictEqual(root.children.length, 0);
  assertDesigned(b.root);
});

test('addDesignChild: missing parent is a no-op with an empty id', () => {
  const root = newDesign('app');
  const r = addDesignChild(root, 'd:does-not-exist', { title: 'x', kind: 'feature' });
  assert.strictEqual(r.id, '');
  assert.strictEqual(r.root.children.length, 0);
});

test('renameDesignNode: changes the title but keeps the id stable', () => {
  const root = newDesign('app');
  const { root: r1, id } = addDesignChild(root, DESIGN_ROOT_ID, { title: 'Notes', kind: 'service' });
  const r2 = renameDesignNode(r1, id, 'Notes API');
  const node = findDesignNode(r2, id)!;
  assert.strictEqual(node.id, id, 'id is stable across rename');
  assert.strictEqual(node.title, 'Notes API');
  // renaming the root works too (the "repo name" block).
  const r3 = renameDesignNode(r2, DESIGN_ROOT_ID, 'My App');
  assert.strictEqual(r3.title, 'My App');
});

test('removeDesignNode: removes a node with its descendants; the root is never removable', () => {
  const root = newDesign('app');
  const { root: r1, id: parent } = addDesignChild(root, DESIGN_ROOT_ID, { title: 'Backend', kind: 'area' });
  const { root: r2, id: child } = addDesignChild(r1, parent, { title: 'Auth', kind: 'service' });
  assert.ok(findDesignNode(r2, child));

  const r3 = removeDesignNode(r2, parent);
  assert.strictEqual(findDesignNode(r3, parent), undefined);
  assert.strictEqual(findDesignNode(r3, child), undefined, 'descendant removed with parent');

  const r4 = removeDesignNode(r3, DESIGN_ROOT_ID);
  assert.strictEqual(r4.id, DESIGN_ROOT_ID, 'root survives a remove attempt');
});

test('moveDesignNode: reparents; refuses root-move, self-move, and cycles', () => {
  const root = newDesign('app');
  const { root: r1, id: front } = addDesignChild(root, DESIGN_ROOT_ID, { title: 'Frontend', kind: 'area' });
  const { root: r2, id: back } = addDesignChild(r1, DESIGN_ROOT_ID, { title: 'Backend', kind: 'area' });
  const { root: r3, id: page } = addDesignChild(r2, front, { title: 'Home page', kind: 'feature' });

  // Move the page from Frontend to Backend.
  const r4 = moveDesignNode(r3, page, back);
  assert.strictEqual(findDesignNode(r4, front)!.children.length, 0);
  assert.strictEqual(findDesignNode(r4, back)!.children.length, 1);
  assert.strictEqual(findDesignNode(r4, back)!.children[0].id, page);

  // Cycle guard: moving Backend into its own (new) child is a no-op.
  const cyc = moveDesignNode(r4, back, page);
  assert.deepStrictEqual(snap(cyc), snap(r4), 'cycle move is a no-op');

  // Root move is a no-op.
  assert.deepStrictEqual(snap(moveDesignNode(r4, DESIGN_ROOT_ID, back)), snap(r4));
});

test('byte-stable: replaying the same operations yields an identical tree', () => {
  const build = (): PlainNode => {
    let r = newDesign('shop');
    r = addDesignChild(r, DESIGN_ROOT_ID, { title: 'Storefront', kind: 'service' }).root;
    r = addDesignChild(r, DESIGN_ROOT_ID, { title: 'Orders API', kind: 'service' }).root;
    r = addDesignChild(r, DESIGN_ROOT_ID, { title: 'Postgres database', kind: 'data' }).root;
    return r;
  };
  assert.deepStrictEqual(snap(build()), snap(build()));
});

test('classifyDesignNode: titles map to the right plain-English bucket', () => {
  const node = (title: string, kind: PlainNode['kind'] = 'feature'): PlainNode => ({
    id: 'd:x', title, kind, children: [], sourceRefs: [],
  });
  assert.strictEqual(classifyDesignNode(node('Login page')).bucket, 'frontend');
  assert.strictEqual(classifyDesignNode(node('Orders API')).bucket, 'backend');
  assert.strictEqual(classifyDesignNode(node('Postgres database')).bucket, 'data');
  assert.strictEqual(classifyDesignNode(node('Payments', 'service')).bucket, 'services');
  // kind:data always lands in Data even with a neutral title.
  assert.strictEqual(classifyDesignNode(node('Widgets', 'data')).bucket, 'data');
  // named sub-services.
  assert.deepStrictEqual(classifyDesignNode(node('Matching service')), { bucket: 'services', sub: 'Matching' });
  assert.deepStrictEqual(classifyDesignNode(node('Storing')), { bucket: 'services', sub: 'Storing' });
});

test('autoSortDesign: a flat mixed list lands under the right buckets, idempotently', () => {
  let r = newDesign('app');
  for (const t of ['Dashboard', 'Notes API', 'Redis cache', 'Payments', 'Matching service']) {
    r = addDesignChild(r, DESIGN_ROOT_ID, { title: t, kind: t === 'Redis cache' ? 'data' : 'feature' }).root;
  }
  const sorted = autoSortDesign(r);

  // Top level is exactly the non-empty buckets, in the fixed scheme order.
  const bucketTitles = sorted.children.map((c) => c.title);
  assert.deepStrictEqual(bucketTitles, ['Frontend', 'Backend', 'Data', 'Services']);
  for (const b of sorted.children) assert.ok(isDesignBucket(b.id), `${b.id} is a bucket`);

  const bucket = (title: string) => sorted.children.find((c) => c.title === title)!;
  const titlesIn = (title: string): string[] => {
    const out: string[] = [];
    const walk = (n: PlainNode) => { if (!isDesignBucket(n.id)) out.push(n.title); n.children.forEach(walk); };
    bucket(title).children.forEach(walk);
    return out;
  };
  assert.deepStrictEqual(titlesIn('Frontend'), ['Dashboard']);
  assert.deepStrictEqual(titlesIn('Backend'), ['Notes API']);
  assert.deepStrictEqual(titlesIn('Data'), ['Redis cache']);
  // Services has a "Matching" sub-bucket plus the direct "Payments" item.
  assert.ok(bucket('Services').children.some((c) => c.title === 'Matching' && isDesignBucket(c.id)));
  assert.ok(titlesIn('Services').includes('Payments'));
  assert.ok(titlesIn('Services').includes('Matching service'));

  // Idempotent: sorting the sorted tree changes nothing.
  assert.deepStrictEqual(snap(autoSortDesign(sorted)), snap(sorted));
  // Still an honest designed tree.
  assertDesigned(sorted);
});

test('autoSortDesign: user subtrees are preserved under their new bucket', () => {
  let r = newDesign('app');
  const add = addDesignChild(r, DESIGN_ROOT_ID, { title: 'Notes API', kind: 'service' });
  r = add.root;
  r = addDesignChild(r, add.id, { title: 'save note', kind: 'feature' }).root;
  const sorted = autoSortDesign(r);
  const backend = sorted.children.find((c) => c.title === 'Backend')!;
  const notes = backend.children.find((c) => c.title === 'Notes API')!;
  assert.strictEqual(notes.children.length, 1);
  assert.strictEqual(notes.children[0].title, 'save note');
});

test('a designed tree feeds buildBoardModel and renders (empty sourceRefs, expansion works)', () => {
  let r = newDesign('app');
  const front = addDesignChild(r, DESIGN_ROOT_ID, { title: 'Frontend', kind: 'area' });
  r = front.root;
  r = addDesignChild(r, front.id, { title: 'Login page', kind: 'feature' }).root;

  // There is no real repo, so the board is built against an EMPTY graph.
  const emptyGraph: ArchGraph = {
    version: 1, mode: 'design', scannedAt: '', repoRoot: '', repoName: 'app',
    nodes: [], edges: [], warnings: [],
  };

  // Collapsed: only the top-level area shows, no edges, no crash.
  const collapsed = buildBoardModel(r, emptyGraph, { expanded: new Set(), direction: 'tree' });
  assert.deepStrictEqual(collapsed.edges, []);
  const front1 = collapsed.nodes.find((n) => n.id === front.id)!;
  assert.ok(front1, 'the Frontend area renders as a card');
  assert.strictEqual(front1.hasChildren, true);
  assert.strictEqual(front1.isExpanded, false);
  assert.ok(!collapsed.nodes.some((n) => n.title === 'Login page'), 'child hidden while collapsed');

  // Expanded: the child becomes visible.
  const expanded = buildBoardModel(r, emptyGraph, { expanded: new Set([front.id]), direction: 'tree' });
  assert.ok(expanded.nodes.some((n) => n.title === 'Login page'), 'child visible when expanded');
});
