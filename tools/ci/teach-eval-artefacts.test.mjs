/**
 * THE BENCH'S TWO REFUSALS, MADE TO FIRE.
 *
 * Mechanism A cost 8,797 seconds of card and returned one of four registered
 * clauses. Not because the data was never produced — `claims`, `stub` and
 * `conceptGiven` were recorded on every turn of every arm — but because every
 * arm wrote to one path and overwrote the last, and the scoreboard printed
 * happily over what was left. Four exit codes of zero.
 *
 * Two refusals came out of that, and a refusal nobody has made fire is a
 * decoration. These cases fire them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { armFileName, artefactGaps, wouldClobberAnotherRun } from '../bench/lib/arm-identity.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const BENCH = fs.readFileSync(path.join(HERE, '..', 'bench', 'teach-eval.mjs'), 'utf8');

const turn = (over = {}) => ({
  claims: { unsupportedTechnologies: 0, ran: true },
  stub: false,
  conceptGiven: 'c',
  ...over,
});
const convo = (turns) => ({ score: { errored: false }, turns });

test('ARM IDENTITY — two arms of a four-arm run cannot land on one filename', () => {
  /* The exact run that lost three arms: same repo, same instant granularity,
     differing only in the flag under test. */
  const base = { repo: 'sequence', refs: false, trim: false, startedAt: '2026-09-07T01:23:26.000Z' };
  const control = armFileName({ ...base, wire: false });
  const treat = armFileName({ ...base, wire: true });
  assert.notEqual(control, treat, 'the flag under test must change the filename');
  assert.match(control, /nowire/);
  assert.match(treat, /-wire-/);
});

test('ARM IDENTITY — two runs of the SAME configuration still differ', () => {
  /* Two runs a side is the replication rule, so identical configurations are
     the normal case, not an edge case. */
  const base = { repo: 'sequence', wire: true, refs: false, trim: false };
  const a = armFileName({ ...base, startedAt: '2026-09-07T01:23:26.000Z' });
  const b = armFileName({ ...base, startedAt: '2026-09-07T02:10:04.000Z' });
  assert.notEqual(a, b);
});

test('ARM IDENTITY — nothing has to be remembered for that to hold', () => {
  /* The first fix put the name in an env var, which is a fix whose failure mode
     is the failure it prevents. No override here, and the names still differ. */
  const n = armFileName({ repo: 'sequence', wire: false, refs: true, trim: false, startedAt: 'X' });
  assert.match(n, /norefs|refs/);
  assert.doesNotMatch(n, /undefined/);
});

test('the filename carries no path separators, so an arm cannot escape its directory', () => {
  const n = armFileName({ repo: '../../etc', wire: false, refs: false, trim: false, startedAt: 'X' });
  /* A repo name is operator-supplied, but a traversal here would write outside
     the out directory, and this is the only place that name becomes a path. */
  assert.ok(!n.includes('/') && !n.includes('\\'), `arm name must not contain a separator: ${n}`);
});

test('ARTEFACT GATE — a complete run passes', () => {
  const { checked, claimsRan, broken } = artefactGaps([convo([turn(), turn()]), convo([turn()])]);
  assert.equal(checked, 3);
  assert.equal(claimsRan, 3);
  assert.deepEqual(broken, []);
});

test('ARTEFACT GATE — a stub turn counts as checked but NOT as claim-checked', () => {
  /*
   * The third reason fabrication failed to measure: the product sets `claims`
   * only when there are findings, so a clean answer and an unrun check looked
   * identical. `ran` separates them, and a fabrication zero is read against
   * claimsRan — a stub turn produced no text, so the check could not have found
   * anything, and counting it would inflate the denominator toward a
   * reassuring zero.
   */
  const { checked, claimsRan, broken } = artefactGaps([
    convo([turn(), turn({ claims: { unsupportedTechnologies: 0, ran: false }, stub: true })]),
  ]);
  assert.equal(checked, 2);
  assert.equal(claimsRan, 1, 'the stub turn must not count toward the fabrication denominator');
  assert.deepEqual(broken, []);
});

test('ARTEFACT GATE — the fabrication clause missing is caught', () => {
  /* claims has now been unmeasured twice for two different reasons. This is the
     case that would have said so before the scoreboard printed. */
  const { broken } = artefactGaps([convo([turn(), turn({ claims: undefined })])]);
  assert.deepEqual(broken.map(([k]) => k), ['claims']);
  assert.equal(broken[0][1], 1);
});

