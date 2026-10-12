import type { Coverage } from '../state/types';

/**
 * THE CUT, IN WORDS, BESIDE THE ANSWER.
 *
 * CANON: coverage is "the single strongest thing we have and nothing else on the
 * list is close" — Codex and Claude Code structurally CANNOT say what they did
 * not read, because neither holds a complete model of the repository to subtract
 * a read-set from. We can.
 *
 * And we were not saying it. The engine computed it, the wire carried it, the
 * store kept it, and the rail used it to tint per-file badges — while
 * `packagesMissed`, which IS the cut, appeared in exactly one place outside
 * tests: a specimen fixture. The strongest claim in the product was never put in
 * front of the person reading the answer.
 *
 * Pure and string-returning so the sentence is testable without a renderer, and
 * so the wording lives in one place rather than being re-derived by every
 * surface that wants to say it.
 */

/** How many missed components to name before counting the rest. */
const NAMED_LIMIT = 3;

/** `2326` → `2,326`. The denominator is the point; it should be readable. */
function group(n: number): string {
  return n.toLocaleString('en-US');
}

export function coverageSentence(coverage: Coverage | null): string | null {
  if (!coverage) return null;

  /*
   * NO DENOMINATOR, NO CLAIM. A graph with no edges makes "0 of 0", which reads
   * as a failure to look rather than as nothing to look at — and coverage is the
   * one number in this product that must never be able to mislead downward.
   * Withheld entirely; the answer simply carries no line.
   */
  if (coverage.edgesTotal <= 0) return null;

  const head = `answered from ${group(coverage.edgesSeen)} of ${group(coverage.edgesTotal)} edges`;
  const missed = coverage.packagesMissed;

  /*
   * EMPTY IS A FINDING. For a whole-system ask, ranked selection reaches every
   * component and the loss shows up as depth rather than absence — so silence
   * here would be read as "we did not check", which is the opposite of true.
   */
  if (missed.length === 0) return `${head} — every component contributed`;

  const named = missed.slice(0, NAMED_LIMIT);
  const rest = missed.length - named.length;
  /* A truncated list carries its own remainder. A list that simply stops is a
   * lie about how much was cut, and this is the sentence that must not lie. */
  const list = rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.join(', ');
  const noun = missed.length === 1 ? 'component' : 'components';

  return `${head} — ${missed.length} ${noun} contributed nothing: ${list}`;
}
