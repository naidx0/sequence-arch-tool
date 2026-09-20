import assert from 'node:assert';
import { test } from 'node:test';

import {
  POLICY_EXIT,
  addedEdgesBetween,
  baselineKey,
  checkPolicyBetweenScans,
  policyExitCode,
} from './policyScans.js';
import type { ArchGraph } from './index.js';
import type { Policy } from './policy.js';

/**
 * POLICY AGAINST A COMMIT, NOT AGAINST A DRAWING.
 *
 * `checkPolicy` takes `addedEdges` — a mutation someone is authoring on the
 * canvas — so the rules could judge a proposal and could not judge a pull
 * request. The register's gate is a PR that adds a call into `payment` exiting
 * non-zero, and nothing could produce that number.
 *
 * Three things were missing and they are one feature:
 *
 *   1. the DIFF — added edges are what two scans differ by, not something a
 *      human hands over;
 *   2. the BASELINE — a rule is unadoptable in a repository that already breaks
 *      it. Without a ratchet the first run of any real rule on any real codebase
 *      is a wall of failures, and the rule gets deleted rather than adopted;
 *   3. the EXIT CODE — a verdict nothing can act on is a verdict nobody reads.
 */

function g(nodes: string[], edges: [string, string][]): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'r',
    nodes: nodes.map((id) => ({ id, label: id, kind: 'service' })),
    edges: edges.map(([srcId, dstId], i) => ({
      id: `e${i}`,
      srcId,
      dstId,
      kind: 'http',
      confidence: 1,
      origin: 'deterministic',
    })),
    warnings: [],
  } as unknown as ArchGraph;
}

/**
 * "no new synchronous call into payment" — a REAL rule kind, not an invented
 * one. `no-sync-into` is what the register's gate describes in as many words:
 * "a PR adding a sync call into `payment` exits non-zero with both anchors".
 */
const NO_CALLS_TO_PAYMENT: Policy[] = [
  {
    version: 1,
    name: 'payments',
    rules: [
      {
        kind: 'no-sync-into',
        target: 'payment',
        reason: 'payment is reached through the ledger, never called directly',
      },
    ],
  },
];

/* ═══ 1. the diff ═════════════════════════════════════════════════════════ */

test('added edges are what two scans differ by', () => {
  const before = g(['web', 'api'], [['web', 'api']]);
  const after = g(['web', 'api', 'payment'], [['web', 'api'], ['api', 'payment']]);
  assert.deepStrictEqual(addedEdgesBetween(before, after), [
    { srcId: 'api', dstId: 'payment', kind: 'http' },
  ]);
});

test('a removed edge is not an addition', () => {
  const before = g(['a', 'b'], [['a', 'b']]);
  const after = g(['a', 'b'], []);
  assert.deepStrictEqual(addedEdgesBetween(before, after), []);
});

test('edge IDS are ignored — the same relationship renumbered is not new', () => {
  /*
   * `nextEdgeId` counts up from zero on every scan, so the id of any given edge
   * moves whenever a file earlier in the walk gains or loses one. Diffing on ids
   * would report most of the graph as added on almost every commit, and a CI
   * check that cries wolf on every PR is one that gets disabled in a week.
   */
  const before = g(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
  const after = g(['a', 'b', 'c'], [['b', 'c'], ['a', 'b']]);
  assert.deepStrictEqual(addedEdgesBetween(before, after), []);
});

test('the same pair added under a DIFFERENT kind is an addition', () => {
  /* `a -> b` over http and `a -> b` over a queue are different couplings, and a
     rule may forbid one and permit the other. */
  const before = g(['a', 'b'], [['a', 'b']]);
  const after = {
    ...g(['a', 'b'], [['a', 'b']]),
    edges: [
      { id: 'x', srcId: 'a', dstId: 'b', kind: 'http', confidence: 1, origin: 'deterministic' },
      { id: 'y', srcId: 'a', dstId: 'b', kind: 'queue_publish', confidence: 1, origin: 'deterministic' },
    ],
  } as unknown as ArchGraph;
  assert.deepStrictEqual(addedEdgesBetween(before, after), [
    { srcId: 'a', dstId: 'b', kind: 'queue_publish' },
  ]);
});

/* ═══ 2. the verdict over two scans ═══════════════════════════════════════ */

test('a PR that adds a forbidden call blocks — the register gate', () => {
  const before = g(['web', 'api', 'payment'], [['web', 'api']]);
  const after = g(['web', 'api', 'payment'], [['web', 'api'], ['api', 'payment']]);

  const v = checkPolicyBetweenScans(before, after, NO_CALLS_TO_PAYMENT);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.blocks.length, 1);
  /* BOTH ANCHORS, which is what makes the failure actionable rather than a
     verdict: which rule spoke, and which edge fired it. */
  assert.strictEqual(v.blocks[0]!.edge.srcId, 'api');
  assert.strictEqual(v.blocks[0]!.edge.dstId, 'payment');
  assert.match(v.blocks[0]!.explanation, /payment/);
});

