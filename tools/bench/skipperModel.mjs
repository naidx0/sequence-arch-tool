/**
 * THE SKIPPER BENCH — does a comprehension question require having followed?
 *
 * Design: the research lane's skipper-bench spec (vault; named rather than
 * linked). This module is the PURE half — question extraction, typing, and the
 * decision number — so every part that does not need a GPU is testable without
 * one, and the model calls are a thin shell over it.
 *
 * THE QUESTION IT ANSWERS. Teach mode's comprehension questions are written by
 * the model under a prompt contract; the harness holds an expected answer for
 * exactly one per turn (the closing prediction's `expect`), and the bench counts
 * questions rather than measuring them. So nobody knows whether the pop-up
 * questions Max liked are questions or decoration.
 *
 * TWO CONDITIONS, ONE QUESTION. `W` (walked) gets the turn's own explanation;
 * `G` (graph-only) gets the board and digest but not the prose. A question the
 * skipper answers as well as the follower did not test whether anyone followed.
 * `P` (prior-only) catches the question general knowledge answers.
 *
 * ── TWO CORRECTIONS TO THE SPEC, both about this repository's code ───────
 *
 * 1. "No deterministic prediction grader exists in src" was true when written
 *    and is not now: `gradePrediction` (packages/schema) grades a predicted edge
 *    against the graph with five verdicts. The deterministic half should use it
 *    rather than a normalised string match — and it brings `graph-gap`, which
 *    stops a learner being marked wrong over a region the scan never read.
 *
 * 2. The spec's smallest run starts from `tools/bench/out/teach-eval-report.json`
 *    as "115 graded assistant turns under deepseek-teach". That file no longer
 *    holds them — later runs overwrote it, and the working tree now carries a
 *    2-conversation smoke run. The real one is 54 conversations / 117 turns at
 *    commit `aeb1fdc6`, and this reads it FROM THAT COMMIT by name. A bench
 *    whose input is "whatever is in the working tree" measures a moving target.
 */

/** The closing check-in, which is a pacing beat rather than a comprehension question. */
const PULSE_SHAPES =
  /^(does (that|this) make sense|make sense so far|any questions|following so far|clear so far|with me so far)\b/i;

/**
 * Every question sentence in a turn, minus the closing pulse-check.
 *
 * Fenced blocks are stripped first: a `?` inside a code sample is not a question
 * put to the learner, and counting it would inflate every number downstream.
 */
export function extractQuestions(text) {
  const unfenced = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  return unfenced
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('?'))
    .filter((s) => !PULSE_SHAPES.test(s.replace(/^[^A-Za-z]+/, '')));
}

/**
 * What KIND of question, in the contract's own preference order.
 *
 * Typed by shape rather than by meaning, and deliberately conservative: a
 * question that matches nothing is `other`, never forced into a bucket. The
 * types exist to be counted separately, and a wrong bucket is worse than an
 * honest `other`.
 */
export function classifyQuestion(q) {
  const s = String(q ?? '').toLowerCase();
  if (/\bwhat (do you think )?(happens|breaks|would break|goes wrong)\b/.test(s)) {
    return 'what-breaks-if';
  }
  if (/\b(which|what|who)\b.*\b(do you think|would you expect|predict)\b/.test(s)) {
    return 'prediction';
  }
  if (/\bdo you think\b|\bpredict\b/.test(s)) return 'prediction';
  if (/^why\b|\bwhy (does|do|is|are|would)\b/.test(s)) return 'why';
  return 'other';
}

