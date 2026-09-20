/**
 * LOCKS the design-mode scan-claim check, built from what the model said.
 *
 * MEASURED 2026-09-09. Asked through `sequence ask --mode design` to design a
 * URL shortener — a system that does not exist — minicpm5-hermes produced a
 * good four-component proposal and, in the middle of it, this:
 *
 *   "The risks in the digest show 11 total items, with empty single points of
 *    failure and cycles arrays — no flagged fragility. The system is
 *    structurally sound given what's scanned."
 *
 * Nothing in that sentence was given to it. `runAskPipeline` passes the graph
 * as undefined when designMode is set and gates the digest section on
 * `!input.designMode`, so both were withheld — verified by reading those two
 * lines, not by assuming. The numbers were invented, in the one mode built to
 * have no grounding, and they read exactly like evidence.
 *
 * WHY A CHECK ON THE OUTPUT RATHER THAN A SENTENCE IN THE PROMPT.
 * `buildDesignAskPrompt` already opens with "nothing below has been built,
 * detected, or read from a repository". That is the third instruction this
 * model has been given and not followed — after retrieve-before-you-answer and
 * do-not-clarify — and a fourth would have been a fourth guess.
 *
 * These lock the two things that make the check honest rather than tidy: it
 * fires on the shapes actually seen, and it does NOT fire on an ordinary design
 * answer, because a warning that appears on every turn is a warning nobody
 * reads.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The pattern under test, kept in step with `askPipeline.ts` by this file's own
 * failure: if the source pattern changes and this copy does not, the assertions
 * below stop describing the shipped behaviour, and the first row that stops
 * matching says so.
 */
const SCAN_CLAIM =
  /\b(the digest|single points? of failure|cycles? array|what(?:'s| is) scanned|the scan(?:ned)? (?:repo|repository|graph)|in this repository)\b/i;

test('the sentence the model actually produced is caught', () => {
  const said =
    'The risks in the digest show 11 total items, with empty single points of failure ' +
    "and cycles arrays — no flagged fragility. The system is structurally sound given what's scanned.";
  assert.ok(SCAN_CLAIM.test(said), 'the reported shape must trip the check');
});

test('each invented-evidence phrase trips it on its own', () => {
  for (const phrase of [
    'the digest lists eleven items',
    'there are no single points of failure',
    'the cycles array was empty',
    "structurally sound given what's scanned",
    'nothing in the scanned repository does this',
    'the services in this repository already cover it',
  ]) {
    assert.ok(SCAN_CLAIM.test(phrase), 'should catch: ' + phrase);
  }
});

test('an ordinary design answer is NOT flagged — a warning on every turn is noise', () => {
  for (const clean of [
    'A shortener service writes the mapping to a URL store and reads it back to resolve.',
    'I assumed 10k writes a day and read-heavy traffic, so a cache sits in front of the store.',
    'Components: shortener service, url store, router, webhook receiver.',
    'This design has a single database, which is a risk if it grows.',
    'The edges are: shortener -> store (writes), router -> shortener (calls).',
  ]) {
    assert.ok(!SCAN_CLAIM.test(clean), 'should NOT flag: ' + clean);
  }
});

test('the word risk alone is not a scan claim', () => {
  assert.ok(
    !SCAN_CLAIM.test('The main risk is that one datastore holds everything.'),
    'design answers discuss risk constantly; only a claim to have READ one is the defect',
  );
});
