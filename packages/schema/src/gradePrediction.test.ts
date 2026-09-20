import assert from 'node:assert';
import { test } from 'node:test';

import { gradePrediction } from './gradePrediction.js';
import type { ArchGraph } from './index.js';

/**
 * THE VERDICT THAT DOUBTS US IS THE ONE TO GET RIGHT FIRST.
 *
 * A grader without `graph-gap` marks a correct answer wrong and blames the
 * learner, which is worse than not grading at all. So it is built before the
 * grader that needs it, and these lock the two orderings that make it honest:
 * `graph-gap` beats `miss`, and `test-only` beats `hit`.
 */

const g = (over: Record<string, unknown>): ArchGraph =>
  ({
    version: 1,
    scannedAt: '2026-09-04T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [
      { id: 'svc:a', kind: 'service', label: 'alpha' },
      { id: 'svc:b', kind: 'service', label: 'beta' },
      { id: 'svc:c', kind: 'service', label: 'gamma' },
      { id: 'f:src/x.ts', kind: 'file', label: 'x.ts', path: 'src/x.ts' },
    ],
    edges: [],
    warnings: [],
    unfollowed: [],
    unscanned: [],
    ...over,
  }) as unknown as ArchGraph;

const edge = (srcId: string, dstId: string, instrument?: string) =>
  ({ id: `${srcId}->${dstId}`, srcId, dstId, kind: 'http', confidence: 1, origin: 'deterministic', evidence: [], ...(instrument ? { instrument } : {}) }) as never;

test('a real edge is a hit, and it resolves by LABEL as well as by id', () => {
  const graph = g({ edges: [edge('svc:a', 'svc:b')] });
  assert.equal(gradePrediction(graph, { src: 'svc:a', dst: 'svc:b' }).verdict, 'hit');
  assert.equal(gradePrediction(graph, { src: 'alpha', dst: 'beta' }).verdict, 'hit');
});

test('the same edge backwards is REVERSED, not a miss', () => {
  const graph = g({ edges: [edge('svc:a', 'svc:b')] });
  const r = gradePrediction(graph, { src: 'svc:b', dst: 'svc:a' });
  assert.equal(r.verdict, 'reversed');
  assert.match(r.reason, /direction/);
});

test('TEST-ONLY beats hit, and `mixed` is NOT test-only', () => {
  /*
   * The best teaching moment this product can manufacture: the learner believed
   * something true of the test suite and false of production. But an edge cited
   * in BOTH a fixture and a source file is a real production edge that is also
   * tested — grading that test-only would tell a learner their correct answer
   * describes only the tests, which is the false accusation this exists to stop.
   */
  const testOnly = g({ edges: [edge('svc:a', 'svc:b', 'test')] });
  assert.equal(gradePrediction(testOnly, { src: 'svc:a', dst: 'svc:b' }).verdict, 'test-only');

  const mixed = g({ edges: [edge('svc:a', 'svc:b', 'mixed')] });
  assert.equal(gradePrediction(mixed, { src: 'svc:a', dst: 'svc:b' }).verdict, 'hit');

  const source = g({ edges: [edge('svc:a', 'svc:b', 'source')] });
  assert.equal(gradePrediction(source, { src: 'svc:a', dst: 'svc:b' }).verdict, 'hit');
});

test('GRAPH-GAP beats miss — "I did not look there" always outranks "you are wrong"', () => {
  const partial = g({
    edges: [],
    unscanned: [{ dir: 'services', files: 40, extensions: ['.go'] }],
  });
  const r = gradePrediction(partial, { src: 'svc:a', dst: 'svc:c' });
  assert.equal(r.verdict, 'graph-gap');
  assert.match(r.reason, /cannot tell you the edge is absent/);
  assert.ok(r.uncovered && r.uncovered.length > 0, 'it must name what it never opened');
});

test('coverage NOT RECORDED is also a graph-gap, never a miss', () => {
  /* Absent coverage fields mean "not recorded", which is not "nothing was
     missed". Reading them as complete is how a grader blames a learner for a
     region it never walked. */
  const legacy = { ...g({ edges: [] }) } as Record<string, unknown>;
  delete legacy.unfollowed;
  delete legacy.unscanned;
  assert.equal(
    gradePrediction(legacy as unknown as ArchGraph, { src: 'svc:a', dst: 'svc:c' }).verdict,
    'graph-gap',
  );
});

test('only a COMPLETE walk may return near or miss', () => {
  /* `near` over a partial graph is a neighbour of what we happened to read. */
  const complete = g({ edges: [edge('svc:a', 'svc:b')] });
  assert.equal(gradePrediction(complete, { src: 'svc:a', dst: 'svc:c' }).verdict, 'near');

  const isolated = g({ edges: [edge('svc:b', 'svc:c')] });
  assert.equal(gradePrediction(isolated, { src: 'svc:a', dst: 'svc:c' }).verdict, 'miss');
});
