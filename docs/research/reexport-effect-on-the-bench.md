# Which of the night's numbers move with 251 more edges — registered before the run

**Written 2026-09-05 before the check-in runs, with `ecceb7a4` in.**

## The expectation I was asked to test, and why it is wrong

> *"more concepts with neighbours means more charts and fewer no-node refusals; the substantive
> denominator itself may move"*

That is the right reasoning about a repository the change touches. **The bench does not run on one.**

- **All 20 conversations that execute run on `makemore`.** The bank holds 54 (28 makemore, 13
  sequence, 13 shopfront) and `TEACH_EVAL_LIMIT=20` takes the first twenty — every one of them
  makemore.
- **`makemore` is three Python files with no re-exports at all**, and the change is JavaScript and
  TypeScript only.
- **Measured after the change: 5 nodes, 2 edges — identical to before**, and the two edges are the
  same two.

## The registration

**Nothing measured on the bench moves, and that is a prediction with a mechanism rather than a
hedge.** Specifically, against the derived-visual runs:

| number | on | prediction |
|---|---|---|
| visual, substantive 14/21 and 20/26 | makemore | **unchanged** |
| concepts carrying a usable nodeId | makemore | **unchanged** |
| no-node refusals | makemore | **unchanged** |
| check-in [9, 13] of 47 (the gate's own prediction) | makemore | **unaffected by the scan**; it stands or falls on the gate alone |
| *"answered from 211 of 2,591 edges"* | this repository | **moves** — the denominator is now 2,852 |

**Refuted if any bench figure moves outside its established range**, because that would mean the
scan the bench uses did change and my reading of which repository it runs on is wrong. That is a
refutation I can check without a model: rescan `makemore` and diff the graph.

## Why this matters more than the prediction

**One pair of runs cannot answer both questions**, which is what was asked of it. The check-in gate's
runs measure the gate, on a graph the re-export change does not touch. Reading a scan effect out of
them would be reading it out of noise.

The re-export change needs a bench condition on a **JavaScript or TypeScript repository** to be
measurable at all — `shopfront` and `sequence` are both in the bank and neither runs at the current
limit. That is a bench gap, and it is the same shape as the one the lesson-kinds page found for
maths: **the instrument cannot see the thing the change was made for.**

## On the list, as a measured item and not a claim

Python's re-export shapes — `from .x import *` and the `__init__.py` barrel — are unmeasured. The
JS/TS fix says nothing about them, and this page does not either.
