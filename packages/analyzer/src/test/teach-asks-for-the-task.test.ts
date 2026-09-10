import assert from 'node:assert';
import { test } from 'node:test';

/*
 * THE TURN THAT HANDS THE LESSON BACK TO THE LEARNER.
 *
 * THE REPORTED SHAPE, verbatim from `tools/bench/out/teach-eval-sequence-*`:
 *
 *   "I am ready to proceed with the task. Please provide the specific question
 *    or instruction you would like me to address regarding the repository
 *    structure."
 *
 * Fifteen turns across the nine arm files do this -- 13 of the 102 that never
 * named their concept, against 2 of the 194 that did. They are `stub: true`,
 * 25 words, `stopReason: complete`, and they arrive at turns 1, 2 and 3 of a
 * lesson already underway, with a queue of concepts waiting.
 *
 * The contract bans it in as many words: "NEVER ask a CLARIFYING question --
 * not one, not at the open, not mid-lesson, not at the close... A clarifying
 * question asks the learner to choose the scope, pick a direction, name a
 * format, or supply something you could look up yourself." Asking the learner
 * to supply the question IS the banned shape, in its purest form.
 *
 * WHY A NEW CHECK RATHER THAN A LOUDER CLAUSE -- the trap this tree has paid
 * for four times. The clause is present and unconditional; §4 of
 * `docs/research/teach-mode-driven-end-to-end.md` verified it by dumping the
 * composed belt. Neither existing check names this fault:
 *
 *   - the TOOL_VOCAB clarifying rule requires a `?` in the sentence AND one of
 *     our own format words. "Please provide the specific question..." has
 *     neither, and it is a request, not a question;
 *   - the closing-beat rule fires, but says "your reply does not END with the
 *     closing check-in question the contract requires" -- which diagnoses
 *     PUNCTUATION. The recorded turns ran 4 to 6 rounds against that bounce and
 *     never recovered, because it names the wrong fault: the reply's problem is
 *     not that it lacks a question mark, it is that it contains no lesson.
 *
 * WHAT THIS TEST DOES NOT CLAIM: that naming the fault fixes the behaviour.
 * That is a bench question and would need a registered arm. What it fixes today
 * is that the violation is INVISIBLE -- it is scored as a punctuation slip in
 * `contractProblems`, so nobody counting bounces can see it.
 */

/*
 * LOWERCASE ON PURPOSE: both sets are compared case-folded (the bench builds
 * `readBasenames` with `.toLowerCase()`), so a mixed-case fixture makes the
 * grader report `planMode.ts` as a file that does not exist and the control
 * cases fail for a reason that has nothing to do with the rule under test.
 */
const NAMES = new Set(['planmode.ts', 'index.ts']);
const READ = new Set(['planmode.ts', 'index.ts']);

/* Verbatim, from four different arm files. */
const REPORTED = [
  'I am ready to proceed with the task. Please provide the specific question or instruction you would like me to address regarding the repository structure.',
  'I am ready to proceed with the task. Please provide the specific question or point you would like me to address regarding the repository structure.',
  'I am ready to proceed with the next step. Please provide the specific question or task you would like me to address regarding the repository structure.',
];

test('THE REPORTED SHAPE: a turn that asks the learner to supply the task is a violation', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  for (const text of REPORTED) {
    const problems = gradeTeachTurn(text, NAMES, READ, true);
    assert.ok(
      problems.some((p) => p.includes('asks the learner to supply')),
      `must name the real fault, not the punctuation: ${problems.join(' | ')}`,
    );
  }
});

test('it fires even when the turn drew a visual and ends in a question mark', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  /*
   * The two non-stub instances close on a question, so a rule that only looked
   * at the closing beat would miss them. This one is the longest recorded
   * instance, shortened only where it repeats itself.
   */
  const text =
    'I will continue with the next point from your lesson. Please provide the specific ' +
    'question or concept you would like me to cover, and I will answer it using only the ' +
    'real repository structure from the digest. What would you like to learn about?';
  const problems = gradeTeachTurn(text, NAMES, READ, true);
  assert.ok(
    problems.some((p) => p.includes('asks the learner to supply')),
    `a question mark does not excuse it: ${problems.join(' | ')}`,
  );
});

test('a real lesson that closes on a comprehension check is NOT bounced by this rule', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  /*
   * THE FALSE POSITIVE THIS RULE COULD CAUSE, tested rather than asserted. A
   * comprehension question and a prediction prompt both ask the learner
   * something; neither asks them to supply the task.
   */
  const lesson =
    'planMode.ts holds the plan-mode state machine, and acp/src/index.ts is its only caller. ' +
    'So what do you think happens when a plan is accepted twice?';
  const problems = gradeTeachTurn(lesson, NAMES, READ, true);
  assert.deepStrictEqual(problems, [], `a clean lesson must stay clean: ${problems.join(' | ')}`);

  const prediction =
    'planMode.ts holds the plan-mode state machine. Which file do you think calls it first?';
  assert.deepStrictEqual(gradeTeachTurn(prediction, NAMES, READ, true), []);
});

test('an offer to continue the lesson is still allowed — the contract permits it mid-lesson', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  /*
   * "Shall we look at why the scanner does this ahead of time?" is named in the
   * contract as FINE. This rule must not quietly outlaw it: it offers the next
   * step of a lesson already underway rather than asking the learner to supply
   * the subject.
   */
  const text =
    'planMode.ts holds the plan-mode state machine, and index.ts calls it. Shall we look at ' +
    'why it rejects a second plan?';
  const problems = gradeTeachTurn(text, NAMES, READ, true);
  assert.ok(
    !problems.some((p) => p.includes('asks the learner to supply')),
    `an offer to continue is not asking for the task: ${problems.join(' | ')}`,
  );
});
