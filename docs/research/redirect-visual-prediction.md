# Does the propose_topology redirect move the visual metric? — registered before the runs

**Written 2026-09-05 before the first call, with `722dc48d` and `af15938a` in.**

## The change being tested

A teach turn that calls `propose_topology` is refused — correctly, it proposes a *change* to the
architecture — and the refusal now names `propose_chart`, says why the two differ, and closes off
the retry. Practical ML's stream-json capture showed a model asking for the board, being refused,
and asking the same way again, with zero visuals across four turns.

## The orchestrator's prediction

Chart calls rise from the 4–12 range and visual leaves zero on both runs.

## Mine differs, and I am registering it separately

**I expect the bench's numbers not to move**, and the reason is mechanical rather than a hunch
about the model.

The redirect fires **only when `propose_topology` is called**. Across four instrumented
20-conversation runs the bench's recorded tool use was `propose_chart` — 4 and 12 calls on the long
belt, 0 and 0 on the short — and no run recorded a `propose_topology` call at all. The bench asks
"teach me X"; Practical ML's turn 4 asked for **the board by name**, which is the phrasing that
sends a model to the topology tool.

So the fix is aimed at a path the bench rarely takes. If that is right:

- chart calls stay inside [4, 12] on both runs
- visual stays at or near 0 of 47
- and the redirect is still correct — it is simply not what the bench measures

**The second fix in this pair cannot move the bench at all**: `af15938a` gives the *ask CLI* a retry
budget, and the bench calls `runAskPipeline` directly with its own `maxRetries: 3`. Its numbers are
untouched by construction, and any movement there would mean something else changed.

## What would refute me

- **Chart calls rise above 12 on both runs** → the redirect reaches the bench's path after all, and
  my reading of which tool the model reaches for is wrong.
- **Visual leaves zero on both runs** → the same, and the more important half, because it is the
  metric the whole belt lane has been chasing.
- **A `propose_topology` call appears in the instrumented output** → my premise that the bench never
  takes that path is simply false, and the prediction fails on its own evidence rather than on the
  numbers.

## Why run it anyway, if I expect nothing

Because "I expect nothing" is exactly the claim that has been wrong three times tonight — the belt
header, lesson state, and the three concept sources each looked obviously right and each moved the
metric the wrong way or not at all. Two runs cost fourteen minutes each and settle it.

And because the honest outcome either way is worth having: if the numbers do not move, that is
positive evidence that the visual failure in the BENCH has a different cause from the visual failure
in Practical ML's CLI walk, and the two have been discussed as one problem all night.

## The rule

Bench README's replication rule: two runs a side, a difference counts only when both runs fall
outside the other side's observed range, direction must agree with the prediction. Long-belt
ranges, honest metric: **check-in [2, 6] of 47**, **stubs [19, 23]**, **chart calls [4, 12]**,
**visual [0, 1] of 47**.

## READ — 2026-09-05

Both runs are in: **`docs/research/redirect-visual-result.md`**. The orchestrator's prediction is
refuted on both halves; mine held on the mechanism (no `propose_topology` call, visual still 0 of 47)
and failed on the number (chart calls 2 and 2, below [4, 12]) — with the caveat, recorded there,
that `d96eac49` changed the bench driver after the baseline was measured, so that range is not
comparable and the drop is not attributable to the redirect.
