# Does hidden reasoning earn its wall clock? — the rule, written before the numbers

**Registered 2026-09-05, while the paired run was at 4 of 7.** The decision rule below is fixed
now so it cannot be fitted to the answer afterwards, the same discipline as
`visual-metric-prediction.md`.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


**Honest caveat about what "before" means here.** Four of the seven pairs had already printed when
this was written — ml-01 through ml-04. So this is registered ahead of ml-05, ml-06 and ml-07 and
ahead of every *aggregate*, but it is not blind to the first four. A rule written with four of seven
visible is weaker than one written with none, and saying so is cheaper than pretending otherwise.

## What is being compared

`granite42-hermes`'s chat template sets `enable_thinking = True` unless the request defines it
otherwise, so every Teach turn opened a reasoning block that nothing grades and no reader sees.
Turning it off is worth roughly **4× the wall clock** — measured, conversation ml-01 at 94 s against
about 402 s clean-with-thinking, and 2,615 s when the card was contended.

The question the speed-up does not answer: **was the reasoning doing work for the teach contract?**
The first data point said it might be — ml-01's paced rate fell 100% → 67%, its check-in rate
67% → 33%, its visual rate 33% → 0%.

Both runs cover ml-01…ml-07 over the same repository with the same scripted learner replies and
temperature 0, so this is a paired comparison on identical conversations, not two samples.

## The rule

Compare the seven paired conversations on the three teach metrics — **paced**, **ends with a
check-in**, **visual** — each reported with its denominator, errored conversations excluded from
both sides and counted separately.

- **If thinking-off loses two of the three by twenty points or more**, hidden reasoning is doing
  real work for the contract. The product keeps thinking on; the bench reverts to thinking on with
  the client deadline raised so a call ends because the model ended; and the wall-clock cost is
  recorded as the price of compliance rather than treated as waste.
- **If thinking-off holds within twenty points on at least two of the three**, it ships for Teach —
  in the same commit as the test that the wire carries the option — and the bench continues as
  restarted.

Twenty points is a wide band on purpose: seven conversations is a small denominator, and a rule
tight enough to be tripped by one turn would be measuring noise.

## What this rule cannot settle

A metric is not the product. These three grade whether a turn paces itself, ends on a check-in and
ships a visual — they say nothing about whether the *explanation was any good*, and hidden reasoning
is exactly the kind of thing that could improve an answer's substance while leaving all three
unmoved. A "holds within twenty points" result licenses shipping thinking off **for the bench's
contract**, and does not establish that the lesson is as good.

The stronger check, if this ever matters more than wall clock, is the skipper bench: it asks whether
a question required having followed the lesson, which is closer to substance than any of the three.

---

# The numbers

Read 2026-09-05, six paired conversations (ml-03 excluded: it errored on the thinking-on side, at
the five-minute cut). Turn-level, because a per-conversation rate averages a two-turn and a
three-turn conversation as if they were the same measurement.

| metric | thinking ON | thinking OFF | delta |
|---|---|---|---|
| paced (<=250 words) | 14/14 (100%) | 13/14 (93%) | −7 pts |
| ends with a check-in | 9/14 (64%) | 5/14 (36%) | **−29 pts — lost** |
| visual | 2/14 (14%) | 0/14 (0%) | −14 pts |

Wall clock over the same six conversations: **6,100 s on, 297 s off — 20.5×.**

**By the rule as written, thinking-off ships: two of three held within twenty points.**

## The rule is wrong, and it is wrong in a way I should have seen when writing it

**A twenty-point absolute band cannot be tripped by a metric whose baseline is fourteen points.**
The visual rate went 2/14 to 0/14 — every visual in the sample, gone — and that counts as "holding"
only because 14 < 20. The band was chosen to be forgiving of a small denominator, and on a
low-base-rate metric it is not forgiving, it is blind.

Stated as substance rather than as arithmetic: thinking-off leaves pacing alone and degrades the
other two, one of them to zero.

This is recorded rather than quietly re-cut because a rule edited after the numbers are read is not
a rule. The next version of it should compare relative change, or set the band per metric from its
own baseline, and it should be written before the next run rather than repaired after this one.

## And it confounds the run it was meant to unblock

The twenty-conversation run exists to split the zero-visual turns three ways — never asked, asked
and refused, drew but uncounted — against the prediction registered in
`visual-metric-prediction.md`. With thinking off the visual rate is **0/14**, so that split would be
computed over a configuration in which the metric under investigation has been zeroed, and it is not
the configuration the prediction was registered against.

## Not shipped

The product default is unchanged. Two reasons, and the first is enough on its own:

1. The evidence does not support it. The rule's verdict rests on a band that cannot fail for the
   metric that fell furthest.
2. Whether Teach should suppress hidden reasoning is a product decision — a latency-for-substance
   trade — and these three metrics grade the SHAPE of a turn, not whether the explanation was any
   good. Hidden reasoning is precisely the kind of thing that could improve substance while leaving
   pacing and check-ins untouched.

The bench keeps `reasoningEffort: 'none'` because its own contract does not grade reasoning and the
20× makes the run possible at all. The wire option ships as an opt-in that puts nothing on the wire
unless asked — which is a smaller and more defensible claim than changing what Teach does.
