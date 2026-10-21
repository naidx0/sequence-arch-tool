# The check-in gate: the prediction holds, and the visual moved 7×

**Run 2026-09-06T00:23–00:48Z at `c96cd425`, `granite42-hermes`, reasoning off, temperature 0.**
GPU lock held for the two runs and deleted in the same turn.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered band, and the result

> *Revised prediction: check-in lands in **[9, 13] of 47** on both runs. Refuted if it stays above 13
> on either run (the gate is not reaching the preambles) or falls below 9 (it is withholding checks
> from turns that did teach).* — `derived-checkin-result.md`

| | run A | run B | band | verdict |
|---|---|---|---|---|
| **check-in** | **11 of 47** | **10 of 47** | [9, 13] | **inside, both runs** |

**The prediction holds.** The gate is reaching the read-first preambles without withholding checks
from turns that taught. For scale: the same metric was **[3, 4] of 47** at the re-baseline and
**[5, 5]** before the closing-beat rule.

## The denominator moved, and that had to be handled before the band could be read

The band was set on **two 20-conversation runs → 47 turns each**. The makemore condition has since
grown to **28 conversations → 63 turns**, so `13 of 63` cannot be read against `[9, 13] of 47`: the
absolute band is not denominator-free, and comparing them directly would have been the third law
broken in the same file that states it.

The first 20 conversations of the current bank give **exactly 47 turns**, which is the baseline's own
denominator, so that is the comparable subset and it is what the table above reports. The full
condition, for completeness: **A 13 of 63 (20.6%), B 10 of 63 (15.9%)** — the band as a rate is
19.1%–27.7%, which A is inside and B is below. **The rate reading and the count reading disagree for
run B**, and the count on the matched denominator is the one the band was written against, so that is
the verdict. Recording the disagreement rather than picking the flattering half.

## The number nobody predicted: the visual

| | run A | run B | re-baseline |
|---|---|---|---|
| **visual** | **21 of 47** | **21 of 47** | **[1, 3] of 47** |

**Seven to twenty-one times the baseline, replicated exactly across two runs.** This is the derived
visual — the chart the product builds in code from the scanned graph rather than asking the model
for — measured on the same denominator as the baseline that motivated it. The registered work on
that change predicted the metric would move; this is how far, on the comparable set.

It is worth being precise about what it does *not* say. `visual` counts a chart shipped on the turn.
It says nothing about whether the chart helped, which is the question
`next-picture-checkin.md` is registered against and nobody has answered.

Mean words per turn: **A 81, B 100**, both far inside the 250-word pacing line.

## Method

`TEACH_EVAL_REPO=makemore`, 28 conversations, two runs, no errored conversations either run. Reports
kept at `tools/bench/out/checkin-run-A.json` and `-B.json` so the counts above can be recomputed
rather than trusted.
