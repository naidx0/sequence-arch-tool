/**
 * THE TURNS A CONVERSATION IS SCRIPTED FOR, with an optional floor.
 *
 * CONDITION A of `docs/research/ceiling-condition-registration.md`. The
 * next-picture band was killed at 3 reveals of 11 because SEVEN of the eleven
 * questions were asked on their conversation's final turn, where no reveal can
 * follow. The bank's sequence conversations are two and three turns; a question
 * asked at the end of a two-turn lesson has nowhere to land however well the
 * carrier works.
 *
 * THE SCRIPT ONLY. No product code, no check-in logic, nothing about WHEN a
 * question is asked — so a change in landable questions is attributable to the
 * length and to nothing else. That separation is the whole reason A and B are
 * registered as two conditions rather than one arm.
 *
 * Its own module because `teach-eval.mjs` runs a bench on import: a test that
 * imported the function from there would start a card run to check a `while`
 * loop.
 */

/** The learner's scripted acknowledgement, the same one the bank already uses. */
export const GOT_IT = 'Got it, that makes sense. Continue to the next point.';

/**
 * `minTurns` of 0 or absent leaves the conversation exactly as written, byte for
 * byte — which is what keeps every arm already on record comparable.
 */
export function scriptedTurns(convo, minTurns) {
  const qs = [convo.question, ...convo.replies];
  while (minTurns > 0 && qs.length < minTurns) qs.push(GOT_IT);
  return qs;
}
