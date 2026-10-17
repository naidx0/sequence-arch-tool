import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { coverageTool } from '../index.js';

/**
 * The monorepo root, found by walking UP for the workspace file.
 *
 * Never from `process.cwd()`: the first version of this file munged the cwd with
 * a regex, silently resolved to `packages/mcp` instead of the root, and scanned
 * a package with no Python in it — so the absence claim came back ENTITLED and
 * the test failed for a reason that had nothing to do with the code under test.
 */
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the workspace root from ' + import.meta.url);
}

/**
 * NO VERB ANSWERS PAST scanCoverage.
 *
 * The one thing no surveyed tool does is record what the scan did not read and
 * let that GATE the answer. CodeQL measures its own extraction failures and puts
 * them on an ops dashboard; nothing carries the verdict into the answer path.
 * This is that verdict, reachable by an agent, in prose it can act on.
 *
 * IT EXTENDS `coverage` RATHER THAN ADDING A RIVAL VERB, and asks `scanCoverage`
 * instead of reading `graph.unfollowed` itself. Two tools answering "what did you
 * miss" would drift, and reading one signal of three is how this repo already
 * produced a confident false negative: measured 2026-08-22, 59 tracked source
 * files were absent from the graph while `unfollowed` reported `[]` — its own
 * contract's words for "looked, and everything was readable".
 */

const parse = (r: Awaited<ReturnType<typeof coverageTool>>): any =>
  JSON.parse(r.content[0]!.text);

test('the verb reports what the walk never entered, on the real repository', async () => {
  const r = await coverageTool({ repoPath: repoRoot() });
  assert.equal(r.isError, undefined, r.content[0]?.text);
  const out = parse(r);

  assert.ok(out.scanCoverage, 'coverage verdict must be on the payload');
  assert.ok(
    ['complete', 'partial', 'unknown'].includes(out.scanCoverage.verdict),
    `unexpected verdict: ${out.scanCoverage.verdict}`,
  );
  /* This repository is partial — tools/ and examples/ sit outside every scanned
     service — so the answer must SAY an absence here proves nothing. */
  if (out.scanCoverage.verdict === 'partial') {
    assert.match(out.answer, /not an absence in the repository/);
    assert.ok(out.scanCoverage.neverVisited.length > 0, 'partial must name what it missed');
  }
});

test('an ABSENCE CLAIM is refused when the extension sits in an unread region', async () => {
  /*
   * The gate itself. This repository holds Python under `tools/` and `examples/`,
   * which the walk never enters — so "there is no Python here" is a claim the
   * scan is NOT entitled to make, and the verb must say so in words an agent
   * will act on rather than leaving it to be inferred from a percentage.
   */
  const py = parse(await coverageTool({ repoPath: repoRoot(), claimExtension: '.py' }));
  assert.equal(py.absenceClaimEntitled, false);
  assert.match(py.answer, /DO NOT say "there is no \.py here"/);
  assert.match(py.answer, /neither\s+confirm nor rule it out/);
});

test('COMPLETE is never reported as unknown, and UNKNOWN is never reported as complete', async () => {
  /*
   * The two failures this lock exists for, and they are opposite.
   *
   * Reporting complete-as-unknown makes the tool useless: every absence becomes
   * "cannot tell" and an agent learns to ignore it. Reporting unknown-as-complete
   * is the dangerous one — it licenses exactly the confident false negative the
   * verdict exists to prevent.
   *
   * Driven through the real payload rather than the helper, because the helper is
   * already locked in schema; what is unproven is that the VERB carries the
   * verdict faithfully.
   */
  const out = parse(await coverageTool({ repoPath: repoRoot() }));
  const { verdict, neverVisited, truncated } = out.scanCoverage;

  if (verdict === 'complete') {
    assert.equal(truncated, false, 'a truncated walk can never be complete');
    assert.deepStrictEqual(neverVisited, [], 'complete must have nothing unvisited');
    assert.match(out.answer, /absence in this graph is evidence/);
  } else {
    assert.doesNotMatch(
      out.answer,
      /absence in this graph is evidence of an absence/,
      'a non-complete scan must never claim its absences are evidence',
    );
  }
});
