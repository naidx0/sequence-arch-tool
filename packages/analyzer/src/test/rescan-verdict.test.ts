import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { rescanVerdict } from '../moat/rescanVerdict.js';

/**
 * THE VERDICT THE STALENESS RAISES.
 *
 * `PUT /api/file` clears the graph cache without re-scanning, so an accepted
 * edit leaves the board knowingly stale — a state the app can now enter and say
 * out loud. This answers the question that state raises, and it has to answer
 * it in the reviewer's terms: not "the graph moved" but "you added a
 * synchronous call from the gateway into payments".
 *
 * The register named the fixture pair, and it is real: `shopfront` and
 * `shopfront-mutated` are two scans of the same system with the architecture
 * deliberately changed between them. Testing against them means the verdict is
 * measured on a real scan rather than on two hand-built graphs that agree with
 * whatever the implementation happens to do.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');
const SHOPFRONT = path.join(FIXTURES, 'shopfront');
const MUTATED = path.join(FIXTURES, 'shopfront-mutated');

test('a scan against itself is UNCHANGED — the common case, said plainly', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  const v = rescanVerdict(g, g);
  assert.strictEqual(v.unchanged, true);
  assert.deepStrictEqual(v.added, []);
  assert.deepStrictEqual(v.removed, []);
  /*
   * Most edits do not change the architecture, and saying so plainly is what
   * makes the times it DOES change worth reading. A verdict that hedged here
   * would make the two indistinguishable.
   */
  assert.match(v.summary, /architecture is unchanged/i);
});

test('a real mutation is reported in the reviewer’s terms, not as a graph delta', async () => {
  const before = await scanRepo(SHOPFRONT, {});
  const after = await scanRepo(MUTATED, {});
  const v = rescanVerdict(before, after);

  assert.strictEqual(v.unchanged, false, 'the fixtures differ; the verdict must say so');
  assert.ok(
    v.added.length > 0 || v.removed.length > 0 || v.addedNodes.length > 0 || v.removedNodes.length > 0,
    'something concrete changed',
  );
  /* The sentence names what moved rather than counting it. */
  assert.match(v.summary, /architecture changed/i);
  for (const edge of [...v.added, ...v.removed]) {
    /* Service level, in the projection's own `src -> dst [family]` spelling —
       so a reader sees a relationship between two things they can name. */
    assert.match(edge, /^\S.* -> \S.* \[\w+\]$/, `not a service-level edge: ${edge}`);
  }
});

test('the direction is not transposed — added and removed are mirror images', async () => {
  const before = await scanRepo(SHOPFRONT, {});
  const after = await scanRepo(MUTATED, {});
  const forward = rescanVerdict(before, after);
  const backward = rescanVerdict(after, before);
  /*
   * Swapping the arguments must swap the two lists exactly. This is the one
   * property that fails silently and reads correctly: a verdict that told a
   * reviewer they REMOVED the call they just added would be worse than no
   * verdict, and nothing else in the output would look wrong.
   */
  assert.deepStrictEqual(forward.added, backward.removed);
  assert.deepStrictEqual(forward.removed, backward.added);
  assert.deepStrictEqual(forward.addedNodes, backward.removedNodes);
});

test('import churn alone is not an architecture change', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  /* Every import edge doubled — the shape a refactor that moves code between
     files produces, and the noise a file-level diff would drown the real answer
     in. `projectToServiceLevel` drops imports, and this is what says so. */
  const churned = {
    ...g,
    edges: [
      ...g.edges,
      ...g.edges
        .filter((e) => e.kind === 'import')
        .map((e, i) => ({ ...e, id: `dup${i}` })),
    ],
  };
  assert.strictEqual(rescanVerdict(g, churned).unchanged, true);
});

test('a long list is summarised rather than dumped', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  const empty = { ...g, nodes: g.nodes, edges: [] };
  const v = rescanVerdict(empty, g);
  assert.ok(v.removed.length === 0);
  if (v.added.length > 5) {
    /* A summary that pasted forty edges into one sentence is a summary nobody
       reads; the full lists are still on the object for anything that wants
       them. */
    assert.match(v.summary, /and \d+ more/);
  }
});

test('is pure — neither graph is mutated', async () => {
  const before = await scanRepo(SHOPFRONT, {});
  const after = await scanRepo(MUTATED, {});
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  rescanVerdict(before, after);
  assert.strictEqual(JSON.stringify(before), a);
  assert.strictEqual(JSON.stringify(after), b);
});
