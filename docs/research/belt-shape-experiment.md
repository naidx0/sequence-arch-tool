# The belt-shape experiment: the lever is real, this change is not the one

> **⚠ EVERY CHECK-IN FIGURE BELOW IS THE OLD METRIC.** `endsWithQuestion` is a trailing question
> mark, and 15 of the 31 questions measured were CLARIFYING offers the contract bans outright.
> Re-graded on "ends with a comprehension question or a prediction", where a transcript exists:
>
> | run | reported | **honest** |
> |---|---|---|
> | baseline (no lesson state) | 22/47 | *not re-gradable — no transcript stored* |
> | belt TURN SHAPE header | 14/47 | *not re-gradable — no transcript stored* |
> | lesson state | 20/47 | **3/47** |
> | three sources, LONG A | 12/47 | **2/47** |
> | three sources, LONG B | 18/47 | **6/47** |
> | short belt, run 1 | 19/47 | **1/47** |
> | short belt, run 2 | 19/47 | **1/47** |
>
> The two earliest runs predate the bench recording turn text (`7ad5ee90`), so their honest number
> cannot be recovered and is not guessed at. Do not quote a figure from this file without the
> right-hand column. See `tools/bench/README.md`.


**Run 2026-09-05, 20 conversations before and 20 after, identical configuration, the belt the only
variable. NOT SHIPPED — reverted.** The record of what was tried, because the mechanism it exposed
is worth more than the change was.

## The change

The split in `visual-metric-prediction.md` found the visual instruction present, correct and
ignored — 95.7% of zero-visual turns never called `propose_chart` at all — so the fault is the
belt's SHAPE. Reading it, the shape problem was specific:

> line 1: *"Deliver EXACTLY ONE concept this turn, in at most ~150 words of plain prose."*
> …eleven bullets later: *"EVERY concept ships ONE visual, drawn with propose_chart"*

The belt's first instruction asks for prose and the chart arrives at bullet 12 of 19. So: a
three-line **TURN SHAPE** header (chart first, then the concept, then the check-in) and the visual
bullet moved from position 12 to position 2. Length essentially unchanged.

Folded into the same change, and this was the mistake: the closing-check-in bullet's quotable
example — `("which component do you think X talks to next?")` — was replaced with a description,
because the parroting detector had caught the model emitting it verbatim, placeholder `X` and
`Check-in:` label included.

## The result

| | before | after |
|---|---|---|
| turns | 47 | 47 |
| — of which stubs (<=35 words, no check-in) | 17 | **29** |
| — substantive | 30 | **18** |
| paced | 46/47 (97.9%) | 46/47 (97.9%) |
| ends with a check-in | 22/47 (46.8%) | **14/47 (29.8%)** |
| visual, all turns | 0/47 (0.0%) | **3/47 (6.4%)** |
| visual, substantive turns | 0/30 (0.0%) | 2/18 (11.1%) |
| `propose_chart` calls | 4 | **15** |
| proposals accepted | 0 | **6** |

**The bar was: visual moves off zero without paced or check-in falling.** Visual moved, paced held
exactly — and the check-in rate fell 17 points. It does not ship.

## What it proves anyway: the diagnosis was right

`propose_chart` calls went **4 to 15** and accepted proposals **0 to 6**. Moving one bullet and
stating the turn's order nearly quadrupled the rate at which the model reaches for the tool. The
belt's shape IS the lever — that is the registered diagnosis confirmed by intervention rather than
by inference, which is a stronger form of the same claim.

## Why it failed, and the methodology error underneath

**Two changes went in at once, and they push opposite ways.** An experiment designed to measure one
thing measured two, and the confound is mine.

1. *Chart first* moved the failure rather than removing it. Substantive turns fell from 30 to 18:
   the model spends the turn on the chart and then emits a stub. Telling a small model to do the
   expensive thing first costs it the rest of the contract.
2. *Removing the quotable check-in example* plausibly removed a crutch. The check-in rate fell
   almost exactly when the sentence the model had been copying verbatim was taken away. The
   parroting the detector flagged as a defect may have been carrying the check-in metric — a
   copied-but-correct closing beat still ends the turn with a question.

Per-turn pairing, which separates "the visual cost the check-in" from "both moved for their own
reasons": of the **3** turns that gained a visual, **2** also lost their check-in (`ml-10#0`,
`math-05#0`) — but **8** turns lost a check-in in total. The losses are mostly NOT on the turns that
gained. That points at hypothesis 2 rather than a straight trade.

## Next, as two experiments and not one

- **A.** The TURN SHAPE header and the promoted visual bullet, with the check-in example left
  exactly as it was. If check-in holds and calls stay near 15, that half ships.
- **B.** The parroting fix alone. If the check-in rate falls again with the belt otherwise
  untouched, then the contract's example is load-bearing and the fix must supply a replacement
  sentence rather than a description — the model needs something to copy.

Neither is worth guessing at. Each is one 14-minute run.
