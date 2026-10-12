# buildQueue on natural phrasing — registered before the change

**Written 2026-09-05 with the corpus built and the baseline measured, before touching the matcher.**

## The defect, from the seat

A learner asked *"teach me how the bigram counts work"* on a graph containing
`file:bigram_counts.py` and got an **empty queue** — no concept, no derived chart, no lesson.
Rewording to *"teach me how bigram_counts.py works"* produced the whole lesson. `askNames` is a
substring test, and `bigram_counts` does not occur in *the bigram counts*: the underscore is the
whole difference.

## The corpus

`tools/bench/queue-paraphrases.json` — **15 paraphrases** across the three makemore concepts, each
with a **control** ask that spells the filename the way the scanner does, plus **6 `names_nothing`**
asks that must produce an empty queue.

## Two metrics, because the first one I wrote measured two things

- **Seed concept** — does the paraphrase select the same first concept as its control? This is what
  decides the lesson and the derived chart. **Baseline: 4 of 15.**
- **Whole queue** — identical concept list. **Baseline: 1 of 15**, but three of those misses name the
  right node and differ only in queue LENGTH, because the control is sequence-shaped ("how … works")
  and the paraphrase is not. That is the single-concept rule working as designed, not a naming
  failure, so the whole-queue number is reported and the seed number is the one the prediction is
  written against.
- **Names nothing** — **baseline 6 of 6 correctly empty**, and this must not regress.

## The prediction

**Seed concept rises to at least 13 of 15**, and **`names_nothing` stays at 6 of 6.**

The mechanism: match on TOKEN SETS rather than substrings. Split a node's name on underscores, dots,
dashes, path separators and case changes; drop the extension; require **every** token to appear in
the ask. *"the bigram counts"* contains both `bigram` and `counts`, so it matches
`bigram_counts.py`; *"teach me the counts"* contains only one of the two and must NOT match, which
is the same rule doing both jobs.

Exact and substring matches keep priority, so a filename typed literally still wins over any token
guess.

**Refuted if** the seed metric does not reach 13 of 15, **or if `names_nothing` drops below 6 of 6 —
and that second one is disqualifying on its own.** A matcher that finds more concepts by guessing is
worse than the substring test it replaces: an invented concept produces a confident derived chart
about a file the learner never asked about, which is the failure mode the whole no-node refusal
exists to prevent.

Single-token names (`index.ts` → `index`) keep the existing substring rule rather than gaining a
token rule, because one common word is not evidence that an ask is about that file.
