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

import type { SeqChart } from '@sequence/schema';

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
 * has to be about THIS lesson.
 *
 * THE PREDICTION EXAMPLE NAMES NOTHING ON ITS OWN (2026-09-22). It used to name
 * "the auth service", chosen because no fixture has one — and the live baseline
 * on ML Harness ended BOTH Teach-off runs with it word for word: "Which
 * component do you think the auth service calls next? You can also draw it on
 * the board." ML Harness has no auth service. A generic example beside a
 * specific repository is read as being about that repository. So the belt now
 * builds the example from the turn's own graph ({@link teachPredictionExample}),
 * and with no graph it describes the shape and names no component.
 */
export const TEACH_CLOSING_COMPREHENSION_EXAMPLE = 'does this make sense so far?';
export const TEACH_CLOSING_PREDICTION_EXAMPLE =
  'which part do you think <the part you just explained> hands off to next?';
/** The example the baseline copied. Kept so a re-graded old transcript is still caught. */
export const TEACH_CLOSING_PREDICTION_EXAMPLE_MEASURED =
  'which component do you think the auth service calls next?';

/**
 * The prediction example for a turn: named after a real part of the attached
 * repository when there is one, the shape-only form when there is not.
 */
export function teachPredictionExample(label?: string): string {
  const name = label?.trim();
  return name ? `which part do you think ${name} hands off to next?` : TEACH_CLOSING_PREDICTION_EXAMPLE;
}

/** Lowercase, no punctuation, single-spaced -- for comparing two sentences. */
const normaliseSentence = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * ONLY THE PREDICTION EXAMPLE. The comprehension phrase is generic by design --
 * "does this make sense so far?" is the intended output, not a copy of it, and
 * flagging it would quietly change the comprehension-vs-prediction balance that
 * the registered mid-length arm exists to measure. The prediction example names
 * a component or carries a placeholder, so reusing it verbatim is always wrong:
 * it asks about a part this lesson is not about, or about no part at all.
 */
const COPIED_WHOLE = new Set(
  [TEACH_CLOSING_PREDICTION_EXAMPLE, TEACH_CLOSING_PREDICTION_EXAMPLE_MEASURED].map(normaliseSentence),
);

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

/** The shape-only example's own placeholder, emitted with or without its brackets. */
const SHAPE_PLACEHOLDER = /\bthe part you just explained\b/i;

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

/*
 * THE HARNESS'S NOTES ARE NOT THE LESSON'S CLOSING BEAT (2026-09-23). The repair
 * notes go after the check-in — "(Sequence marked hwdetect.py as named without
 * being read this turn …)" — so the reader is told what was changed, and the
 * lesson still closes on its question. Read with the notes as its last line, a
 * repaired turn ended on a parenthesis, and the lesson it taught did not count
 * as ending on a check.
 */
const HARNESS_NOTES_TAIL = /(?:\n\s*\((?:Sequence|The rewrite)\b[^\n]*\)\s*)+$/;

/**
 * The closing question of a turn — the last sentence, if it is one.
 *
 * Fenced blocks are stripped first: a `?` inside a code sample is not a question
 * put to the learner.
 */
const closingQuestion = (text: string): string | undefined => {
  const unfenced = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(HARNESS_NOTES_TAIL, '')
    .trim();
  if (!/\?\s*$/.test(unfenced)) return undefined;
  const sentences = unfenced.split(/(?<=[.!?])\s+/);
  const last = sentences[sentences.length - 1]?.trim();
  return last === undefined || last === '' ? undefined : last;
};

/**
 * `examples` are the closing examples THIS turn's belt rendered — the one built
 * from the repository's own graph — so a turn that copies it whole is caught
 * the same way a copy of the static one is.
 */
