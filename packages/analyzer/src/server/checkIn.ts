/**
 * DOES THIS TURN END WITH A CHECK, or merely with a question mark?
 *
 * Every check-in number reported on 2026-09-05 — 22 of 47, 12, 18, 19 — was
 * `/\?\s*$/.test(text.trim())`: a trailing question mark. Measured against the
 * contract's own taxonomy, 15 of the 31 questions those turns produced are
 * CLARIFYING — "would you like me to show the diagram?" — which the belt bans
 * outright:
 *
 *   "NEVER ask a CLARIFYING question — not one, not at the open, not mid-lesson,
 *    not at the close. THE TEST: if their answer would change what you do next,
 *    it is clarifying and it is banned; if it only reveals whether they followed
 *    you, it is a comprehension check and it is wanted."
 *
 * So the metric was satisfied by the one shape the contract forbids, and every
 * comparison built on it was measuring "ends with a question", not "ends with a
 * check". This module is the second thing, and the two are reported side by side
 * rather than one quietly replacing the other.
 *
 * ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────────
 *
 * Phrase matching. It is the right instrument for "is this an offer or a check"
 * and the wrong one for anything finer, so the counts it produces are FLOORS:
 * a check it fails to recognise is counted as not-a-check, which biases the
 * number down. That is the safe direction for a metric a turn is graded on.
 */

/**
 * "Would you like me to…", "shall I…", "do you want…" — an offer to do more
 * work. The learner's answer changes what happens next, which is the contract's
 * own test for a clarifying question.
 */
const CLARIFYING =
  /\b(would you like|would you prefer|shall i|should i|do you want|want me to|like me to|shall we look|anything else|you.?d like to (know|see|hear))\b/i;

/** "Do you understand…", "does that make sense…" — a check on what was just said. */
const COMPREHENSION =
  /\b(do you (understand|see|follow|recall|remember)|does (this|that) make sense|make sense so far|can you (tell me|say|explain)|what did .{0,20}just|which .{0,40}(did|does) (we|it|the))\b/i;

/** "What do you think happens…", "which component…", "predict…" — a guess before the reveal. */
const PREDICTION =
  /\b(do you think|would you expect|predict|what (happens|breaks|would break|goes wrong)|what do you expect)\b/i;

/**
 * The contract's own category labels, which are vocabulary for US and not
 * something a learner should ever read. A turn that opens its closing question
 * with "Check-in:" copied the belt rather than writing a question.
 */
const PARROTED_LABEL = /^\s*(check-?in|comprehension question|prediction prompt|pulse check)\s*:/i;

/**
 * THE CONTRACT'S OWN CLOSING EXAMPLES, OWNED HERE SO THE GRADER AND THE BELT
 * CANNOT DRIFT APART.
 *
 * `askPipeline` builds the closing-beat instruction from these strings, and the
 * check below flags a closing question that is one of them copied whole. That
 * direction matters: an example edited in the belt moves the detector with it,
 * where two hand-kept copies would silently disagree the first time either was
 * touched.
 *
 * A verbatim copy is a defect whatever the example says, because the question
 * has to be about THIS lesson. The example names a service that appears in no
 * fixture on purpose -- copied into a lesson about anything else it is
 * obviously wrong, to a reader as well as to this test.
 */
export const TEACH_CLOSING_COMPREHENSION_EXAMPLE = 'does this make sense so far?';
export const TEACH_CLOSING_PREDICTION_EXAMPLE =
  'which component do you think the auth service calls next?';

/** Lowercase, no punctuation, single-spaced -- for comparing two sentences. */
const normaliseSentence = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * ONLY THE PREDICTION EXAMPLE. The comprehension phrase is generic by design --
 * "does this make sense so far?" is the intended output, not a copy of it, and
 * flagging it would quietly change the comprehension-vs-prediction balance that
 * the registered mid-length arm exists to measure. The prediction example names
 * a component, so reusing it verbatim is always wrong: it asks about a service
 * this lesson is not about.
 */
const COPIED_WHOLE = new Set([TEACH_CLOSING_PREDICTION_EXAMPLE].map(normaliseSentence));