/**
 * PARROTING: the model copied the contract's example instead of instantiating it.
 *
 * Observed on the first live report (2026-09-04, granite42-hermes): one of the
 * three questions the run produced was
 *
 *   "Check-in: Which component do you think X talks to next?"
 *
 * against askPipeline.ts:986, which offers as an ILLUSTRATION
 * `("which component do you think X talks to next? You ...")`. The model
 * reproduced it verbatim — the placeholder `X`, which names nothing in the
 * user's repo, and the category label, which is contract vocabulary and not
 * something a reader should ever see.
 *
 * This is measured rather than described because it is a defect in the CONTRACT,
 * not in the model: an example written in a form that a 4B-class model can copy
 * whole will be copied whole. The fix direction is a placeholder that cannot
 * survive being echoed, and category labels kept out of the sentence the model
 * is being shown how to write.
 *
 * Deliberately narrow. It flags only the two shapes actually seen, on the
 * ORIGINAL case — a standalone `X` is the template's placeholder, and a leading
 * category label is contract vocabulary. A paraphrase is not parroting, and this
 * must not drift into scoring questions for quality.
 */
export function parrotMarkers(q) {
  const raw = String(q ?? '');
  const found = [];
  // `X(?=\s)`, not `X\b`: a hyphen is a word boundary, so `\bX\b` fires on
  // "do you think X-ray parsing does?" — a real sentence, not the template.
  if (/\b(?:do you think|would you expect|predict)\s+X(?=\s)/.test(raw)) found.push('placeholder-x');
  if (/^\s*(?:check-?in|comprehension question|prediction prompt|pulse check)\s*:/i.test(raw)) {
    found.push('category-label');
  }
  return found;
}

/**
 * The discrimination index: how much having followed the lesson was worth.
 *
 * `D = correct(W) − correct(G)`. Both are proportions over k attempts, so D is
 * in [-1, 1] and a NEGATIVE D is meaningful rather than noise — it says the
 * explanation actively misled, which is a worse defect than a question anyone
 * could answer.
 */
export function discrimination(correctW, correctG) {
  return Number((correctW - correctG).toFixed(4));
}

/**
 * The verdict for one question.
 *
 * ORDER MATTERS. `pulse-check` is tested FIRST: a question everyone answers from
 * general knowledge is not made good by the walked condition also answering it,
 * and calling that "good" would count a question that tested nothing as one that
 * tested something.
 *
 * The 0.2 threshold is the spec's and is not derived from anything — it is a
 * stated convention, so it travels as a parameter rather than as a magic number,
 * and any report using it must print it.
 */
/**
 * Does the question point at anything IN the material?
 *
 * `W=0 and G=0` alone does not make a menu. It means neither single attempt was
 * judged correct, which is also what "both answers were wrong" looks like — and
 * at k=1 those are indistinguishable by score. Measured on the first scored run,
 * 21 questions scored 0 and 0, but only 12 were clarifying-shaped; calling the
 * other 9 menus would have been an over-claim dressed as a taxonomy.
 *
 * So a menu must ALSO have no referent: no content word it shares with the
 * material it is supposedly asking about. "Is there anything else you'd like to
 * know?" shares nothing; "which file does the walk open first?" shares `file`
 * and `walk` and is a real question that simply went unanswered.
 *
 * Deliberately crude — content words of four characters or more, minus the
 * commonest question scaffolding. A crude referent test that under-claims is
 * worth more than a precise one nobody can check.
 */
const SCAFFOLD = new Set([
  'what', 'which', 'where', 'when', 'does', 'do', 'did', 'you', 'your', 'this', 'that', 'these',
  'those', 'here', 'there', 'about', 'would', 'like', 'know', 'anything', 'else', 'more', 'want',
  'show', 'explain', 'tell', 'understand', 'think', 'happens', 'could', 'should', 'have', 'been',
  'the', 'and', 'for', 'with', 'from', 'into', 'they', 'them', 'their', 'were', 'will',
]);

export function hasReferent(question, material) {
  const words = (t) => new Set(String(t ?? '').toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) ?? []);
  const q = [...words(question)].filter((w) => !SCAFFOLD.has(w));
  if (q.length === 0) return false;
  const m = words(material);
  return q.some((w) => m.has(w));
}

