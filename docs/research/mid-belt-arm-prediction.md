# The mid-belt arm — registered before the first call

**Written 2026-09-05 against the re-baseline ranges, with `3fc5858c` in the tree, before any run.**

## The ruling, and the one change I am making to it

Ruled: the bounce names one problem at a time in contract order, the belt is the registered
mid-length one, prediction against the new ranges, two runs.

**That moves two variables in one arm**, and I am running four runs instead of two so each is
attributable. The whole reason the `[4, 12]` chart-call range had to be thrown away is that a driver
change rode along with the thing being measured; running a two-variable arm now would reproduce that
mistake deliberately, one item after diagnosing it.

| arm | bounce | belt | runs | isolates |
|---|---|---|---|---|
| **re-baseline** (done, `62a8d4f9`) | wall | full | 2 | — |
| **A** | **ladder** | full | 2 | the bounce ladder |
| **B** | ladder | **mid** | 2 | the belt, given the ladder |

A against the re-baseline answers "does naming one problem at a time work". B against A answers
"do the two chart bullets bring the visual back". Neither question can be answered by the two-run
design, and both are answered by the four-run one at the cost of about half an hour.

## The ranges everything is read against

Re-baseline (`re-baseline-2026-09-05.md`): **stubs [22, 24] · check-in [3, 4] of 47 · chart calls
[5, 7] · charts accepted [4, 5] · visual all-turns [1, 3] · visual substantive [0, 0] of 23–25.**

## The prediction

Stated as ruled, and **anything inside the ranges is no evidence** — not a weak signal, not a
trend, no evidence.

**Arm A (the ladder), against the re-baseline:**
- **check-in rises above 4 of 47 on both runs.** The mechanism claimed: the closing check is the
  third rung, so a turn that has a concept and a visual is finally told the one thing left.
- stubs fall below 22 on both.

**Arm B (mid belt), against arm A:**
- **visual on substantive turns leaves 0 of 23 on both runs.** This is the arm's real claim: that
  the bullet saying what a chart is FOR — the half the short belt cut — is what produces a chart
  call, and that a chart on a turn that also teaches is what it buys.
- chart calls stay at or above [5, 7].

Direction agreement is required in both. Outside a range in the wrong direction is a refutation,
not a clear.

## What refutes each

- **A: check-in stays inside [3, 4] on either run** → the wall was not the problem, and the thing
  suppressing the check is neither volume nor wording. That would leave the lesson-state slots, the
  one input never ablated.
- **A: stubs get worse than 24** → the ladder buys focus by spending rounds that used to buy prose.
- **B: visual-substantive stays at 0 on either run** → the chart bullets are not what puts a chart
  on a teaching turn, and the belt hypothesis is finished. Three arms — long, short, mid — would then
  have failed to move it, and the honest conclusion is that the contract is not the variable.
- **B: chart calls fall below 5** → restoring the bullets cost tool use, which would be the short
  belt's result reproduced by a belt that contains the bullets, and would mean length, not content,
  is what the model is responding to.

## The one I expect to matter

I expect **A to fail and B to fail**, and I am saying so before the runs because the record should
show it either way. Every belt-shaped explanation tested tonight has failed: long against short
refuted its own prediction, the TURN SHAPE header did nothing, lesson state did nothing, and the
only two changes that moved a metric were a validator message and a tool redirect — neither of them
in the belt. The visual arrives on stub turns, which says the model can call the tool and cannot do
both jobs in one turn. If B fails, the next question is not another belt.

That is a prediction, not a reason to skip the runs: it has been wrong three times tonight.
