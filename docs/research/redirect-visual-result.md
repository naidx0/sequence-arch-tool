# The redirect runs: both predictions refuted, and a third cause of zero visual

**Two 20-conversation runs, `d23fa791` + everything since, GPU lock held for the runs only.**
Registered beforehand in `redirect-visual-prediction.md`. Numbers first, verdicts second, and the
thing neither of us predicted last — which is the part worth acting on.

## The numbers

| metric | run 1 | run 2 | long-belt range | moved? |
|---|---|---|---|---|
| turns (clean) | 47 | 47 | 47 | — |
| paced (<=250 words) | 47/47 | 47/47 | 47/47 | no |
| **check-in (honest)** | **6/47** | **7/47** | [2, 6] | **no** — run 1 inside |
| stubs | 24 | 23 | [19, 23] | **no** — run 2 inside |
| **chart calls** | **2** | **2** | [4, 12] | **YES, both below** |
| **visual present** | **0/47** | **0/47** | [0, 1] | **no** |
| plan calls | 8 | 8 | — | — |
| `propose_topology` calls | **0** | **0** | 0 | no |

Replication rule from `tools/bench/README.md`: a difference counts only when **both** runs fall
outside the other side's range **and** the direction agrees with the prediction. Check-in and stubs
each have one run inside the range, so neither moved. Chart calls are the only metric outside on
both — and they went **down**.

## The orchestrator's prediction: refuted, both halves

> Chart calls rise from the 4–12 range and visual leaves zero on both runs.

Chart calls left the range **downward**, which fails the direction test, and visual sat at **0 of 47
on both runs**. The second half is the one that mattered — it is the metric the whole belt lane has
been chasing — and it did not move at all.

## Mine: two clauses of three held, and the third failed

> chart calls stay inside [4, 12] · visual stays at or near 0 · no `propose_topology` call appears

- **Visual stays at or near 0** — held. 0 and 0.
- **No `propose_topology` call** — held. Zero occurrences in either report and zero in either raw
  log. This was the refutation condition that needed no numbers, and the premise survived it: the
  bench does not take the path the redirect guards.
- **Chart calls stay inside [4, 12]** — **failed.** 2 and 2, outside on both runs.

So the mechanism I argued for is intact and the number I attached to it is wrong.

## But the chart-call drop is not attributable to the redirect, and I have to say so

`d96eac49` (06:53) changed the bench driver: a conversation now advances on `endsWithCheck` rather
than `endsWithQuestion`. **The [4, 12] baseline was measured before that commit** — the ablation
runs land at 03:21 and 03:55. Advancing on a stricter rule changes which turn the model is asked
next, so the two sides do not have the same turn population, and a chart-call difference across that
boundary measures the driver change at least as much as anything else.

The honest statement is: **chart calls fell outside the baseline range, and the baseline is not
comparable.** My clause is still failed — I named a range and the number left it — but nobody should
read the drop as an effect of the redirect. The redirect cannot have caused it: it fires only on a
tool call that was never made.

This is the second-law problem pointed at my own instrument. The fix is a re-baseline under the
current driver before the mid-length belt arm runs, or that arm inherits the same contamination.

## The finding neither of us registered

**Every chart call in both runs was REFUSED, and not by the teach-mode guard — by the chart
validator, for naming things that do not exist.**

Both runs: one conversation (`ml-01`), two calls, zero proposals. The refusals:

```
run 1, call 1: items[0].nodeId: "ui" is not a node in this repository
               links[0].to: unknown item bigram_counts.py; focusItemId: unknown item bigram_counts.py
run 1, call 2: links[0].from: unknown item nn_bigram; links[0].to: unknown item bigram_counts.py
run 2, call 1: items[0].nodeId: "ui" ... items[1].nodeId: "svc" ...
run 2, call 2: links[0].from: unknown item nn_bigram.py; links[1].from: unknown item sampling.py
```

Read the pair in order: the model is handed a refusal naming the invented `nodeId`s, **drops them on
the retry**, and then fails on a second error class it had all along — links whose endpoints are
file names while its own `items[]` carry different ids. It corrects what it is told about, re-offends
on what it is not, and after two tries stops asking.

**So there are three causes of a missing visual, not two:**

1. the model never reaches for the tool — 46 of 47 zero-visual turns in each run;
2. it reaches for `propose_topology` — Practical ML's CLI walk, fixed by `722dc48d`;
3. **it reaches for `propose_chart` and authors a chart the validator rejects** — 1 turn per run,
   100% of the turns that reached.

Cause 3 is small in count and large in kind: it is the only one where the model does everything the
contract asks and still produces nothing.

## What cause 3 suggests, registered rather than built

`validateChart` names the offending value and **not the admissible set**: *"unknown item
bigram_counts.py"* without saying which item ids exist, *"is not a node in this repository"* without
naming a node. That is exactly the shape the topology refusal had before `722dc48d` fixed it by
naming the alternative — and that fix demonstrably worked on the real screen.

**Prediction, registered now:** listing the valid ids in the refusal (`known items: a, b, c`) turns
the second call in each of these pairs into an accepted chart. **Refuted if** a run with the richer
message still shows chart calls > 0 with proposals = 0 on `ml-01`. This is cheap — the ids are
already in scope at the call site in `chart.ts` — and it is a better use of the next build slot than
anything belt-shaped, because it converts a turn that tried into a turn that drew.

It does not, however, touch the 46 of 47 that never reached, which remains the whole problem.

## Amended 2026-09-05: three of the thirteen checks were the belt's own example

Splitting the recorded check-ins by shape (free — both runs store their text)
turned up something the headline number hid. Of **13 closing checks across both
runs**, 8 were predictions and 5 comprehension — and **3 of the 13 read "Which
component do you think X talks to next?"**, the contract's own template variable
emitted literally. `gradeTeachTurn` had no parroting rule at all, and
`gradeCheckIn` caught only 1 of the 3 (its `PARROTED_LABEL` matches a
`Check-in:` prefix, not a placeholder).

A question with a placeholder in it asks the learner nothing. Re-graded with the
fix in:

| | as reported | re-graded | parroted |
|---|---|---|---|
| run 1 | 6/47 | **5/47** | 1 |
| run 2 | 7/47 | **5/47** | 2 |

Both runs now read **5 of 47**, which also collapses the one-inside-one-outside
straddle of the old [2, 6] range into a single figure. The verdicts above do not
change: check-in still did not move by the replication rule, and the numbers the
predictions were read against were chart calls and visual, neither of which this
touches.

**Also amended: 24 of 94 turns end in a CLARIFYING offer** — nearly double the
13 real checks, and the one shape the contract bans outright. That is the same
finding Practical ML reported from four CLI turns, at scale, and it belongs to
the registered mid-length arm's check-in-shape bullet rather than to a fix made
here.
