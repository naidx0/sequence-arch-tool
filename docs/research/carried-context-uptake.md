# A model does not use carried context it did not fetch itself

**Result, 2026-09-06/07. Fifteen informative arms on the real `sequence` repository,
`granite42-hermes` via a local endpoint. About two hours of card across the whole line.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The finding

> **A block of file names carried from one turn to the next — arriving intact, in three different
> positions, with a question pointing straight at it, and finally instructing the model to use it —
> was never used. Across fifteen informative arms the three names reachable only through that block
> were not spoken once.**

Scoped to exactly four things, each measured rather than assumed:

| | |
|---|---|
| **this block** | eight caller names, a count, and a line saying their contents were not read |
| **these referents** | the distinct callers of `scan.ts`, from the product's own `who_calls` |
| **this model** | `granite42-hermes`, local, reasoning off |
| **this task** | *"which files depend on scan.ts"* → *"of those, which would I change first?"* |

Change any one and the result may not hold. It is not *"carried context cannot help an engineer"*.

## What was measured

A three-turn conversation. Turn 1 asks what depends on `scan.ts` and the model calls `who_calls`,
which returns **84 distinct callers**; the carry keeps the first **8**. Turn 2 asks which to change
first — a question whose pronoun refers to that list.

**Five of the eight are names turn 1's own answer had already spoken aloud**, and the product carries
prior chat prose independently of any carry slot. So naming one of those five proves nothing: two
sources, no way to tell which. **Three are not**: `eval/grade.ts`, `functions/repoFunctionGraph.ts`,
`harness/designDrawBaseline.ts`. Those are reachable only through the block, and nothing was built to
put them there — the repository supplied them.

**Naming one of those three is the whole measurement.**

Every row below is a distinct set of arms; no arm is counted twice. The `tail` rows differ in what
was varied — presence, position, question wording, block voice — not in where the block sat.

| # | condition | question | block voice | informative arms | named one of the three |
|---|---|---|---|---|---|
| 1 | block **absent** (control) | registered | — | 2 | 0 |
| 2 | block present, `tail` — the presence test | registered | describe | 2 | 0 |
| 3 | block present, `tail` — the placement control | registered | describe | 2 | 0 |
| 4 | block present, `before-question` | registered | describe | 2 | 0 |
| 5 | block present, `last` | registered | describe | 2 | 0 |
| 6 | block present, `tail` | **points at the list** | describe | 2 | 0 |
| 7 | block present, `tail` | registered | **instruct** | 3 | 0 |
| | **total** | | | **15** | **0** |

**CORRECTION, 2026-09-07.** This table first listed six rows summing to **13** under a stated total of
**15**. Row 2 was missing — the presence test's two treatment arms, which ran before the placement
flag existed and were `tail` by default. The total was right and the rows were not, which is the
worse way round: the total is the number a reader quotes. Restored and re-verified by summing the
cells against the arm files, not by reading them.

Rows 2 and 3 are both `tail` with the shipped wording and are **not** duplicates: they are four
distinct arms from two studies, run three hours apart, with no timestamp in common.

Four of the arms named one to three of the *five*, so the model was willing to answer with file names
— including the control arms, with no tool call. **Whatever produces those mentions was already
happening before the block existed.**

## What was checked before believing it

A negative is only worth what its preconditions are worth, and three were established before any card
was spent:

- **The slot is reachable on this tier.** The carry's three original slots are gated to teach or edit
  intent and cannot fill on an engineer's ask; the fourth was built for that reason and a gate says so.
- **The carry is connected at all.** It was not: `carryOut` was computed and discarded, with no caller
  in the product ever passing it back. Found by reading the write path, and fixed before measuring.
- **The block reaches the prompt.** Driving the real pipeline with a stub provider and reading what
  the model is handed — the header, the names, `3 of 84`, the contents-not-read line, and none of it
  when there is no carry.

**So the refutation is about the model, not a mechanism that never ran.** Three earlier candidate
measurements in this line were voids for exactly that reason and were refused before spending.

## The precondition found late, and the arm that proves why it matters

**Turn 1's tools are the model's choice.** On some arms it answered with `search_files` alone and
never called `who_calls` — so no list was ever produced, and turn 2 was graded as having declined a
list that did not exist. **Six of twenty-one arms were void this way. Nearly a third, and the rate held as the line grew.**

The clearest case came from the arm designed to be most decisive. Pointed straight at the list, it
answered:

> *"I don't have a list of dependants (i.e., which components depend on what) from earlier in this
> conversation or from the current repository scan."*

**That answer is correct.** Its turn 1 had built nothing. Read without checking the precondition it is
the most over-readable result this line could have produced — a model, pointed at the block, denying
it exists. It would have been quoted as proof the block is invisible. It was proof the block was
empty.

The check is now the harness's, not a reader's: an arm records whether the list was produced and
**exits 6** when it was not, so a batch replaces it. On the next run a slot needed **three attempts**,
two of them caught automatically. Both would otherwise have been graded and reported.

## What this does not claim

- **Not that the idea is dead.** That phrase was reserved in advance for an arm naming *none* of the
  eight. No arm did that; the model answers with names, just never the carry-only ones.
- **Not a statement about other models, repositories, or tasks.** Fifteen arms, one of each.
- **Not that no wording works.** One instruction, written by one person, in one voice. It said *"USE
  THIS LIST to answer the next question … answer with one of these names rather than from earlier
  prose"* and changed nothing.
- **Not powered for a rare effect.** Two to three informative arms a condition.

## The instruction, which was the last cheap cut and failed

The block always *described* itself. `SEQUENCE_ASK_CARRY_VOICE=instruct` makes it say:

> *"USE THIS LIST to answer the next question about `scan.ts` (8 of 84): … When the question says
> "those", "which one" or "of them", answer with one of these names rather than from earlier prose."*

**Three informative arms. Zero mentions of the three.** Two of them named one of the *five* — the
names turn 1 had already spoken — with no tool call at all, which is the model reaching for prose
while being told in the same prompt not to.

**The prior was registered before the run and it held.** The `TOOLS` section opens with *"Retrieve
before you answer"*, and the belt condition recorded **zero retrievals in both arms** on this model
and product. A prompt-level instruction had already failed to produce the instructed behaviour here
once; it has now failed twice, on different behaviours.

**One arm was re-run rather than read.** Its turn 2 called a tool, and the registration said an arm
with a tool call is re-run rather than argued about. Naming zero of three is zero either way — but a
turn that fetched its own information is a weaker test of whether it would reach for the carry, and
the registration said so before the data existed.

## What would change it

Not a wording. Three positions and two voices have now been spent on presentation.

What is untested is **a task where the carried list is the only source** — every arm here ran on a
repository the model could re-scan at will, with a subject its own prose had already discussed. A
model that can always re-derive may simply prefer to. That is a different measurement, not a
re-reading of this one, and so is another model or a longer conversation.

## Cost

**Roughly two hours of card across the line**, of which the negative results account for all of it.
Three candidate measurements were refused before spending: an empty slot, a carry the product never
threaded, and a positional experiment whose arms would have differed in more than one thing. Those
refusals cost nothing and saved more than the runs did.

**Every flag stays off.** `SEQUENCE_ASK_CARRY_WIRE`, `SEQUENCE_ASK_CARRY_REFERENTS`,
`SEQUENCE_ASK_CARRY_PLACE` and `SEQUENCE_ASK_CARRY_VOICE` are default-off and nothing here licenses
shipping any of them.
