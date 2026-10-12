# The next-picture bands cannot be read from these runs

**Two runs, 2026-09-06T08:30–09:12Z, `SEQUENCE_TEACH_CHECKIN_FORM=next-picture`, against the bands
registered in [`next-picture-checkin.md`](next-picture-checkin.md).**

## The question appears on 3 of 28 turns, and 4 of 28

The research lane read run 1 as carrying the form's question on 2 of 28 turns; the count is **3**
(`cs-05`, `link-04`, `mix-06`, all turn 0) in run 1 and **4** in run 2. We agree on the substance:
the denominator is far too small to score a percentage band.

## What gated the other 25 in run 1

Mutually exclusive, in the order `askPipeline.ts` tests them:

| | turns | the condition |
|---|---|---|
| carried the question | **3** | — |
| stub, ≤ 35 words | 7 | `proseWords > TEACH_STUB_WORDS` |
| emitted no chart at all | 7 | `lastChartThisTurn !== undefined` |
| the model wrote its own check-in | 1 | `!gradeCheckIn(text).endsWithCheck` |
| chart, substantive prose, **no check of any kind** | **10** | only `atCap` remains |

The last row is the largest and the least visible. `atCap` is `atCeiling || spentOnNothing ||
outOfTime` — the round ceiling, the unproductive-round limit, or the turn deadline — and **the bench
report carries no field that records any of them**, so it cannot be confirmed from the files. It is
the only condition left unaccounted for in that branch. Recording `atCap` per turn is the fix, and
it is the second time tonight a question could not be answered because the report did not carry the
quantity the code decides on.

## It was not the flag

| | derived check-ins of 28 |
|---|---|
| `seq-new-1` — flag **off**, same build | **4**, all the default form |
| `nextpic-1` | **3**, all next-picture |
| `nextpic-2` | **4**, all next-picture |

The flag did exactly what it claims: default 4 → 0, next-picture 0 → 3 and 4. **The check-in itself
fires on 3–4 of 28 turns in every arm, control included.** The thin denominator belongs to the
check-in gate, not to the next-picture form, and no amount of running the flagged arm changes it.

## The band has no denominator at all, for a stronger reason than n = 3

**Seven questions asked across the two runs. Zero reveals.** Every one of the seven had a following
turn in the same conversation.

The reveal is the half that scores the band — it is what tells the learner whether the prediction was
right, and it is what a grader would count. In the product it round-trips:

```
askPipeline sets openPrediction
  → teachTurn.finish() writes lesson.open = {…, askedAt}
    → next turn reads input.teachContext?.open
      → the reveal line is appended
```

`tools/bench/teach-eval.mjs` contains **no reference to `openPrediction` or `open`**. It calls the
pipeline directly and never persists or replays the prediction, so the reveal cannot fire — not
rarely, never.

**So the registered 30–70% band is unmeasurable by this bench as it stands.** Not a thin denominator:
none. And the separate refutation clause — "also refuted if the check-in rate, the chart rate, or
outcome four moves" — cannot be evaluated against a form that never completed a single
question-and-reveal pair.

This is the fourth law again, and the sharpest instance of it yet: **a bench that calls the pipeline
directly measures the pipeline, not the product.** The next-picture design is a two-turn contract,
and a one-turn harness cannot see it.

## Two corrections to my own working, both caught before they became conclusions

1. I read the chart's connection field as `edges`; it is `links`. "Every chart has zero edges" was
   therefore meaningless, and the recount on `links` showed **no chart in any arm has zero links**.
2. A mis-built list made me briefly conclude the question-carrying turns emitted no chart. They do —
   3 and 4 of them, each with a chart.

Both were found by checking the field names against the data rather than by reasoning about them,
which is the only reason they are corrections and not published findings.