test('ARTEFACT GATE — a missing stub or concept is caught too', () => {
  const { broken } = artefactGaps([convo([turn({ stub: undefined, conceptGiven: undefined })])]);
  assert.deepEqual(broken.map(([k]) => k).sort(), ['conceptGiven', 'stub']);
});

test('ARTEFACT GATE — an ERRORED turn is exempt, so the gate does not fire on the one case it should not', () => {
  /* A turn that never reached the provider has nothing to record. A gate that
     fired here would be one everyone learned to ignore. */
  const { checked, broken } = artefactGaps([convo([turn(), { error: 'timeout' }])]);
  assert.equal(checked, 1);
  assert.deepEqual(broken, []);
});

test('ARTEFACT GATE — a run with nothing clean reports zero checked, and the bench exits on that', () => {
  const { checked } = artefactGaps([{ score: { errored: true }, turns: [turn()] }]);
  assert.equal(checked, 0);
  assert.match(BENCH, /if \(checked === 0\)/, 'the bench must refuse a run that scored nothing');
});

test('the bench CALLS both refusals and exits non-zero, rather than warning', () => {
  /* The peer instruction this came from: a run that produced three quarters of
     nothing must not be able to end with four zeros. */
  assert.match(
    BENCH,
    /import \{ armFileName, artefactGaps, wouldClobberAnotherRun \} from '\.\/lib\/arm-identity\.mjs'/,
  );
  assert.match(BENCH, /const \{ checked, claimsRan, broken \} = artefactGaps\(results\)/);
  /* The denominator must travel with the number, in the bench's own output. */
  assert.match(BENCH, /the claim check RAN on \$\{claimsRan\} of them/);
  assert.match(BENCH, /const armName = armFileName\(\{/);
  assert.match(
    BENCH,
    /wouldClobberAnotherRun\(\{ exists: armExists, priorWhen, runStartedAt: RUN_STARTED_AT \}\)/,
    'an arm must refuse to overwrite ANOTHER arm — and must not refuse its own incremental rewrite',
  );
  assert.match(BENCH, /process\.exit\(3\)/);
  assert.match(BENCH, /process\.exit\(5\)/);
  /* And the write is asserted, not merely performed. */
  assert.match(BENCH, /persisted = JSON\.parse\(fs\.readFileSync\(armPath, 'utf8'\)\)/);
  assert.match(BENCH, /process\.exit\(4\)/);
});

test('OVERWRITE GUARD — a run may rewrite its OWN file, because the writer is incremental', () => {
  /*
   * THE CASE THAT WAS MISSING, and its absence killed all four arms of a re-run
   * inside four minutes each. The report is rewritten after every conversation
   * so a crashed run keeps what it had; the first guard refused any existing
   * file, so conversation 2 of every arm hit conversation 1's write.
   *
   * The smoke run before that re-run used ONE conversation — sized below the
   * failure it existed to reveal, so it passed and the four arms did not.
   */
  const now = '2026-09-07T04:14:41.817Z';
  assert.equal(
    wouldClobberAnotherRun({ exists: true, priorWhen: now, runStartedAt: now }),
    false,
    "a run must be allowed to rewrite its own incremental report",
  );
});

test("OVERWRITE GUARD — another run's file still refuses", () => {
  assert.equal(
    wouldClobberAnotherRun({
      exists: true,
      priorWhen: '2026-09-07T01:23:26.000Z',
      runStartedAt: '2026-09-07T04:14:41.817Z',
    }),
    true,
  );
});

test('OVERWRITE GUARD — an unreadable or unstamped file refuses rather than guessing', () => {
  const at = '2026-09-07T04:14:41.817Z';
  assert.equal(wouldClobberAnotherRun({ exists: true, priorWhen: null, runStartedAt: at }), true);
  assert.equal(wouldClobberAnotherRun({ exists: true, priorWhen: '', runStartedAt: at }), true);
});

test('OVERWRITE GUARD — a fresh path is never a clobber', () => {
  assert.equal(wouldClobberAnotherRun({ exists: false, priorWhen: null, runStartedAt: 'X' }), false);
});
