# The re-baseline — the ranges the mid-length arm is written against

**Two 20-conversation runs, 2026-09-05, GPU lock held for the runs only and released in the same
bracket.** Taken under the current advance rule (`endsWithCheck`) and the honest grader, with
`1cfd6478` (the validator naming the admissible set), `28a4a27b` (parroting) and — **the card named
only the first two, and this matters** — `1ebcb42d` (the closing beat must be a check) all in the
tree. Everything that was going to change landed first, on purpose, so the arm can move one thing.

## The new ranges

| metric | run 1 | run 2 | **new range** | previous |
|---|---|---|---|---|
| turns (clean) | 47 | 47 | — | 47 |
| paced (<=250 words) | 47/47 | 47/47 | [47, 47] | [47, 47] |
| stubs | 24 | 22 | **[22, 24]** | [23, 24] |
| **check-in, all turns** | 3/47 | 4/47 | **[3, 4]** | [5, 5] |
| **check-in, substantive** | 3/23 | 4/25 | **[3, 4]** | — |
| **visual, all turns** | 3/47 | 1/47 | **[1, 3]** | [0, 0] |
| **visual, substantive** | **0/23** | **0/25** | **[0, 0]** | [0, 0] |
| chart calls | 5 | 7 | **[5, 7]** | [2, 2] |
| chart proposals ACCEPTED | 4 | 5 | **[4, 5]** | [0, 0] |
| charts refused | 0 | 0 | **[0, 0]** | [1, 1] |
| plan calls | 4 | 6 | [4, 6] | [8, 8] |

## The validator fix worked, and it is the clearest result here

**Charts refused went [1, 1] → [0, 0], and charts ACCEPTED went [0, 0] → [4, 5].** Before this pair
of runs, every propose_chart call ever made in this bench was refused. Now none is. That is
`1cfd6478` doing exactly what it was built to do, at scale, and it is the first thing tonight that
moved a metric in the predicted direction.

## The visual metric left zero — and the substantive denominator says it did not

This is why both denominators were asked for, and the two answers are opposite:

- **all turns: [0, 0] → [1, 3]**, outside on both runs;
- **substantive turns: [0, 0] → [0, 0]**, unchanged.

Every turn carrying a visual is a **stub**: `ml-01` at 26 words, `ml-11` at 27 and 11, none ending in
a question. The model drew a chart and said almost nothing. So the honest sentence is: *the chart
now lands, on turns that teach nothing.* Reporting `visual 5%` from the left-hand column alone would
be true and would mean the opposite of what it sounds like.

## My registered prediction on `1ebcb42d` is REFUTED

> check-in clears [5, 5] of 47 on both runs

**It fell: 3 and 4.** Both runs outside the old range, direction opposite to the prediction. The
bounce did not convert offers into checks — closing shapes went clarifying 12 → 14 per run,
comprehension 2 → 1, prediction 3 → 2.

**The reversal condition I registered was NOT met**: stubs [22, 24] against a prior [23, 24] is not
worse. So by the criteria written before the numbers existed, `1ebcb42d` stays: it is not paying
off, and it is not costing what would have condemned it. I am not reversing it on a metric it was
not registered against, and I am not keeping it quietly either — it is a null result, recorded.

**And a caution about that comparison.** Four earlier runs of this metric under identical
configuration spanned [1, 6] of 47. A move from [5, 5] to [3, 4] clears the replication rule only
because [5, 5] is a two-run range that happened to be tight. Against the metric's own historical
spread this is inside the noise, and the prediction fails for the plain reason that it predicted a
rise and there was none — not because a fall was established.

## Why the bounce did not land, mechanically

The contract problems fired as designed — `closing:offer` 14 and 14, `parroted` 2 and 2 — so the
change was live. But look at what else fires on the same turns:

```
NO VISUAL                      44 / 46   (of 47 turns)
closing: no question at all    27 / 27
question asked and abandoned   15 / 17
closing: an offer              14 / 14
citations without reading       9 / 10
```

The bounce message concatenates **every** problem into one wall of complaint, and the model gets two
corrective rounds to satisfy all of it. Adding a sixth complaint to a list of five does not direct a
4B-class model; it dilutes. **That is the finding to carry into the arm**: the teach bounce fires on
essentially every turn, and its failure mode is volume, not absence.

## What this baseline is for

The mid-length belt arm reads against **[22, 24] stubs · [3, 4] check-in · [5, 7] chart calls ·
[1, 3] visual all-turns · [0, 0] visual substantive**, two runs a side, difference counted only when
both runs fall outside the other side's range with the direction agreeing.

## Why there is no visual: the four causes told apart

`visual present: 0%` has at least four causes and each implies a different fix — refused by the
validator, the wrong tool, the right idea in the wrong format, or no attempt at all. Nothing had
separated them, so `tools/bench/visual-absence-probe.mjs` now does, over all four reports (188 clean
turns):

| verdict | count |
|---|---|
| visual | 4 |
| refused by the validator | 2 (both pre-`1cfd6478`) |
| wrong tool (`propose_topology`) | 0 |
| wrong format (drawn in prose) | 0 |
| **never attempted** | **182** |

**182 of 188 turns carry no attempt signal of any kind** — no `propose_chart`, no tool fence, no
items-shaped JSON, no provider tool-call syntax, no mermaid, no diagram drawn in the answer. That
closes every "the harness is losing it" hypothesis at once: it is not a parser gap, not a
mis-addressed tool, not a format the grader refuses to count.

The probe prints the signals it scanned for, because a probe reporting an absence that does not say
what it looked at is one regex away from a confident zero — which has happened four times in this
repository.

**And it caught itself doing exactly that.** Its first version guessed at the glyph set for "drew a
diagram in prose", included prose arrows, and reported four ASCII diagrams that were `'A' → 1` in an
explanation and `W ← W - lr × dNLL/dW` in a formula. The product's rule was narrow and correct; the
copy written for the probe was loose and wrong. That is the third pair of duplicated rules found in
one session, and it was fixed the same way as the other two: `drewInProse` is exported from
`askPipeline.ts` and the probe imports it, so there is one definition.
