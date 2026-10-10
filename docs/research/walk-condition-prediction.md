# The walk condition — registered before any run

**Written 2026-09-06, after `bb1d7f16`, before any run of it.**

## What changed, and what it can reach

`buildQueue` decided whether a lesson saw more than one concept from `SEQUENCE_ASK` alone — "bit by
bit", "step by step", "how X works". That detects phrasing, not whether the learner asked to be
taught, so a lesson ask without the phrase got a queue of **one file and nothing around it**.
`bb1d7f16` adds `TEACH_ASK` beside it: a request to be taught gets the neighbour walk, a pointed
question ("Why does X use Y at both ends?") still gets exactly one.

**Measured on this repository's graph — 1,072 nodes, 2,873 edges — before registering anything:**

| conversation | sequence-shaped? | queue before | queue after |
|---|---|---|---|
| `cs-05` | no | 1 | **6** |
| `harness-02` | no | 1 | **6** |
| `harness-07` | no | 1 | **6** |
| `link-04` | no | 1 | **6** |
| `mix-03` | no | 1 | **6** |
| `mix-06` | no | 1 | **6** |
| `cs-06`, `harness-01`, `harness-04` | yes | 6 | 6 |
| `harness-03`, `harness-05`, `harness-06`, `harness-08` | no | **0** | **0** |

**Six conversations change, not five.** I said five in the report that prompted this; `harness-02`
("Teach me what an evidence ledger is in this codebase and why it exists") also matches `TEACH_ASK`
without a sequence phrase, and the table is what a scan says rather than what I read off the asks.

The last row is the more interesting correction: **four conversations have an empty queue and the
walk cannot touch them.** Their asks name no file and carry no repository reference, so `buildQueue`
returns nothing at all — which is why `harness-03`, `-05`, `-06` and `-08` were given no concept in
*every* arm of the sequence condition. That was visible in the four arms and I read it as noise.

## The control is the two NEW-scan arms, and only those

`seq-new-1.json` and `seq-new-2.json`, restricted to the six conversations that change. **Not all
four arms**: `seq-old-1` and `seq-old-2` ran on the pre-re-export scanner, and using them would put
the scan change and the walk change in the same comparison, which is the confound the whole
sequence condition was built to avoid.

Control, six conversations, 12 turns each run, under the corrected statistic:

| | new-1 | new-2 | range |
|---|---|---|---|
| stubs | 2 | 3 | [2, 3] |
| lesson turns | 10 | 9 | [9, 10] |
| concepts given | 6 | 8 | [6, 8] |
| pictures (visual-substantive) | 6 | 8 | [6, 8] |
| **concepts ÷ lesson turns** | **60%** | **89%** | **[60%, 89%]** |
| check-in | 5 | 5 | [5, 5] |

## The prediction

Two runs a side, `TEACH_EVAL_REPO=sequence`, the same model and settings as the four arms, on the
build carrying `bb1d7f16`. A difference counts only when **both** runs fall outside the other side's
range with direction agreement.

**The primary claim is the ratio, not the count.** Concepts given is a count over lesson turns, and
lesson turns move with the stub rate — that is exactly how the sequence condition produced a fall
that was not there. The ratio cannot be inflated by a stub, so it is the number to judge.

1. **Concepts ÷ lesson turns rises to essentially 1.** Before the change a two-turn conversation had
   one concept for two turns; after it has six for two. Every lesson turn should hold one.
   → **Registered: both runs ≥ 95%.** *Refuted if either run is below 89%*, the control's own
   maximum.
2. **Pictures ÷ lesson turns rises with it.** The chart draws on 93–100% of concept turns in every
   arm on record, and the walk adds concepts rather than changing the chart.
   → **Registered: both runs ≥ 90%.** *Refuted if either falls below 89%.*
3. **Lesson turns do not move.** Nothing in the walk decides whether the model produces prose.
   → **Registered: both runs inside [9, 10]** — a tight band on two control runs, so this is stated
   as the thing to watch rather than a strong claim. *A move outside it in both runs, in the same
   direction, is a finding about the walk changing turn quality and must be reported as one, not
   absorbed.*
4. **The four empty-queue conversations do not move at all.** `harness-03`, `-05`, `-06`, `-08` have
   no queue to walk. → **Registered: concepts given stays 0 for all four, in both runs.** *If any of
   them gains a concept, something other than the walk changed and the run is not interpretable.*
5. **The three already-walking conversations do not move.** `cs-06`, `harness-01`, `harness-04` had
   a queue of 6 before and after. → **Registered: their concepts-÷-lesson-turns ratio stays within
   the control's own range for those three.** *Movement here is the same warning as 4.*

Predictions 4 and 5 are the ones worth most, because they are near-deterministic: they are the
walk's own controls inside the run, and they fail loudly if the comparison is not what it claims.

## What this cannot show

- **Not whether the longer queue teaches better.** It measures whether a turn *had* a concept and
  drew a picture, not whether six shallow concepts beat one deep one. A learner given six files in
  two turns may be worse off. **That is not in these bands and must not be claimed from them.**
- **Not comparable to the four arms on totals.** The six conversations now run longer queues, so
  their turn and concept counts are not comparable to any figure recorded before `bb1d7f16`. Only
  the six-conversation subset above is a control, and only under the corrected statistic.
- **The control's spread is wide** — 60% against 89% on two runs — so only a large effect is
  detectable. A result inside that spread means *not measurable at this n*, never "no effect".

## Card cost, stated before it is spent

Two runs of thirteen conversations on this repository. The four arms took 21, 21, 58 and 33 minutes;
the 58 carried four hung requests that the ninety-second cap (`c6335a19`) now bounds at about a
minute each. **Call it 25 to 35 minutes a run, 50 to 70 minutes for the pair**, after the seat's
one-lesson run and the next-picture bands, in the same card window and not inside another lane's
lock.

## How it will be run

`tools/bench/seq-condition-window.mjs` as it stands runs the *scan* condition — it checks
`facts.ts` out at an old commit and swaps the scanner between arms. The walk condition swaps
nothing: both runs are on one build. So the window needs a small card-free change first — two arms,
no scanner checkout, writing `walk-1.json` and `walk-2.json` — and it keeps the per-arm idempotence
that stopped a completed arm being re-run for twenty minutes of card.

`TEACH_EVAL_WRITE_SESSIONS=1` on the second run, so the checkpoint prediction's mismatched-build
half finally gets sessions written by the build that will open them. **The window must not rebuild
the analyzer after the last run** — that is the defect that made the first attempt at that
prediction unmeasurable, and `afc821ed` fixed it by rebuilding only when the restore actually
restored something. With no scanner checkout there is nothing to restore, so nothing to rebuild;
the walk arms are the first runs where that holds by construction rather than by care.
