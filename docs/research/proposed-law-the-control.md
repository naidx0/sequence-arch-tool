# Proposed to the research lane: a law about what the control *is*

**Proposed 2026-09-06 by the Sequence lane. Not adopted here — the research lane rules on it.**

## The proposal

> **An arm's control must differ from the treatment in the change under test and nothing else. A
> control taken before an unrelated change is not a control.**

## Why it is distinct from the two laws already on the page

The fifth and sixth laws govern what a **clause** does:

- **fifth** — a clause comparing rates across arms of different lengths measures composition, not
  quality;
- **sixth** — a kill number must be a quantity the change can move.

Both are about the *threshold*. This one is about the *baseline*: a clause can be perfectly formed,
name a quantity the change moves, compare matched positions — and still be unattributable, because
the thing it is compared against differs in more than one way.

It is the first of the day about **experimental design** rather than about an instrument.

## The evidence: one incident, with times

Stage one of the ask-path window, 2026-09-06, measuring whether a per-turn carry reduces the loop.

| | ran | build |
|---|---|---|
| control `ceiling-1`, `ceiling-2` | **14:58–16:24Z** | before the advance rule |
| the advance rule `96aaeea8` shipped | **17:39Z** | — |
| treatment `carry-1`, `carry-2` | **19:06–20:08Z** | after it, and with the carry |

The treatment carried **two** changes; the control carried neither.

**Repeated concepts went 25, 25 → 1, 0.** Distinct concepts across a run went **11 → 35**. It is the
largest movement any arm has produced in this repository, and it is worth nothing to the question
that was asked, because the advance rule had been registered days earlier with this exact kill
number — *fewer than 3 repeats against 18 and 17* — and it is the overwhelmingly likely cause.

The carry's own effect is **unmeasured**. The number that moved belongs to a different registration,
which it duly answered by accident.

## The cost, which is the argument

The wrong control does not produce a null result. **It produces a strong result attached to the wrong
cause**, and a strong result is exactly what nobody re-examines. Had the confound gone unnoticed,
"the carry collapsed repeats from 25 to 1" would have entered the record, been cited, and been built
on — and the carry is a component already known to be defective twice over and slated for redesign.

That is the asymmetry worth writing down: a badly formed clause usually refutes and irritates. **A
badly chosen control confirms and persuades.**

## What adopting it would require

Three things, none expensive:

1. **A registration names the build**, not only the arms — a commit, so "same build" is checkable
   rather than remembered.
2. **A control is re-run when the build moves**, or the reading is labelled confounded and reported
   as such beside the valid one.
3. **A change is designed to be measurable against a same-build control from the start**, which is
   free at design time and costs a second pair of arms afterwards.

The Sequence lane has already applied the third to the belt condition running now: its registration
named `ceiling-1/2`, those arms are invalid under this proposal, and a valid same-build control
(`carry-1/2`, flag off, no source moved since) existed already. **The registration was not rewritten**
— the correction is recorded and both readings will be reported, because editing a control after a
run has started is the thing registrations exist to prevent.

## What the proposal does not claim

- **Not that the advance rule caused the collapse.** It is overwhelmingly likely and the size matches
  its registration, but those arms cannot separate the two changes, and asserting it as confidently
  as the null result would be reading the confound in the flattering direction.
- **Not that every arm must be re-run when anything changes.** A change that provably cannot touch
  the measured quantity leaves a control valid — but "provably" is the word, and the sixth law is how
  you show it.
- **Not that this is novel.** It is standard experimental practice. It is proposed as a *law here*
  because this repository just paid for not having written it down.
