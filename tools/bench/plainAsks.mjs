/**
 * TWENTY PLAIN ASKS ON `examples/makemore`, WITH THEIR ANSWERS AND THEIR GUARDS.
 *
 * Pure data and pure functions. The runner (`plain-asks-eval.mjs`) calls a model;
 * this file never does, so the whole bank can be checked on CPU — and is, by
 * `tools/ci/plain-asks.test.mjs`, on every `pnpm test:ci`.
 *
 * Registered design and decision rule: `docs/research/reasoning-on-plain-asks.md`.
 * Do not change a `reference` to match a run.
 *
 * ── WHY EVERY REFERENCE CARRIES A GUARD ───────────────────────────────────
 *
 * Skipper grades an answer against a reference, and in a lesson the reference is
 * the turn's own answer — grounded by construction. A plain ask has no lesson, so
 * these references are HAND-WRITTEN facts about a repository, which is precisely
 * the thing that rots without anyone noticing. `bigram_counts.py` gaining a
 * parameter would leave nineteen good rows and one that silently grades every
 * answer against a fact that stopped being true, and the run would still print a
 * percentage.
 *
 * So each row carries `guard(ctx)`: a deterministic predicate over the CURRENT
 * files and scan that must hold before any model is called. A failed guard names
 * the ask and stops the run. The bench refuses rather than measuring something
 * it can no longer define — the same reflex as skipper-eval refusing a report
 * with no `questions` field.
 *
 * ── THE SPLIT, AND WHY IT IS PRE-DECLARED ─────────────────────────────────
 *
 * `kind: 'retrieval'` (14) — the answer is sitting in the material.
 * `kind: 'reasoned'` (6) — an absence to establish, a docstring that disagrees
 * with the data, a guard clause to explain. If hidden reasoning does anything
 * for substance, it should show HERE, and the two halves are reported apart so a
 * gain cannot be claimed from an aggregate that neither half supports.
 */

/**
 * The bank. `question` is asked verbatim; `reference` is what a correct answer
 * has to convey (not a string to match); `guard` is what makes the reference
 * checkable today.
 *
 * `ctx` is `{ files, graph }` — `files` maps a basename to its text, `graph` is
 * the scan of `examples/makemore`.
 */
