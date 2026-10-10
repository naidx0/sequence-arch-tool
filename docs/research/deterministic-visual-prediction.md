# The visual decided in code — registered before the first call

**Written 2026-09-05 before any run, with the change built and gated.**

## Why the decision moves out of the prompt

Fourteen runs say the model does not draw: **182 of 188 turns attempt no visual in any form** — not
a refusal, not the wrong tool, not the wrong format, no attempt at all. Three belts (long, short,
mid) and a length control all failed to move it, and the mid belt carries both chart bullets
byte-identical to the full one. The two changes that DID move a metric all night — the topology
redirect and the validator naming the admissible set — are both things the model reads **after** it
acts.

So: when the turn's concept names a real node, the product builds the chart and the model writes the
sentence beside it.

## What it will and will not do

Every item is a node from the scanned graph; every link is an edge that exists in it, direction
preserved. It returns **nothing** for a concept with no node, a node not in the graph, or a node
with no neighbours — a one-box diagram is not a picture of a relationship, and shipping one to move
`visual present` would be fabricating evidence to satisfy a metric.

It fires **only when the model drew nothing**, so a model-authored chart still wins whenever it
exists. And it is emitted **before** the grader, so the turn genuinely has a visual and the NO VISUAL
complaint stops firing because it is satisfied, not because the rule was deleted.

## The prediction

Measured on the substantive denominator, two runs, against the re-baseline's **0/23 and 0/25**.

**Visual on substantive turns rises above 0 on both runs.** This one is close to mechanical: the
concept comes from `lesson.json`, most bench concepts carry a `nodeId`, and the chart is built
without asking the model for anything.

**And a second prediction that is not mechanical, which is the interesting one:**
**stubs fall below 22 on both runs.** The reasoning: NO VISUAL fired on 44–47 of every 47 turns and
was the bulk of the wall. Satisfying it removes the largest single complaint, so the model is
answering a shorter list — without being told to ignore anything, which is what the ladder did
wrong.

## What refutes each

- **visual-substantive stays at 0 on either run** → the concepts do not carry usable nodeIds in
  practice, and the lesson-state queue is the thing to fix, not the drawing.
- **stubs do not clear 22 on both** → the wall's size was not what was costing prose either, and the
  bounce is exonerated as a cause. That would leave the model's own terseness, which no change on
  either side of the prompt has touched.
- **charts appear on turns whose concept has no node** → the refusal path is broken and the product
  is inventing structure, which is the one outcome that reverts this immediately regardless of what
  any metric says.

Direction agreement required. Anything inside the ranges is no evidence.
