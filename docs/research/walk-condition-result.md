# The walk condition — every registered prediction confirmed

**Two runs a side, 2026-09-06T09:12–09:54Z, `granite42-hermes`, one card window, bands registered in
[`walk-condition-prediction.md`](walk-condition-prediction.md) before any run.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


Control is `seq-new-1` and `seq-new-2` — the two new-scan arms only, never the old-scan ones —
restricted to the six conversations the walk changes, under the corrected statistic.

## The six changing conversations

| | stubs | lesson turns | concepts | pictures | **concepts ÷ lesson turns** |
|---|---|---|---|---|---|
| `seq-new-1` (control) | 2 | 10 | 6 | 6 | **60%** |
| `seq-new-2` (control) | 3 | 9 | 8 | 8 | **89%** |
| `walk-1` | 1 | 11 | 11 | 11 | **100%** |
| `walk-2` | 3 | 9 | 9 | 9 | **100%** |

**1. Concepts ÷ lesson turns ≥ 95% on both runs** — registered; refuted below 89%.
**Measured 100% and 100%. Confirmed.** Both runs sit above the control's own maximum, in the
predicted direction, so the replication rule is satisfied rather than merely not violated.

**2. Pictures ÷ lesson turns ≥ 90% on both** — **measured 100% and 100%. Confirmed.** Every lesson
turn that was given a concept drew a picture, in both runs.

**3. Lesson turns inside [9, 10]** — measured **11 and 9**. `walk-1` is outside, `walk-2` is inside,
so there is no move in both runs in the same direction and the band holds. Stated in advance as a
thing to watch rather than a claim, and it is still that: two control runs cannot bound this.

**4. The four empty-queue conversations stay at zero concepts** — `harness-03`, `-05`, `-06`, `-08`:
**0 concepts in both walk runs**, as in both control runs. Confirmed. Nothing reached them, which is
what "no queue to walk" has to mean.

**5. The three already-walking conversations do not move** — `cs-06`, `harness-01`, `harness-04`:
100% in every arm, control and treatment alike. Confirmed.

Predictions 4 and 5 were registered as the ones worth most, because they are near-deterministic and
fail loudly if the comparison is not what it claims. Neither moved, so the comparison is what it
claims to be.

## What this does and does not establish

The mechanism is exactly the one predicted and nothing more. Before the change, a two-turn
conversation held one concept for two turns and the second turn had nothing left; after it, the
queue has six and every lesson turn holds one. The chart drew on 100% of concept turns before and
after — **the walk added concepts, it did not change the picture.**

**It does not show that the longer queue teaches better**, and the registration said so in advance:
a learner handed six files in two turns may be worse off than one handed one file well. Nothing here
measures that, and nothing here may be quoted for it.

## The checkpoint prediction, on the same build at last

`walk-2` ran with `TEACH_EVAL_WRITE_SESSIONS=1`, and the window's walk mode rebuilds nothing
afterwards — so for the first time the sessions were written by the build that opened them, which is
what the prediction always required and what the first attempt accidentally destroyed.

```
bench sessions          13
  carrying a chart      9
  no chart to migrate   4
MIGRATED 0 of 9   (registered: 0 of 13)
```

**Confirmed**, with a correction to the registration that is mine: I registered `0 of 13` when only
**9** of the thirteen can carry a chart at all — the other four are the empty-queue conversations,
which have no chart to migrate and never could have. The substance holds exactly: a same-build open
re-derives nothing and says so. `migrated 0` is only worth something because the same code migrated
`9 of 9` when the builds genuinely differed, which is the half already on record.
