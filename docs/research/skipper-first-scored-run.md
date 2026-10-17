# Do teach mode's questions need the lesson? — 10 of 31

**The first scored run of the skipper bench, 2026-09-05.** Until now the bench counted questions;
this measures them.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


Model `granite42-hermes`, 1 attempt per condition, 31 questions from the 20-conversation run,
thresholds `defectAtOrBelow: 0.2`, `pulseAtOrAbove: 0.8`.

## The number

**10 of 31 questions (32.3%) required having followed the lesson.** 21 did not.

All 31 were gradable — every question's own turn answered it, so the reference existed in each
case and nothing was scored against a guess.

| verdict | count | example | W | G |
|---|---|---|---|---|
| **good** | 10 of 31 | `ml-03 t1` — *"Explain how these components interact based on the import edges?"* | 1 | 0 |
| **defect** | 21 of 31 | `ml-01 t2` — *"Is there anything else you'd like to know about how these files interact?"* | 0 | 0 |
| **pulse-check** | **not measured** | — | — | — |

## The pulse-check zero was mine, and it is not a zero

`verdictFor` returns `pulse-check` only when `correctP` is a number. **0 of 31 rows had one** — the
prior-only condition is not implemented; I built W and G. The first run printed `pulseCheck: 0`,
which reads as "no question was answerable from general knowledge" and meant "the condition never
ran".

`summarize` now returns `null` there unless something actually measured it. A verdict that prints a
zero it did not measure is the FIRST LAW in miniature: a gate you cannot make fail.

## The cross-tab, which is the finding under the number

| shape | count | of those, defect |
|---|---|---|
| clarifying-shaped ("would you like…", "anything else…") | 16 of 31 | **12** |
| everything else | 15 of 31 | **9** |

**Fixing the closing-question shape recovers part of it and not most of it.** Nine questions that
are not menus still fail to discriminate — they are questions the graph answers without the walk,
which is a different defect and needs a different fix.

## The example is worth reading twice

> *"Is there anything else you'd like to know about how these files interact?"* — W = 0, G = 0

**Neither condition could answer it, because it is not a question about the material.** It is a
menu. That is a different failure from "the question was too easy", and the current verdict calls
both `defect`, which hides it.

## What this does not say

One attempt per condition, so each `correctW` and `correctG` is 0 or 1 and the discrimination index
is −1, 0 or 1. The 0.2 threshold is doing no work at k=1; it will matter at k≥3, and until then the
verdict is really "did W beat G on a single try". Run it at higher k before treating 32.3% as a
number to move.

The judge is the same model that produced the answers. It refuses `I DO NOT KNOW` outright, which
removes the commonest false match, but a shared blind spot between answerer and judge would not show
up here.
