# Does hidden reasoning earn its wall clock on a PLAIN ask? — registered before the run

**Registered 2026-09-05T22:30Z. No arm of this has been run.** Unlike
`thinking-on-vs-off.md`, which was written with four of seven pairs already visible, this one is
blind: the runner exists, it has been dry-run against a canned provider, and no model has answered
a single ask.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## Why this run exists

`thinking-on-vs-off.md` measured reasoning on against off and ended by disqualifying its own
verdict. Its three metrics — paced, ends-with-a-check-in, visual — **grade the SHAPE of a teach
turn**, and that document says so in its own words: they "say nothing about whether the
*explanation was any good*". It also recorded the cost: **6,100 s on against 297 s off over six
paired conversations, 20.5×** (a single conversation, ml-01, showed roughly 4×).

So the standing position is a large measured cost against an unmeasured benefit. This run measures
the benefit on the axis the product actually sells: **is the answer grounded, and is it right.**

## The design

**Twenty plain asks on `examples/makemore`** — ordinary questions, not Teach. Same twenty asks,
same repository, same temperature, run twice: `reasoningEffort: 'none'` against reasoning on.
Paired, so every ask is its own control.

`makemore` is chosen for comparability — it is the corpus the teach bench's twenty subject asks and
every prior arm of this night ran on. **Its size is also the main threat to this run, declared
below.**

Two measures, both already computed by instruments in this repo:

- **answered-from** — the coverage chip's own numbers, `coverage.edgesSeen / coverage.edgesTotal`
  plus `packagesMissed`. This is the product's grounding claim, rendered to the user on every
  answer.
- **correctness** — the skipper grader's `judge(question, answer, reference)`, the same function
  that scores W against G in `skipperModel.mjs`.

### Where the reference comes from, and why it cannot go stale quietly

Skipper's correctness needs a reference, and in a lesson the reference is the turn's own answer.
A plain ask has no lesson, so each of the twenty carries a **hand-written reference fact** — and a
hand-written fact about a repository is exactly the thing that rots silently when the repository
moves.

So every reference is paired with a **guard**: a deterministic predicate over the current scan or
the current file text that must hold before the run starts. A reference whose guard fails aborts
the run naming the ask, rather than grading twenty answers against a fact that stopped being true.
This is the same reflex as the skipper bench refusing a report that lacks a `questions` field.

### The asks are not all lookups

