import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

/**
 * THE BENCH MUST RECORD FABRICATION.
 *
 * The belt condition registered "fabrication must not rise" as the kill that
 * mattered most — the whole risk of removing tool instructions was that a model
 * with fewer constraints would invent things. The run reported it UNMEASURABLE,
 * because `claims.unsupportedTechnologies` is produced by the pipeline and was
 * never recorded by the bench.
 *
 * That is a threshold registered against a quantity the INSTRUMENT cannot
 * produce — distinct from the sixth law, which is about what the CHANGE can
 * move. These cases exist so it cannot recur silently.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const BENCH = fs.readFileSync(path.join(HERE, '..', 'bench', 'teach-eval.mjs'), 'utf8');

test('the bench records the fabrication count per turn', () => {
  /*
   * The spelling changed on 2026-09-07 and the property did not. This asserted
   * the literal `claims: result?.claims`, which was the whole record when the
   * bench only stored a claims object if the pipeline produced one.
   *
   * It now always stores one, because the pipeline sets the field ONLY when
   * there are findings — deliberately, per `claim-check-stream.test.ts` — which
   * made a clean answer and an unrun check identical from out here. That was
   * the third distinct reason the fabrication clause failed to measure.
   *
   * So the case still says the count comes from the PIPELINE RESULT and not
   * from somewhere the bench made up, and it now also demands the `ran` flag
   * that gives the count a denominator.
   */
  assert.match(BENCH, /result\?\.claims/, 'claims is read off the pipeline result');
  assert.match(BENCH, /unsupportedTechnologies:/, 'and the count is recorded');
});

test('it records whether the check RAN, so a zero has a denominator', () => {
  /*
   * `claims` absent means "no findings" OR "never checked", and the flags that
   * would separate them live inside the absent field. Without this, a zero
   * fabrication count is the reassuring kind of nothing.
   */
  assert.match(BENCH, /const ran = text\.trim\(\)\.length > 0/);
  assert.match(BENCH, /unsupportedTechnologies: 0, unsupportedTerms: \[\], unknownPaths: 0, checked: null, ran/);
  assert.match(BENCH, /claimsRan/, 'and the run reports how many turns it ran on');
});

test('it records WHICH terms, not only how many', () => {
  /* A count says fabrication rose; the terms say what was invented, which is the
     difference between a number to act on and a number to worry about. */
  assert.match(BENCH, /unsupportedTerms:/);
});

test('it records `checked` — a zero from a check that did not run is not a zero', () => {
  /*
   * The claim check says so itself: "an empty finding list from a check that
   * could not run is not a clean bill of health". Recording the count without
   * the flags would reproduce, one layer out, exactly the vacuity this whole
   * repository keeps finding — a green that describes nothing.
   */
  assert.match(BENCH, /checked: result\.claims\.checked/);
});

test('the three sibling diagnostics are all recorded together', () => {
  /*
   * stopReason, checkInSkipped and claims are produced side by side by the
   * pipeline and answer the three questions a refuted run asks: why did the turn
   * stop, why was no check-in derived, and did it make anything up. Two of the
   * three were added only after a run failed for want of them.
   */
  for (const field of ['stopReason:', 'checkInSkipped:', 'claims:']) {
    assert.ok(BENCH.includes(field), `${field} must be recorded on every turn`);
  }
});