export const ASKS = [
  {
    id: 'pa-01',
    kind: 'retrieval',
    question: 'Which file defines build_counts?',
    reference: 'bigram_counts.py defines build_counts.',
    guard: (c) => /def build_counts\(/.test(c.files['bigram_counts.py']),
  },
  {
    id: 'pa-02',
    kind: 'retrieval',
    question: 'What does build_counts return?',
    reference: 'Three values: the counts matrix, stoi (character to index) and itos (index to character).',
    guard: (c) => /return counts, stoi, itos/.test(c.files['bigram_counts.py']),
  },
  {
    id: 'pa-03',
    kind: 'retrieval',
    question: 'Which files import build_counts?',
    reference: 'Both nn_bigram.py and sampling.py import it from bigram_counts.',
    guard: (c) =>
      /from bigram_counts import build_counts/.test(c.files['nn_bigram.py']) &&
      /from bigram_counts import build_counts/.test(c.files['sampling.py']),
  },
  {
    id: 'pa-04',
    kind: 'retrieval',
    question: "What index does the '.' boundary character get in stoi?",
    reference: "0 — stoi['.'] is set to 0 after the letters are numbered from 1.",
    guard: (c) => /stoi\['\.'\] = 0/.test(c.files['bigram_counts.py']),
  },
  {
    id: 'pa-05',
    kind: 'retrieval',
    question: 'What is the default learning rate in train()?',
    reference: '5.0',
    guard: (c) => /def train\([^)]*lr=5\.0/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-06',
    kind: 'retrieval',
    question: 'How many training steps does train() take by default?',
    reference: '200',
    guard: (c) => /def train\([^)]*steps=200/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-07',
    kind: 'retrieval',
    question: 'What random seed does train() use by default?',
    reference: '42',
    guard: (c) => /def train\([^)]*seed=42/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-08',
    kind: 'retrieval',
    question: 'Which function draws a name from the counts, and in which file?',
    reference: 'sample_name, in sampling.py.',
    guard: (c) => /def sample_name\(/.test(c.files['sampling.py']),
  },
  {
    id: 'pa-09',
    kind: 'retrieval',
    question: 'When does sample_name stop generating characters?',
    reference: "When the sampled index is stoi['.'] — the boundary marker — at which point it returns the name built so far.",
    guard: (c) => /if ix == stoi\['\.'\]:/.test(c.files['sampling.py']),
  },
  {
    id: 'pa-10',
    kind: 'retrieval',
    question: 'What loss does train() minimise?',
    reference: 'The negative log likelihood, averaged over all character pairs.',
    guard: (c) =>
      /loss -= math\.log\(probs\[iy\]\)/.test(c.files['nn_bigram.py']) &&
      /loss \/= len\(pairs\)/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-11',
    kind: 'retrieval',
    question: 'How does train() compute the logits for a character?',
    reference: 'The logits are just the row W[ix] — a one-hot input selects a row, so no matrix multiply is needed.',
    guard: (c) => /logits = W\[ix\]/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-12',
    kind: 'retrieval',
    question: 'How does the code turn a row of counts into probabilities?',
    reference: 'row_to_probs divides each count by the row sum.',
    guard: (c) => /def row_to_probs\(row\)/.test(c.files['sampling.py']),
  },
  {
    id: 'pa-13',
    kind: 'retrieval',
    question: 'How is each of the three scripts meant to be run?',
    reference: "Each defines main() and calls it under `if __name__ == '__main__':`, so each runs as a standalone script.",
    guard: (c) =>
      ['bigram_counts.py', 'nn_bigram.py', 'sampling.py'].every((f) =>
        /if __name__ == '__main__':/.test(c.files[f]),
      ),
  },
  {
    id: 'pa-14',
    kind: 'retrieval',
    question: "Which character marks both the start and the end of a name?",
    reference: "'.' — the same marker plays both roles.",
    guard: (c) => /\['\.'\] \+ list\(name\) \+ \['\.'\]/.test(c.files['bigram_counts.py']),
  },

  /* ── the six that are not lookups ───────────────────────────────────────── */

  {
    id: 'pa-15',
    kind: 'reasoned',
    question: 'Which third-party machine-learning libraries does this project depend on?',
    reference: 'None. The only imports are the standard library modules math and random — there is no numpy, no torch, nothing third-party.',
    /* The guard IS the claim: no import line names anything outside the stdlib
       and this project's own module. */
    guard: (c) =>
      ['bigram_counts.py', 'nn_bigram.py', 'sampling.py'].every((f) =>
        c.files[f]
          .split('\n')
          .filter((l) => /^\s*(import|from)\s/.test(l))
          .every((l) => /\b(math|random|bigram_counts)\b/.test(l)),
      ),
  },
  {
    id: 'pa-16',
    kind: 'reasoned',
    question: 'Does this project have a test suite?',
    reference: 'No. There are no test files and no test framework — the three scripts print their results when run.',
    /*
     * AN ABSENCE GUARD MUST FIRST ESTABLISH IT IS LOOKING AT THE RIGHT PLACE.
     * `no filename matches /test/` is also true of an empty directory and of a
     * renamed project, so on its own this guard cannot tell "there are no tests"
     * from "there is nothing here" — the second of the three laws, in the
     * bench's own reference bank. It has to see the three modules first.
     */
    guard: (c) =>
      ['bigram_counts.py', 'nn_bigram.py', 'sampling.py'].every((f) => typeof c.files[f] === 'string') &&
      !Object.keys(c.files).some((f) => /test/i.test(f)),
  },
  {
    id: 'pa-17',
    kind: 'reasoned',
    question: 'Does nn_bigram.py use the sampling code?',
    reference: 'No. nn_bigram.py imports only build_counts from bigram_counts; it never imports sampling.',
    /* Same vacuum as pa-16, one level subtler: `/x/.test(undefined)` tests the
       STRING "undefined" and matches nothing, so a missing nn_bigram.py reads as
       "it does not import sampling". The file has to be there to be evidence. */
    guard: (c) =>
      typeof c.files['nn_bigram.py'] === 'string' &&
      !/import sampling|from sampling/.test(c.files['nn_bigram.py']),
  },
  {
    id: 'pa-18',
    kind: 'reasoned',
    question: 'Which of the three modules can be run without the other two?',
    reference: 'bigram_counts.py — it imports nothing from the project, while nn_bigram.py and sampling.py both depend on it.',
    guard: (c) =>
      typeof c.files['bigram_counts.py'] === 'string' &&
      !/^\s*(from|import)\s+(sampling|nn_bigram)/m.test(c.files['bigram_counts.py']),
  },
  {
    id: 'pa-19',
    kind: 'reasoned',
    question: 'How big is the counts matrix that build_counts returns for the names.txt in this repo?',
    /*
     * THE ROW THAT SEPARATES READING THE COMMENT FROM READING THE CODE.
     * The docstring says "a 27x27 table" — true of the full makemore dataset,
     * false of the twenty names shipped here, which use 19 distinct characters.
     * `n` is derived from the data, so the answer is 20x20 and the docstring is
     * describing a different corpus.
     */
    reference:
      "20 by 20. n is len(stoi), derived from the data: the shipped names.txt uses 19 distinct characters plus the '.' marker. The docstring's 27x27 describes the full makemore dataset, not this one.",
    guard: (c) => {
      const names = c.files['names.txt'].split('\n').filter(Boolean);
      const distinct = new Set(names.join('').replace(/\r/g, '')).size;
      return /27x27/.test(c.files['bigram_counts.py']) && distinct + 1 === 20;
    },
  },
  {
    id: 'pa-20',
    kind: 'reasoned',
    question: 'What stops row_to_probs from dividing by zero on a row of all zeros?',
    reference: '`total = sum(row) or 1` — when the row sums to zero, `or 1` substitutes 1, so the division is safe and every probability comes out 0.',
    guard: (c) => /total = sum\(row\) or 1/.test(c.files['sampling.py']),
  },
];

/**
 * Check every reference is still true of the repository as it is now.
 *
 * Returns the ids whose guard failed. The runner treats a non-empty result as
 * fatal: nineteen good rows and one stale one still prints a percentage, and
 * that percentage is what a reader would act on.
 */
export function failedGuards(ctx) {
  return ASKS.filter((a) => {
    try {
      return !a.guard(ctx);
    } catch {
      /* A guard that throws is a guard that no longer describes this repo — a
         missing file reads as a TypeError, and treating that as "passed" is how
         a stale bank survives. */
      return true;
    }
  }).map((a) => a.id);
}

/**
 * The scoreboard, and the registered rule applied to it.
 *
 * `rows` are `{ id, kind, onCorrect, offCorrect, onCoverage, offCoverage }`.
 * The rule is `docs/research/reasoning-on-plain-asks.md`, quoted here so the
 * code and the registration cannot drift:
 *
 *   real work      (on − off) / on > 0.25, OR off scores 0 on the six while on scores >= 2
 *   not earning it off / on >= 0.90 and no worse than a one-ask loss on the six
 *   otherwise      inconclusive, reported as such
 *
 * Relative, not a flat band — `thinking-on-vs-off.md`'s twenty-point band scored
 * a metric's total collapse (2/14 -> 0/14) as "holding" because the baseline was
 * below the band.
 */
export function summarizePlainAsks(rows) {
  const count = (rs, f) => rs.filter(f).length;
  const reasoned = rows.filter((r) => r.kind === 'reasoned');
  const retrieval = rows.filter((r) => r.kind === 'retrieval');
  const on = count(rows, (r) => r.onCorrect);
  const off = count(rows, (r) => r.offCorrect);
  const onR = count(reasoned, (r) => r.onCorrect);
  const offR = count(reasoned, (r) => r.offCorrect);

  /*
   * A ZERO NUMERATOR IS NOT A VERDICT. If reasoning-on got nothing right, the
   * ratios below are 0/0 and NaN, and every comparison against NaN is false —
   * which would silently fall through to "inconclusive" and read as a mild
   * result rather than as a broken run.
   */
  const verdict =
    on === 0
      ? 'no-baseline'
      : (on - off) / on > 0.25 || (offR === 0 && onR >= 2)
        ? 'real-work'
        : off / on >= 0.9 && onR - offR <= 1
          ? 'not-earning-it'
          : 'inconclusive';

  return {
    n: rows.length,
    on,
    off,
    retrieval: { n: retrieval.length, on: count(retrieval, (r) => r.onCorrect), off: count(retrieval, (r) => r.offCorrect) },
    reasoned: { n: reasoned.length, on: onR, off: offR },
    /* Registered prediction 1: this saturates on makemore and therefore returns
       no evidence. Reported either way so the prediction is scored. */
    coverageSaturated: rows.every(
      (r) => r.onCoverage?.full === true && r.offCoverage?.full === true,
    ),
    verdict,
  };
}