export function verdictFor({ correctW, correctG, correctP }, opts = {}) {
  const defectAtOrBelow = opts.defectAtOrBelow ?? 0.2;
  const pulseAtOrAbove = opts.pulseAtOrAbove ?? 0.8;
  const menuAtOrBelow = opts.menuAtOrBelow ?? 0;
  if (typeof correctP === 'number' && correctP >= pulseAtOrAbove) return 'pulse-check';
  if (discrimination(correctW, correctG) > defectAtOrBelow) return 'good';
  /*
   * TWO WAYS TO FAIL, AND THEY NEED DIFFERENT FIXES.
   *
   * The first scored run called both `defect`, which hid the more interesting
   * one. Measured on 31 questions, 21 failed and they are not one thing:
   *
   *   MENU     W and G both fail. Nobody can answer it because it is not a
   *            question about the material — "is there anything else you'd like
   *            to know about how these files interact?" The lesson is not too
   *            easy; there is nothing to be right about. The fix is in the
   *            CONTRACT's closing-question rule.
   *
   *   TOO-EASY G succeeds. The question is answerable, and the graph answers it
   *            without the walk — a real question that tests nothing about
   *            whether the learner followed. The fix is in what the question
   *            ASKS, not in whether it is a question.
   *
   * `menuAtOrBelow` is 0 by default: with nobody able to answer, there is nothing
   * to discriminate. It travels as a parameter because it is a convention, like
   * the other two thresholds, and a report using it must print it.
   */
  if (correctG > menuAtOrBelow || correctW > menuAtOrBelow) return 'too-easy';
  /*
   * Nobody answered it. A MENU has nothing in the material to answer; anything
   * else is a real question that went UNANSWERED, which is a third failure and
   * not the contract's fault in the same way.
   */
  /*
   * THE SPLIT IS BY SHAPE, NOT BY WORD OVERLAP — and that is a correction.
   *
   * The first attempt defined a menu as "no content word shared with the
   * material". It does not work: "is there anything else you'd like to know
   * about how these FILES INTERACT?" shares `files` and `interact` with the
   * lesson, so overlap called every one of the 21 answerable, exactly as the
   * bare W=0-and-G=0 rule had called every one of them a menu. Both rules
   * over-claim, in opposite directions.
   *
   * What separates them is what the question IS, which `gradeCheckIn` already
   * decides and has planted tests for: a clarifying question is an offer to do
   * more work, and there is nothing in the material to be right about. The
   * caller passes that shape in rather than this module growing a second copy of
   * the rule — one definition, in the place that owns it.
   *
   * With no shape supplied, the honest answer is `unanswered`: "nobody answered
   * it" is what the scores actually show, and `menu` is a claim about the
   * question that needs the classifier to make.
   */
  return opts.shape === 'clarifying' ? 'menu' : 'unanswered';
}

/**
 * The build-level number, WITH its denominator and its thresholds.
 *
 * A share without them is a claim rather than a measurement — the third law. The
 * thresholds ride the result because they are conventions someone chose, and a
 * later reader comparing two runs needs to know they were the same conventions.
 */
export function summarize(rows, opts = {}) {
  const defectAtOrBelow = opts.defectAtOrBelow ?? 0.2;
  const pulseAtOrAbove = opts.pulseAtOrAbove ?? 0.8;
  const menuAtOrBelow = opts.menuAtOrBelow ?? 0;
  const verdicts = rows.map((r) =>
    verdictFor(r, {
      defectAtOrBelow,
      pulseAtOrAbove,
      menuAtOrBelow,
      question: r.question,
      material: r.reference,
      shape: r.shape,
    }),
  );
  const count = (v) => verdicts.filter((x) => x === v).length;
  return {
    questions: rows.length,
    good: count('good'),
    /* `defect` is kept as the SUM of the two failure classes, so a report written
       against the old shape still reads correctly while the split is what anyone
       acting on it looks at. */
    defect: count('menu') + count('too-easy') + count('unanswered'),
    menu: count('menu'),
    tooEasy: count('too-easy'),
    unanswered: count('unanswered'),
    /*
     * NULL, NOT ZERO, when nothing carried a `correctP`.
     *
     * The first scored run printed `pulseCheck: 0` and it read as "no question
     * was answerable from prior knowledge". It meant the prior-only condition was
     * never run: `verdictFor` returns `pulse-check` only when `correctP` is a
     * number, and no row had one. A verdict that prints a zero it did not measure
     * is the FIRST LAW in miniature — a gate you cannot make fail.
     */
    pulseCheck: rows.some((r) => typeof r.correctP === 'number') ? count('pulse-check') : null,
    goodShare: rows.length === 0 ? null : Number((count('good') / rows.length).toFixed(4)),
    thresholds: { defectAtOrBelow, pulseAtOrAbove, menuAtOrBelow },
  };
}

