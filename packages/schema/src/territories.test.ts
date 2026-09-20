import assert from 'node:assert';
import { test } from 'node:test';

import { CLAIMS_EVERYTHING, territories, territorySentence } from './territories.js';
import type { TerritoryClaim } from './territories.js';

/**
 * AGENTS AS TERRITORIES.
 *
 * The gap study is specific about why: "Claude Code's own agent-teams
 * limitations are dominated by OBSERVABILITY failures — task status can lag,
 * teammates fail to mark tasks completed. Their UI for a five-way debate is
 * five rows of one-line summaries, three of which collapse into `2 idle agents`
 * after 30 seconds." A view of claimed file ownership "eliminates the failure
 * class rather than documenting it".
 *
 * THE FAILURE CLASS IS THE OVERLAP, and the reason this is worth building is
 * that it is DECIDABLE. Two agents with a claim on one file is not a status
 * that lags — it is a collision, knowable from the claims alone, with no
 * polling and nothing depending on an agent remembering to mark itself done.
 */

const PATHS = [
  'services/payments/charge.ts',
  'services/payments/refund.ts',
  'services/orders/place.ts',
  'packages/shared/money.ts',
  'README.md',
];

function claim(agentId: string, ...globs: string[]): TerritoryClaim {
  return { agentId, globs };
}

test('each agent gets the files its claim covers', () => {
  const t = territories(PATHS, [
    claim('payments-agent', 'services/payments/**'),
    claim('orders-agent', 'services/orders/**'),
  ]);
  assert.deepStrictEqual(t.byAgent['payments-agent'], [
    'services/payments/charge.ts',
    'services/payments/refund.ts',
  ]);
  assert.deepStrictEqual(t.byAgent['orders-agent'], ['services/orders/place.ts']);
});

test('a file two agents both claim is a CONFLICT, named with both', () => {
  const t = territories(PATHS, [
    claim('a', 'services/**'),
    claim('b', 'services/payments/**'),
  ]);
  /*
   * The whole point. This is not a status that might catch up — it is two
   * claims on one file, decidable right now, before either agent has written
   * anything.
   */
  assert.deepStrictEqual(
    t.conflicts.map((c) => c.path),
    ['services/payments/charge.ts', 'services/payments/refund.ts'],
  );
  assert.deepStrictEqual(t.conflicts[0]!.agentIds, ['a', 'b']);
  /* And a conflicted file belongs to NEITHER agent's territory — showing it as
     owned by one of them would be the picture asserting a resolution nobody
     made. */
  assert.deepStrictEqual(t.byAgent['a'], ['services/orders/place.ts']);
  assert.deepStrictEqual(t.byAgent['b'], []);
});

test('overlapping GLOBS that never meet a real file are not a conflict', () => {
  /*
   * `src/**` and `src/api/**` overlap in principle. Reporting that as a
   * collision would cry wolf on the first day a team wrote both, and a warning
   * that fires when nothing is wrong is one nobody reads by the second week.
   * The division is over files that EXIST.
   */
  const t = territories(['services/orders/place.ts'], [
    claim('a', 'services/payments/**'),
    claim('b', 'services/payments/charge.ts'),
  ]);
  assert.deepStrictEqual(t.conflicts, []);
});

test('an agent that claims everything is reported separately, not as a conflict with all', () => {
  const t = territories(PATHS, [claim('wide'), claim('payments-agent', 'services/payments/**')]);
  /*
   * An empty allowlist means "may edit anything" — sensible for one agent, and
   * a claim over the whole repository when three are running. Folding it into
   * `conflicts` would put it in collision with every other agent on every file:
   * true, unreadable, and the wrong fix. This agent needs a NARROWER CLAIM, not
   * a merge.
   */
  assert.deepStrictEqual(t.claimsEverything, ['wide']);
  assert.deepStrictEqual(t.conflicts, []);
  assert.deepStrictEqual(t.byAgent['payments-agent'], [
    'services/payments/charge.ts',
    'services/payments/refund.ts',
  ]);
});

test('an explicit ** or * is the same claim as declaring nothing', () => {
  for (const g of [CLAIMS_EVERYTHING, '**']) {
    assert.deepStrictEqual(territories(PATHS, [claim('w', g)]).claimsEverything, ['w']);
  }
});

test('files nobody claims are reported — not a problem, but a fact worth seeing', () => {
  const t = territories(PATHS, [claim('payments-agent', 'services/payments/**')]);
  assert.deepStrictEqual(t.unclaimed, [
    'README.md',
    'packages/shared/money.ts',
    'services/orders/place.ts',
  ]);
});

test('no agents at all means everything is unclaimed and nothing is wrong', () => {
  const t = territories(PATHS, []);
  assert.strictEqual(t.unclaimed.length, PATHS.length);
  assert.deepStrictEqual(t.conflicts, []);
  assert.strictEqual(territorySentence(t), null);
});

test('the result is deterministic and sorted', () => {
  const claims = [claim('b', 'services/**'), claim('a', 'services/payments/**')];
  const first = territories([...PATHS].reverse(), claims);
  const second = territories(PATHS, [...claims].reverse());
  /* Two callers assembling the same claims in different orders must see the
     same board; otherwise "who owns this" changes when a list is re-sorted. */
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first.conflicts[0]!.agentIds, ['a', 'b']);
});

test('duplicate paths are counted once', () => {
  const t = territories(['a.ts', 'a.ts'], [claim('x', '**/*.ts')]);
  assert.deepStrictEqual(t.byAgent['x'], ['a.ts']);
});

/* ═══ the sentence ════════════════════════════════════════════════════════ */

test('a clean division says NOTHING', () => {
  const t = territories(PATHS, [
    claim('payments-agent', 'services/payments/**'),
    claim('orders-agent', 'services/orders/**'),
  ]);
  /* A reassurance on every render of every single-agent run is noise, and noise
     is what makes the one time it matters easy to miss. */
  assert.strictEqual(territorySentence(t), null);
});

test('a conflict is named with the file and both agents', () => {
  const t = territories(PATHS, [claim('a', 'services/**'), claim('b', 'services/payments/**')]);
  const line = territorySentence(t)!;
  assert.match(line, /2 files claimed twice/);
  assert.match(line, /services\/payments\/charge\.ts \(a \+ b\)/);
});

test('a long conflict list is summarised, not pasted', () => {
  const many = Array.from({ length: 30 }, (_v, i) => `src/f${i}.ts`);
  const t = territories(many, [claim('a', 'src/**'), claim('b', '**/*.ts')]);
  assert.match(territorySentence(t)!, /and 27 more/);
});

test('the whole-repo claim gets the advice that actually fixes it', () => {
  const t = territories(PATHS, [claim('wide'), claim('other', 'services/orders/**')]);
  assert.match(territorySentence(t)!, /narrow the "Agent may edit" list/);
});