export function gradeCheckIn(text: string, examples: readonly string[] = []): CheckInVerdict {
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
  const said = normaliseSentence(bare);
  if (
    COPIED_WHOLE.has(said) ||
    examples.some((e) => normaliseSentence(e) === said) ||
    PARROTED_PLACEHOLDER.test(bare) ||
    SHAPE_PLACEHOLDER.test(bare)
  ) {
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

/** A question put to the reader: it speaks to them, or it is a check by its shape. */
const TO_THE_READER = /\b(?:you|your)\b/i;

/**
 * DOES THE CLOSING PARAGRAPH ALREADY ASK THE READER SOMETHING (Slice 11,
 * 2026-09-23)? Sixth measurement, r3: a draft closing on "Did this make sense so
 * far? Which part do you think ml-harness hands off to next?" came back
 * byte-identical from its bounce, the derived check-in was appended after it,
 * and the answer ended on three questions. Fences and the harness's own notes
 * are not the lesson's close.
 */
export function lastParagraphAsksReader(text: string): boolean {
  const body = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(HARNESS_NOTES_TAIL, '')
    .trim();
  const last = body.split(/\n\s*\n/).pop() ?? '';
  return last
    .split(/(?<=[.!?])\s+/)
    .some((s) => /\?\s*$/.test(s.trim()) && (TO_THE_READER.test(s) || COMPREHENSION.test(s) || PREDICTION.test(s)));
}

/*
 * ══ THE CHECK-IN IS APPENDED, NEVER BOUNCED FOR (2026-09-23) ════════════════
 *
 * The fourth measurement: every run spent its second provider call on "your
 * reply ends by OFFERING the learner a choice", the retry failed the same way
 * (`regrade-r3.txt`: call1 and call2 both), and the answers stayed at 82-208
 * words against the 250-350 the overview asks for. The harness already derives
 * a check-in from the picture it drew. So a closing offer — or a closing
 * question copied from the contract's example — is taken out here, and the
 * derived check-in is appended after it. Only the CLOSING question goes: a
 * comprehension question mid-lesson is what the mode wants, and it stays.
 */
export function removeClosingOffer(
  text: string,
  examples: readonly string[] = [],
): { text: string; removed?: string; copied?: boolean; list?: boolean } {
  const choice = closingChoiceList(text);
  if (choice !== undefined) return { text: choice.kept, removed: choice.removed, list: true };
  const verdict = gradeCheckIn(text, examples);
  if (verdict.question === undefined) return { text };
  if (verdict.shape !== 'clarifying' && verdict.parrotedExample !== true) return { text };
  const at = text.lastIndexOf(verdict.question);
  if (at < 0) return { text };
  const kept = `${text.slice(0, at).trimEnd()}${text.slice(at + verdict.question.length)}`.trimEnd();
  return { text: kept, removed: verdict.question, ...(verdict.parrotedExample === true ? { copied: true } : {}) };
}

/*
 * A QUESTION CLOSED BY A LIST TO PICK FROM IS A CHOICE OFFER (Slice 10,
 * 2026-09-23). Fifth measurement, r6's final: "Which part do you think
 * ml-harness hands off to next?" and then "- **providers** (model
 * selection/gateway)", "- **diagnosis** (error gates)", "- **facade** …". The
 * learner picks a line without having followed the lesson, and the turn ends on
 * a list, not a question. The question and its list go together; the derived
 * check-in is appended in their place, as for an offer.
 */
const CHOICE_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+\S/;

function closingChoiceList(text: string): { kept: string; removed: string } | undefined {
  const lines = text.trimEnd().split('\n');
  let i = lines.length - 1;
  const items: string[] = [];
  while (i >= 0 && CHOICE_ITEM.test(lines[i]!)) items.unshift(lines[i--]!);
  if (items.length < 2) return undefined;
  while (i >= 0 && lines[i]!.trim() === '') i -= 1;
  if (i < 0 || !/\?\s*$/.test(lines[i]!)) return undefined;
  const line = lines[i]!.trimEnd();
  const question = line.trim().split(/(?<=[.!?])\s+/).pop()!;
  const before = lines.slice(0, i).join('\n');
  const head = line.slice(0, line.lastIndexOf(question));
  const kept = `${before}${i > 0 ? '\n' : ''}${head}`.trimEnd();
  const options = items.map((l) => l.replace(CHOICE_ITEM, (m) => m.slice(-1)).replace(/\*\*/g, '').trim());
  return { kept, removed: `${question} ${options.join(' / ')}` };
}

/**
 * THE CHECK-IN FOR A FLOW, from its last drawn hop (2026-09-23). `deriveCheckIn`
 * asks about a chart's focus, and a traced flow has none — so in the fourth
 * measurement no run could be closed on a derived check-in at all. The question
 * names the two ends of an arrow the learner is looking at, in the scan's
 * direction, and asserts nothing.
 */
export function deriveFlowCheckIn(chart: SeqChart | undefined): string | undefined {
  if (chart === undefined) return undefined;
  const hops = chart.steps !== undefined && chart.steps.length > 0 ? chart.steps : (chart.links ?? []);
  const last = hops[hops.length - 1];
  if (last === undefined) return undefined;
  const labelOf = (id: string): string | undefined => chart.items.find((i) => i.id === id)?.label;
  const from = labelOf(last.from);
  const to = labelOf(last.to);
  if (from === undefined || to === undefined || from === to) return undefined;
  return `Looking at the picture: if ${to} changed what it returns, what do you think would break in ${from}?`;
}