/**
 * A PLACEHOLDER LEFT UNSUBSTITUTED, which is the shape actually measured.
 *
 * Three of thirteen closing checks across two 20-conversation runs read
 * "Which component do you think X talks to next?" -- the belt's own template
 * variable, emitted literally. A question with a placeholder in it is not a
 * question the learner can answer, so it counts as no check at all.
 *
 * DELIBERATELY NARROW, because `X` is a REAL name in this bench's own fixtures:
 * makemore calls its tensors `X` and `Y`, and a lesson about them may say `X`
 * perfectly legitimately. So a bare letter is not enough -- the pattern requires
 * a structural noun, then the standalone letter, then a verb it is the subject
 * of. "Which component of X is largest?" does not match, and must not.
 */
const PARROTED_PLACEHOLDER =
  /\b(component|module|service|node|file)\b[^?]*\bX\b\s+(talks|calls|does|sends|processes|handles|returns|reads|writes)\b/i;

export type CheckShape = 'comprehension' | 'prediction' | 'clarifying' | 'unclassified' | 'none';

export interface CheckInVerdict {
  /** Did the turn end with a question of ANY shape? The old metric, kept. */
  endsWithQuestion: boolean;
  /** Did it end with a question the contract actually wants? */
  endsWithCheck: boolean;
  shape: CheckShape;
  /** The closing question itself, for a report that wants to show its working. */
  question?: string;
  /** Present when a label was parroted into the visible text. */
  parrotedLabel?: boolean;
  /**
   * Present when the closing question is the belt's example copied whole, or
   * still carries its placeholder. Either way the learner was not asked
   * anything about THIS lesson, so it is not a check.
   */
  parrotedExample?: boolean;
}

/**
 * The closing question of a turn — the last sentence, if it is one.
 *
 * Fenced blocks are stripped first: a `?` inside a code sample is not a question
 * put to the learner.
 */
const closingQuestion = (text: string): string | undefined => {
  const unfenced = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').trim();
  if (!/\?\s*$/.test(unfenced)) return undefined;
  const sentences = unfenced.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1]?.trim();
  return last === undefined || last === '' ? undefined : last;
};

export function gradeCheckIn(text: string): CheckInVerdict {
  const question = closingQuestion(text);
  if (question === undefined) {
    return { endsWithQuestion: false, endsWithCheck: false, shape: 'none' };
  }

  const parrotedLabel = PARROTED_LABEL.test(question);
  const bare = question.replace(PARROTED_LABEL, '').trim();

  /*
   * CLARIFYING IS TESTED FIRST, and wins even when the sentence also contains a
   * comprehension phrase. "Would you like me to show how the softmax
   * probabilities are used?" reads as a prediction to a keyword matcher and is
   * an offer to the learner — and the contract bans it on what the ANSWER would
   * do, not on the words. When both fire, the offer is what the learner replies
   * to.
   */
  if (CLARIFYING.test(bare)) {
    return {
      endsWithQuestion: true,
      endsWithCheck: false,
      shape: 'clarifying',
      question,
      ...(parrotedLabel ? { parrotedLabel } : {}),
    };
  }
  /*
   * A COPY OR A PLACEHOLDER IS NOT A CHECK, even though it is shaped like one.
   * Reported as `unclassified` rather than as the shape it imitates, because
   * `unclassified` already means "not a check" everywhere that reads this, and a
   * `prediction` carrying `endsWithCheck: false` would be counted as a
   * prediction by anything tallying shapes -- including my own report of these
   * runs. `parrotedExample` keeps the fact that it reached for one.
   */
  if (COPIED_WHOLE.has(normaliseSentence(bare)) || PARROTED_PLACEHOLDER.test(bare)) {
    return {
      endsWithQuestion: true,
      endsWithCheck: false,
      shape: 'unclassified',
      question,
      parrotedExample: true,
      ...(parrotedLabel ? { parrotedLabel } : {}),
    };
  }
  if (COMPREHENSION.test(bare)) {
    return { endsWithQuestion: true, endsWithCheck: true, shape: 'comprehension', question, ...(parrotedLabel ? { parrotedLabel } : {}) };
  }
  if (PREDICTION.test(bare)) {
    return { endsWithQuestion: true, endsWithCheck: true, shape: 'prediction', question, ...(parrotedLabel ? { parrotedLabel } : {}) };
  }
  /*
   * Unclassified is NOT a check. 14 of the 31 measured questions land here, and
   * counting them would mean grading a turn on a matcher's silence. The floor is
   * deliberate: a real check this fails to recognise costs the turn a point,
   * which is the direction that cannot flatter the contract.
   */
  return {
    endsWithQuestion: true,
    endsWithCheck: false,
    shape: 'unclassified',
    question,
    ...(parrotedLabel ? { parrotedLabel } : {}),
  };
}
