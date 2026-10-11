# The pointed probe — pointed at the list, the model answers from prose instead

**Two informative arms plus one void, 2026-09-07T17:30:18Z–18:05:28Z, `granite42-hermes`, the real
`sequence` repo, `PLACE=tail`, `WIRE=1`, `REFERENTS=1`. Card released 18:05:28Z.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The probe

Turn 2 was replaced with a question that **points at the carried list without reproducing it**:

> *"Using only the list of dependants you were already given earlier in this conversation, name the
> single one I would have to change first."*

A question naming the files would be answered by copying them back and would prove the model read the
*question*. This makes it find the list.

## The result, against the readings registered before the data

| arm | turn 1 produced a list | turn 2 verdict | of the three |
|---|---|---|---|
| 17:30:18 | **no — VOID** | — | — |
| 17:34:16 | yes | INCONCLUSIVE | **0** |
| 18:00:27 | yes | INCONCLUSIVE | **0** |

The registered reading for this outcome, written in advance:

> *names only the five → **the model is answering from prior prose, even when pointed at the list.**
> Not a pass.*

**That is the result.** Both informative arms named carried callers — but only ones turn 1's own
answer had already spoken aloud, never one of the three the carry alone holds.

**Not the strongest negative available.** The registration reserved *"the idea is dead"* for an arm
naming **none**, and neither did. The model answers with file names willingly; it just never reaches
the ones that exist only in the block.

## The void arm is the most direct evidence in the stage

The first arm's turn 1 called `search_files` alone — `who_calls` never ran, so no list was ever
produced. Its answer:

> *"I don't have a list of dependants (i.e., which components depend on what) from earlier in this
> conversation or from the current repository scan. Because no dependency information was provided, I
> can't identify the single service or component whose change would come first."*

**That answer is correct**, and it is the reason the precondition now exists. Read without checking
turn 1 it is the single most over-readable result this stage could have produced — a model, pointed
straight at the carried list, flatly denying it has one. It would have looked like proof the block is
invisible. It was proof the block was empty.

## The aggregate, which needs no split and no control

Across **twelve informative arms**, spanning:

- both presence conditions (`REFERENTS` on and off),
- all three placements (`tail`, `before-question`, `last`),
- both question wordings (registered and pointed),

**the three discriminating names have not been spoken once.** Zero of twelve.

Every slot is now refuted on **two informative arms** — including `tail` and `before-question`, whose
second informative arm this run supplied, closing the half-evidence gap the placement correction
disclosed.

| slot | informative arms | of the three | |
|---|---|---|---|
| mechanism B (presence) | 2 treatment | 0, 0 | REFUTED |
| `tail` | 2 | 0, 0 | REFUTED |
| `before-question` | 2 | 0, 0 | REFUTED |
| `last` | 2 | 0, 0 | REFUTED |
| `tail` + pointed wording | 2 | 0, 0 | REFUTED |

## The precondition earned its keep on this run

`tail/registered` needed **three attempts**: two arms in a row produced no list and exited 6, and the
third was informative. **Those two would have been graded NULL and reported as evidence** — exactly
as three earlier arms were, before the check existed.

Five of seventeen arms in this stage were void. **Nearly a third.** A stochastic precondition needs
checking per arm, and a harness that only reports what it measured cannot tell you it measured
nothing.

## What this licenses, and what it does not

**The carried referent list is not used by this model on this task**, under every condition tested:
present or absent, in three positions, and when the question points straight at it. `REFERENTS`,
`PLACE` and `WIRE` all stay off.

**It does not say the idea is worthless.** One model, one repository, one conversation shape, and a
question form nobody actually types. A different model, a task where the list is the only source, or
a block the model is *instructed* to use rather than shown — none of these is tested, and the last is
the only cheap one left.

**It does say the next thing is not more plumbing.** Four registered measurements have now been spent
on presence, position and phrasing of a block that arrives intact and goes unread. **The remaining
question is whether an instruction changes it, and if that fails the honest conclusion is that this
model does not use carried material it did not fetch itself.**
