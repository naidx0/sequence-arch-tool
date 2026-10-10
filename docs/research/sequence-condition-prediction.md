# A bench condition that can see the re-export change — registered before the runs

**Written 2026-09-05, condition built, before any run.**

## Why it exists

The re-export change added **251 edges to this repository — one dependency edge in eleven** — and
**not one number the bench produces could move**, because all twenty conversations that run are on
`makemore`: three Python files, no re-exports, and not JavaScript. The instrument could not see the
change it was made for.

`TEACH_EVAL_REPO=sequence` selects the thirteen bank conversations that run on this repository
instead: `harness-01` … `harness-08`, `cs-05`, `cs-06`, `link-04`, `mix-03`, `mix-06`.

**It filters; it does not reorder.** The makemore twenty are untouched and every figure on record
stays comparable on them — that was the ruling and it is the right one, because a condition that
moved the existing numbers would cost more than it bought.

## The card cost, stated before it is spent

**Four runs of thirteen conversations**: two on the old scan and two on the new. The makemore runs
average ~14 minutes for twenty, so thirteen is roughly nine, and **four runs is about 36 minutes**
plus scan time on a 1,000-file repository, which is materially slower per turn than makemore. Call
it **45 to 60 minutes** of card time, and it must not be started inside another lane's lock.

## Baselines to record on the OLD scan, before the change is measured

None of these exists yet — the sequence conversations have never been run as a condition. So the
first two runs establish, and the second two compare:

- **visual on the substantive denominator** (the metric the derived visual is judged by)
- **check-in**, honest grader, both denominators
- **no-node refusals** — concepts whose `nodeId` names nothing, which is what more edges should reduce
- **"answered from N of M edges"** — M is 2,600 before and 2,852 after, and N is the claim under test

## The prediction

On the **new** scan against the **old**:

- **no-node refusals fall.** 185 of 1,023 files changed their inbound count and 22 went from "nothing
  depends on this" to having dependents, so more concepts have a neighbour to draw.
- **visual on the substantive denominator rises**, for the same reason: `buildConceptChart` returns
  nothing for a node with no neighbours, and there are now fewer such nodes.
- **check-in does not move on the scan** — it is decided by the gate and the model, and neither
  reads the edge count.

**Refuted if** no-node refusals do not fall on both runs, or if visual-substantive does not rise on
both. Either would mean 251 edges are not where the lessons look, and the honest conclusion would be
that the change is real but irrelevant to teaching — worth knowing before more scanner work is done
on the strength of it.

## What this cannot answer

The old-scan baseline has to be measured with the code as it is now, so it is a **reconstruction**:
the scan is re-run with re-export edges removed, not a genuine time-travel to yesterday's binary.
Anything else that changed today rides along in both halves equally, which is the property that
makes the comparison fair even though it is not a true before.
