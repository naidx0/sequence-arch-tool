# The next-picture bands, re-run under the repaired bench — registered

**Written 2026-09-06 after repair A, before the run. A card item for the window after ML Harness's.**

## Why it is being run again

The first two runs asked **7 next-picture questions and produced 0 reveals** — not rarely, never.
`teach-eval.mjs` never carried `openPrediction` between turns, so the reveal (which is what scores
the band) could not fire: a two-turn contract measured by a one-turn harness. The registered 30–70%
band had no denominator at all.

`69a3498f` repaired it: `lessonState.carryPrediction` is now called by both the product's
`teachTurn.finish()` and the bench's turn loop, and `buildTeachContext` already forwards
`lesson.open`. Five planted cases cover it, including the one that clears a stale prediction.

## The run

Two runs, `TEACH_EVAL_REPO=sequence`, `SEQUENCE_TEACH_CHECKIN_FORM=next-picture`, on a build
carrying `69a3498f`, under the card lock, arms `nextpic-3.json` and `nextpic-4.json`. About 8
minutes a run. The control is the two runs already on disk (`nextpic-1`, `nextpic-2`) — same flag,
same model, same conversations, **without** the carrier.

## The kill number, from the design page

**At least 5 reveals across the two runs**, against the 7-question rate already measured.

- **0 reveals** — the carrier is not the only thing missing. The band stays unread and the next
  question is what else the bench drops.
- **1 to 4 reveals** — the dangerous middle, and it is a *kill*, not a pass. It would let a
  percentage be computed off a handful of answers, which is exactly what the registration's own
  refutation clause exists to prevent. **A band scored on four answers is not a band.**
- **5 or more** — the reveal path works and the 30–70% band can be read for the first time.

## What is registered about the band itself

Only if the kill number is cleared. From
[`next-picture-checkin.md`](next-picture-checkin.md), unchanged:

- current form: **≥ 90%** correct; next-picture: **between 30% and 70%**
- refuted at **≥ 90%** (the prose gave it away, so it is not a prediction) or **≤ 20%** (a quiz on
  material the learner had no basis for, which is not a pretest either)
- separately refuted if the check-in rate, the chart rate, or outcome four moves

## Two things this run cannot settle, recorded now so they are not claimed later

1. **The question rate is not the carrier's fault and will not improve.** The check-in fires on 3–4
   of 28 turns in **every** arm measured, control included — the flag swaps the form, it does not
   change how often a check-in happens. If 3–4 questions a run is the ceiling, then even a perfect
   reveal rate gives 6–8 answers across two runs, and the band is being scored on that. The kill
   number is set at 5 precisely because it sits just under that ceiling: clearing it means the
   carrier works, not that the band is well-powered.
2. **`stopReason` is now recorded per turn** (repair B), so the re-read should first re-do the gate
   analysis with it. Ten of 28 turns per arm were attributed to `atCap` **by elimination**; if the
   recorded reason disagrees, the gate list in
   [`next-picture-result-2026-09-06.md`](next-picture-result-2026-09-06.md) is wrong and that
   analysis is redone rather than patched.

## Card cost

Two runs of thirteen conversations, ~8 minutes each: **call it 20 minutes**, plus the card-free
re-read. It runs under `tools/ci/gpu-lock.mjs run`, and `tools/bench/night-window.mjs` is the shape
to extend if it is bundled with anything else — its preflight already checks the card, the app's
freshness and the build.