test('a PR that changes nothing relevant passes', () => {
  const before = g(['web', 'api', 'payment'], [['web', 'api']]);
  const after = g(['web', 'api', 'payment', 'search'], [['web', 'api'], ['web', 'search']]);
  assert.strictEqual(checkPolicyBetweenScans(before, after, NO_CALLS_TO_PAYMENT).ok, true);
});

test('an EXISTING violation does not block, because it was not added', () => {
  /*
   * The property that makes this usable at all. `checkPolicy` judges what the
   * commit ADDED; a violation present in both scans is the repository's status
   * quo, and failing a PR for it would fail every PR until someone fixes a
   * thing they did not touch.
   */
  const both = g(['api', 'payment'], [['api', 'payment']]);
  const v = checkPolicyBetweenScans(both, both, NO_CALLS_TO_PAYMENT);
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.blocks, []);
});

/* ═══ 3. the baseline ratchet ═════════════════════════════════════════════ */

test('a baselined violation is reported but does not block', () => {
  const before = g(['web', 'api', 'payment'], [['web', 'api']]);
  const after = g(['web', 'api', 'payment'], [['web', 'api'], ['api', 'payment']]);

  const baseline = { version: 1 as const, accepted: [baselineKey('no-sync-into', 'api', 'payment')] };
  const v = checkPolicyBetweenScans(before, after, NO_CALLS_TO_PAYMENT, baseline);

  assert.strictEqual(v.ok, true, 'an accepted violation does not fail the build');
  assert.deepStrictEqual(v.blocks, []);
  /*
   * REPORTED, NOT ERASED. A ratchet that hid what it accepted would leave a
   * repository with no way to see its own debt, and the point of a ratchet is
   * that the debt is visible and cannot grow.
   */
  assert.strictEqual(v.baselined.length, 1);
  assert.match(v.baselined[0]!.explanation, /payment/);
});

test('a NEW violation still blocks while an accepted one does not — the ratchet', () => {
  /*
   * BOTH are added by this commit, so both fire; the baseline accepts one. An
   * earlier draft put the accepted edge in `before` too, which made the test
   * pass for the wrong reason — it was not baselined, it simply was not an
   * addition. The ratchet is only exercised when the accepted violation is one
   * this run would otherwise block.
   */
  const before = g(['web', 'api', 'payment', 'jobs'], []);
  const after = g(
    ['web', 'api', 'payment', 'jobs'],
    [['api', 'payment'], ['jobs', 'payment']],
  );
  const baseline = { version: 1 as const, accepted: [baselineKey('no-sync-into', 'api', 'payment')] };
  const v = checkPolicyBetweenScans(before, after, NO_CALLS_TO_PAYMENT, baseline);

  assert.strictEqual(v.ok, false, 'the new one blocks');
  assert.deepStrictEqual(v.blocks.map((b) => b.edge.srcId), ['jobs']);
});

test('a baseline entry that no longer fires is reported as stale', () => {
  /*
   * The other half of a ratchet: it must be able to tighten. An accepted
   * violation that has since been fixed should be removable, and nothing will
   * remove it if nothing says it is dead — the file grows forever and stops
   * meaning anything.
   */
  const both = g(['web', 'api', 'payment'], [['web', 'api']]);
  const baseline = {
    version: 1 as const,
    accepted: [baselineKey('no-sync-into', 'api', 'payment')],
  };
  const v = checkPolicyBetweenScans(both, both, NO_CALLS_TO_PAYMENT, baseline);
  assert.deepStrictEqual(v.staleBaseline, [baselineKey('no-sync-into', 'api', 'payment')]);
});

/* ═══ 4. the exit code ════════════════════════════════════════════════════ */

test('the exit code contract is explicit and small', () => {
  assert.strictEqual(POLICY_EXIT.ok, 0);
  assert.strictEqual(POLICY_EXIT.violation, 1);
  assert.strictEqual(POLICY_EXIT.error, 2);
  /* Distinct, because CI must be able to tell "the rules said no" from "the
     checker fell over". A tool that returns 1 for both teaches a team to treat
     its own crashes as policy failures. */
  assert.strictEqual(new Set(Object.values(POLICY_EXIT)).size, 3);
});

test('a blocking verdict exits non-zero and a clean one exits zero', () => {
  const before = g(['api', 'payment'], []);
  const after = g(['api', 'payment'], [['api', 'payment']]);
  assert.strictEqual(policyExitCode(checkPolicyBetweenScans(before, after, NO_CALLS_TO_PAYMENT)), 1);
  assert.strictEqual(policyExitCode(checkPolicyBetweenScans(before, before, NO_CALLS_TO_PAYMENT)), 0);
});

test('warnings never change the exit code', () => {
  /* A warning that failed a build is a block wearing the wrong name, and the
     first thing a team does about it is stop writing warnings. */
  const v = { ok: true, blocks: [], warns: [{} as never], baselined: [], staleBaseline: [] };
  assert.strictEqual(policyExitCode(v), 0);
});

test('no policies means no opinion, and no failure', () => {
  const before = g(['api', 'payment'], []);
  const after = g(['api', 'payment'], [['api', 'payment']]);
  const v = checkPolicyBetweenScans(before, after, []);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(policyExitCode(v), 0);
});
