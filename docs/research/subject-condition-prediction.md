# The repository-less condition, and the first lesson kind — registered, unrun

**Written 2026-09-05. The condition is built; nothing has been run on it. It waits behind the
check-in gate's runs and the sequence condition.**

## What it is

**Twenty asks a learner would type, across three subjects, with no repository attached.**
`subj-01` … `subj-20`: polynomials, derivatives, logarithms, gradient descent, overfitting,
precision and recall, hash tables, binary search, big-O, race conditions.

`repo: null` is a real absence — no path, no graph, no digest, and `resolveReadable` returns nothing
so the reading tools refuse rather than reach outside a root that does not exist.

**There is deliberately no filename-form control**, unlike the paraphrase corpus. The whole point is
that no structure exists to name.

## Why the existing math conversations could not be used

`math-01` … `math-06` read like subject asks and are all *"teach me the math **as used in this
repo**"*, attached to `makemore`. Measured, they already carry visuals at **8 of 13** in the
derived-visual runs, because the **code** chart fires for them. Registering a subject kind against
those would credit it with the code path's gain — the contamination that made the `[4, 12]`
chart-call range unusable this morning.

## The baseline is zero by construction

`buildConceptChart` returns nothing without a graph, so **visual is 0 of N before anything is
built**, and it is 0 for a reason that can be stated rather than measured. That is the property that
makes the condition worth having: any movement is the new kind and nothing else.

**The makemore twenty are untouched.** The subject asks sit at positions 55–74 of a 74-conversation
bank, so `TEACH_EVAL_LIMIT=20` still runs exactly the same twenty makemore conversations every
figure on record was measured on. `TEACH_EVAL_REPO=none` selects the new condition.

*(I got this wrong first: the block went in at the top of the bank, which would have silently
replaced the comparable twenty. Caught before it ran, and the position is now asserted by the
count.)*

## The registered prediction for the math kind

Read **only** against this condition, two runs:

- **visual on the substantive denominator rises above 0 on both runs.** Not mechanical: it requires
  the model to state a plottable expression, which nothing has yet asked it to do.
- **no visual appears on a turn whose expression did not parse.** The product evaluates the points;
  a chart it could not compute must not exist.

**Refuted if** visual stays at 0 on either run — the model does not state a plottable expression when
asked to teach a subject, and no rendering work fixes that — or if any plotted visual carries points
the product did not evaluate, which reverts the kind immediately whatever the metric says.

## What this condition cannot tell us

Whether a plotted lesson is any **good**. It measures that a picture arrived and that it was
computed rather than asserted. Whether a learner is better off is a seat question, and the code
chart has only just been looked at on a screen for the first time.
