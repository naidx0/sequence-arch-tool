/* ══════════════════════════════════════════════════════════════════════════
   GRADING A LEARNER'S PREDICTION — five verdicts, and the one that doubts us

   W3 (`docs/research/w3-predict-then-reveal.md`). A learner draws or names an
   edge they expect to exist; the graph either has it or does not. Three verdicts
   are the obvious ones. The two that matter are the two that are not about the
   learner being wrong.

   `test-only` is the best teaching moment this product can manufacture, and no
   generic tutor has access to it: the learner believed something true of the
   TEST SUITE and false of production. `CANON` records why the field it reads
   exists — `svc:gateway`'s only two inbound edges were nginx confs inside test
   fixtures, both honestly produced and both wrong about the world.

   `graph-gap` is the one that points at us. A prediction the graph does not
   contain is NOT automatically wrong: the walk may never have entered the region
   where that edge would live. A grader without it marks a correct answer wrong
   and blames the learner, which is worse than not grading at all — so it is
   built first, before the grader that would need it.

   IT ASKS scanCoverage RATHER THAN RE-DERIVING COVERAGE. Two features already
   derived that question separately in one night, and the third derivation is the
   one that gets it subtly wrong; the premise check's own first version gated on
   one signal of three and shipped a false positive.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph, ArchEdge } from './index.js';
import { scanCoverage } from './scanCoverage.js';

export type PredictionVerdict =
  /** The predicted edge exists. */
  | 'hit'
  /** The right neighbour under the wrong name — the model of the system was right. */
  | 'near'
  /** The edge exists with src and dst swapped. The commonest real mistake. */
  | 'reversed'
  /** It exists, and every citation for it sits in a test fixture. */
  | 'test-only'
  /** No such edge, AND coverage cannot rule it out. The scan doubts itself. */
  | 'graph-gap'
  /** No such edge, and the walk was in a position to have seen one. */
  | 'miss';

export interface PredictionGrade {
  verdict: PredictionVerdict;
  /** The matching edge, when one was found. */
  edge?: ArchEdge;
  /** What the turn should say — the reason, in the learner's terms. */
  reason: string;
  /** For `graph-gap`: what the scan did not cover. */
  uncovered?: string[];
}

/** Node id or label, lower-cased, for a forgiving comparison. */
const keyOf = (graph: ArchGraph, idOrLabel: string): string[] => {
  const want = idOrLabel.trim().toLowerCase();
  const hits = graph.nodes.filter(
    (n) => n.id.toLowerCase() === want || (n.label ?? '').toLowerCase() === want,
  );
  return hits.length > 0 ? hits.map((n) => n.id) : [idOrLabel];
};

/**
 * Grade one predicted edge against the scanned graph.
 *
 * ORDER IS THE DESIGN. `hit` before `reversed` before `test-only` would be
 * wrong: an edge whose every citation is a fixture is `test-only` even though it
 * technically exists, because saying "correct" there teaches the learner
 * something false about production. And `graph-gap` is checked before `miss`,
 * because "I did not look there" must always beat "you are wrong".
 */
export function gradePrediction(
  graph: ArchGraph,
  prediction: { src: string; dst: string },
): PredictionGrade {
  const srcIds = keyOf(graph, prediction.src);
  const dstIds = keyOf(graph, prediction.dst);
  const has = (a: string[], b: string[]): ArchEdge | undefined =>
    graph.edges.find((e) => a.includes(e.srcId) && b.includes(e.dstId));

  const forward = has(srcIds, dstIds);
  if (forward) {
    /*
     * `mixed` IS NOT `test-only`, and the distinction is the whole point. An
     * edge cited in both a fixture and a source file is a real production edge
     * that also happens to be tested; grading it test-only would tell a learner
     * their correct answer describes only the test suite — the exact false
     * accusation this verdict exists to prevent.
     */
    if (forward.instrument === 'test') {
      return {
        verdict: 'test-only',
        edge: forward,
        reason:
          'That edge is real, but every citation for it sits in a test fixture — it is true of ' +
          'the test suite and not of production. That is a gap in the model of the system, not a ' +
          'wrong answer.',
      };
    }
    return { verdict: 'hit', edge: forward, reason: 'That edge exists, and here is where.' };
  }

  const backward = has(dstIds, srcIds);
  if (backward) {
    return {
      verdict: 'reversed',
      edge: backward,
      reason:
        'The edge is real and the direction is the other way round. That is the commonest real ' +
        'mistake, and the graph can prove which way it goes.',
    };
  }

  /*
   * NOTHING FOUND — and this is where a grader either doubts the learner or
   * doubts itself. Coverage decides which, and it is asked, never re-derived.
   */
  const cov = scanCoverage(graph);
  if (cov.verdict !== 'complete') {
    return {
      verdict: 'graph-gap',
      reason:
        'The scan holds no such edge — but it did not read everything, so it cannot tell you the ' +
        'edge is absent. Here is what it does show, and here is what it never opened.',
      uncovered: cov.reasons,
    };
  }

  /* `near` is only honest once we know the walk was complete: a neighbour found
     over a partial graph is a neighbour of what we happened to read. */
  const neighbours = graph.edges.filter((e) => srcIds.includes(e.srcId));
  if (neighbours.length > 0) {
    return {
      verdict: 'near',
      edge: neighbours[0]!,
      reason:
        'Not that one — but the thing it does talk to is right here, so the shape of the guess ' +
        'was right and the name was not.',
    };
  }

  return {
    verdict: 'miss',
    reason:
      'The scan read everywhere that edge could live and did not find it. This one is worth ' +
      'walking back through.',
  };
}
