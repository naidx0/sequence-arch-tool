# The visual decided in code: the metric moves, and the second prediction fails

**Two runs, 2026-09-05, lock held for the runs only. Registered in
`deterministic-visual-prediction.md` before the first call.**

## The no-node check, first, because it could have ended the change

**0 derived charts on a turn whose concept was absent, both runs.**

Two turns did carry a visual with no concept — `ml-07` and `ml-12` — and both were **model-authored**:
the model called `propose_chart` itself and `validateChart` accepted it. That is not the refusal path
and not the product inventing structure. The refusal path held on 54 derived charts.

## The numbers

| | re-baseline | **derived visual** |
|---|---|---|
| **visual, substantive** | **0/23, 0/25** | **14/21, 20/26** |
| visual, all turns | 3, 1 of 47 | 29, 30 of 47 |
| of those, derived | — | 26, 28 |
| of those, model-authored | 3, 1 | 3, 2 |
| **stubs** | **22, 24** | **26, 21** |
| check-in | 3, 4 of 47 | 3, 5 |
| median words | 33, 58 | 30, 47 |
| NO VISUAL complaint fired | 44, 46 of 47 | **18, 17** |

## Prediction 1 — confirmed, and it is the first thing all night to move on this denominator

> visual on substantive turns rises above 0 on both runs

**14/21 and 20/26** — 67% and 77%, against **0/23 and 0/25**. Both runs outside, direction agreeing,
by the widest margin any change has produced. Across the fifteen runs before this one the substantive
visual was zero every single time, including under three belts and a length control.

It is worth being precise about what that does and does not prove. It shows the *mechanism* works:
the concept names a node, the graph has the edges, the chart is built and validated. It does not
show the pictures are good — that is a seat question, not a bench one, and nothing here has looked
at one on a screen.

## Prediction 2 — refuted, and the refutation is the useful half

> stubs fall below 22 on both runs

**26 and 21.** One above the re-baseline range, one below it. The registered refutation was *"stubs
do not clear 22 on both"*, and they did not.

**And the mechanism it was testing is now cleanly dead.** The reasoning was that NO VISUAL fired on
44–47 of every 47 turns and was the bulk of the wall, so satisfying it would leave the model
answering a shorter list. **The wall did get much shorter — NO VISUAL fell from 44 and 46 to 18 and
17, a 60% cut in the dominant complaint — and stubs did not improve.**

So the bounce is exonerated as a cause of terse turns, in both directions: the ladder cut the wall to
one complaint and stubs got much worse (31, 34); this cut it by 60% and stubs did not move. **The
size of the complaint list is not what decides whether the model writes a lesson.** That leaves the
model's own terseness, which nothing on either side of the prompt has touched.

## What the residual says about where to go next

Seventeen or eighteen turns still have no visual, and they are exactly the turns where
`buildConceptChart` returned nothing — a concept with no `nodeId`, or one naming a node the graph
does not have. That is the **lesson queue**, not the belt and not the drawing: `buildQueue` produces
concepts that do not always name a real node.

My registered refutation for prediction 1 named this as the thing to fix if the visual stayed at
zero. It did not stay at zero, and the same defect is now the whole of the residual.

## Standing caveat

Every number here is the bench. The product renders the same `teachContext` since `f23274a3`, so the
belt input matches — but the bench calls `runAskPipeline` directly and no one has watched a derived
chart arrive on a real screen. `docs/CANON.md`'s rule applies: fixture scale proves logic, only a
real repo proves the result.