/* ------------------------------------------------ the scoring half, W and G -- */

/**
 * ANSWER EACH QUESTION UNDER TWO CONDITIONS, so `discrimination` receives inputs
 * something actually produces.
 *
 * Until now `verdictFor` and `discrimination` were pure functions waiting on
 * numbers nobody computed: the bench printed `summarize([])` and said scoring
 * needed the GPU. It did not need the GPU — it needed this.
 *
 *   W  the WALKED condition: the lesson turn that asked the question is in
 *      context. This is the learner who followed along.
 *   G  the GRAPH-ONLY condition: the repository's own structure is in context and
 *      the lesson is NOT. This is the learner who skipped it and can still look
 *      at the code.
 *
 * The gap between them is the whole measurement. A question W answers and G does
 * not required having followed the lesson; a question both answer is one the
 * graph already told you, and calling that a comprehension check flatters the
 * lesson. The verdict names the second case `defect`, and it is the case this
 * bench exists to find.
 *
 * ── EVERY MODEL CALL IS INJECTED ──────────────────────────────────────────
 *
 * `deps.answer` and `deps.judge` are functions, not a provider. That is what
 * lets the whole scoring path be tested on CPU with a stub — including the case
 * that must go red, a question the graph alone answers — instead of being
 * verified by running it and reading the output, which is how the first version
 * of every instrument in this repository went wrong.
 */
export async function scoreQuestions(rows, deps, opts = {}) {
  const attempts = opts.attempts ?? 1;
  const out = [];
  for (const row of rows) {
    let hitW = 0;
    let hitG = 0;
    for (let i = 0; i < attempts; i++) {
      const w = await deps.answer({ condition: 'W', question: row.question, context: row.lesson ?? '' });
      const g = await deps.answer({ condition: 'G', question: row.question, context: row.graph ?? '' });
      /*
       * The REFERENCE is the lesson's own answer, not a third opinion. The teach
       * contract already requires the turn to answer what it asks ("ask, then
       * tell"), so the turn that produced the question is the only grounded
       * reference available — and if it has none, the question is unscorable and
       * says so rather than being graded against a guess.
       */
      if (row.reference === undefined || row.reference === '') continue;
      if (await deps.judge({ question: row.question, answer: w, reference: row.reference })) hitW++;
      if (await deps.judge({ question: row.question, answer: g, reference: row.reference })) hitG++;
    }
    const scored = row.reference === undefined || row.reference === '' ? undefined : attempts;
    out.push({
      ...row,
      ...(scored === undefined
        ? { unscorable: 'the turn never answered its own question, so there is no reference' }
        : { correctW: hitW / scored, correctG: hitG / scored }),
    });
  }
  return out;
}

/**
 * The rows `scoreQuestions` can score, built from a teach report.
 *
 * A question whose turn did not answer it is kept and marked unscorable rather
 * than dropped: "we could not grade 9 of 31" and "there were 22 questions" are
 * different statements, and only the first is true.
 */
export function scorableRows(report, graphContextByRepo = {}) {
  const rows = [];
  for (const convo of report.results ?? []) {
    for (const turn of convo.turns ?? []) {
      for (const question of turn.questions ?? []) {
        rows.push({
          convo: convo.id,
          turn: turn.turn,
          question,
          lesson: turn.text ?? '',
          reference: turn.text ?? '',
          graph: graphContextByRepo[convo.repo] ?? '',
          type: classifyQuestion(question),
        });
      }
    }
  }
  return rows;
}