Fourteen are retrieval-shaped ("which file defines `build_counts`", "what is the default learning
rate"). **Six are not**, and they are in on purpose:

- Four are **absence** claims — no third-party ML library, no test suite, `nn_bigram` does not
  import `sampling`. Absence is where a model fabricates, and where a grounded product should
  refuse or say "none".
- One requires noticing that the **docstring disagrees with the data**: `bigram_counts.py` says a
  "27x27 table of counts", and the shipped `names.txt` has 19 distinct characters, so
  `build_counts` returns 20×20. Answering 27 is reading the comment; answering 20 is reading the
  code and the data.
- One asks what protects `row_to_probs` from a division by zero (`sum(row) or 1`).

If hidden reasoning does anything for substance, these six are where it should show, and the split
is reported separately from the fourteen. A gain that appears only in the aggregate and not in
either half is noise.

## The prediction, registered

1. **answered-from will not discriminate, because it will be saturated.** `makemore` is 3 files and
   134 lines; the whole graph fits inside the digest budget, so I expect
   `edgesSeen == edgesTotal` and `packagesMissed == []` on **every ask in both arms**. If that
   holds, this measure returns *no evidence* on this repository — not "reasoning does not affect
   grounding" — and the honest next step is the same twenty-ask design on the `sequence` repo,
   where there is a cut to measure.
2. **Correctness: reasoning-on ≥ reasoning-off, by less than 10 points on the fourteen retrieval
   asks.** Hidden reasoning helps least where the answer is retrievable and the material is in
   context.
3. **On the six non-retrieval asks I expect the gap to be larger than on the fourteen** — that is
   the whole reason for splitting them. I am not predicting a direction I can defend numerically
   here; I am predicting that if a real effect exists it lives in this half.

I am registering (1) as a prediction rather than measuring it first, because
`edgesSeen == edgesTotal` is computable **without a model** and I have not computed it. The
measurement follows this file.

## The decision rule, and why it is not a flat band

`thinking-on-vs-off.md`'s rule used a flat twenty-point band and failed on its own terms: the
visual rate went 2/14 → 0/14, *every visual in the sample gone*, and scored as "holding" because
14 < 20. **A flat absolute band cannot be tripped by a metric whose baseline is below it.** That
document said the next rule should be relative or per-metric. This is that rule.

Let `on` and `off` be correctness proportions over the same twenty asks.

- **Reasoning is doing real work** if `off` loses **more than a quarter of `on`'s correct answers**
  — i.e. `(on − off) / on > 0.25` — on the twenty as a whole, **or** if `off` scores zero on the
  six non-retrieval asks while `on` scores two or more.
- **Reasoning is not earning the 20.5×** if `off` retains at least 90% of `on`'s correct answers
  (`off / on >= 0.90`) with no worse than a one-ask loss on the six.
- **Anything between the two is an inconclusive result and is reported as one.** Twenty asks is a
  small denominator and a band that always fires is not a rule.

Relative, so a low baseline cannot hide a total collapse; and stated in units of *answers lost*,
which is what a reader of the product experiences.

## What this run cannot settle

The judge is a model, and a model judging on a machine whose GPU is contended is a model under
load. Both arms are judged by the same judge from the same references, so the comparison survives a
judge that is merely mediocre — but a judge that is *wrong in a direction* would move both arms
together and neither would show it. The references are printed with the results so a human can
check the grading rather than trust it.

And it does not touch Teach. `thinking-on-vs-off.md` measured Teach turns; this measures plain
asks. A result here licenses a claim about plain asks and nothing else.

## Run status

**Not run.** `granite42-hermes` was resident on the card at 22:24Z, loaded by another lane, with no
`gpu.lock` written. Per the lock protocol a lane does not start while a model it did not load is
resident, so this is queued rather than started, and the registration stands on its own until it
runs.

The harness itself is verified: `PLAIN_ASKS_DRY=1 node tools/bench/plain-asks-eval.mjs` runs both
arms and the judge end to end against a canned provider at **1.1 provider calls per turn**, and the
twenty guards are checked on CPU by `pnpm test:ci` on every commit.

---

# The numbers

## Prediction 1 is confirmed, and worse than predicted — settled without the GPU

Coverage is computed from **what reached the model in the digest**, not from what the model said,
so it is model-independent and a canned-provider dry run measures it exactly. Run
2026-09-05T22:34Z, `PLAIN_ASKS_DRY=1`, all twenty asks:

| | value |
|---|---|
| distinct `edgesSeen / edgesTotal` across all 20 asks | **`2 / 2`** — one value, every ask |
| asks with a non-empty `packagesMissed` | **0 of 20** |
| `coverageSaturated` | **true** |

I predicted saturation. The reality is stronger: **the denominator is two.** `examples/makemore` is
three files whose entire scanned graph is two import edges, so every answer carries
*"answered from 2 of 2 edges"* — a chip that cannot vary, cannot be wrong, and cannot distinguish
an arm that read the repository from one that did not.

**So the answered-from half of this comparison returns NO EVIDENCE on makemore, and no amount of
card time changes that.** This is not "reasoning does not affect grounding"; it is the second law —
absence of a signal is not evidence of absence — and the signal here is absent by construction.

Two consequences, and neither is a silent substitution:

1. **The correctness half still runs on makemore as designed.** The twenty asks are *about*
   makemore; a 134-line corpus is a perfectly good place to ask whether an answer is right, and it
   keeps this run comparable with every other arm of this night.
2. **The answered-from half needs a repository with a cut in it.** On `sequence` the same chip reads
   *"answered from 296 of 2,326 edges"* and `packagesMissed` is routinely non-empty — there is
   something for reasoning to do or fail to do. That run is a separate registration against the
   same rule, not a rewrite of this one.

Total cost of establishing this: one dry run, 44 provider calls against a canned string, no GPU.

## The paired run

**Not yet run** — see Run status above.

*(empty)*
