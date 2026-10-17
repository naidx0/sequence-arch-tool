# Where the carried block goes — registered before it is built

**Written 2026-09-07, before the flag exists and before any card. The question is placement, not the
carry.**

## Why there is a question at all

Mechanism B refuted clause 1: the carried referent list reaches the prompt and the model does not use
it. Reading the assembled prompt afterwards showed two properties of where it sits:

```
 74%   --- QUESTION ---            "Of those, which one would I have to change first?"
 74%   --- ALREADY IN THIS CONVERSATION ---   <- the carry block
 75%   --- TOOLS (attached repo) ---          <- ~1,363 tokens of instructions
```

- **the block comes AFTER the question**, so *"of those"* is a referring expression pointing at
  nothing at the moment it is read;
- **the whole TOOLS section sits between the block and generation** — the one section on this machine
  already known to have a large, unexplained effect on behaviour.

Neither is a mechanism. They are two properties of a position, and this measures whether either
matters.

## The three placements

| id | where the block goes | which property it fixes |
|---|---|---|
| `tail` | **current** — end of `basePrompt`, after the question, before the belt | neither; this is the control |
| `before-question` | immediately **before** the `--- QUESTION ---` section | the antecedent: the list precedes the pronoun |
| `last` | after the instruction belt, immediately before generation | the distance: nothing between the list and the answer |

`SEQUENCE_ASK_CARRY_PLACE` selects one. Default `tail`, so an unflagged build behaves exactly as it
does today.

## The control, and it is NOT the one mechanism B used

**The control is the same build with `SEQUENCE_ASK_CARRY_PLACE=tail`** — the block present, in its
current position. `SEQUENCE_ASK_CARRY_WIRE=1` and `SEQUENCE_ASK_CARRY_REFERENTS=1` in **every** arm.

Using mechanism B's control (referents off) would compare *placement* against *absence* and differ in
two things. That is the belt confound, and it is the specific mistake this control exists to avoid.

**Arms interleave**: `tail, before-question, last, tail, before-question, last` — one full cycle, then
repeated. **Six arms, two runs a placement.** An earlier draft of this line said four, which
contradicted "two runs a placement" three paragraphs below it; corrected before the run rather than
reconciled after it. Cycling rather than blocking means drift across the hold cannot line up with any
one placement.

## The kill

Unchanged from mechanism B, because the question is the same and only the position moves:

> **turn 2 names at least one of `eval/grade.ts`, `functions/repoFunctionGraph.ts`,
> `harness/designDrawBaseline.ts`** — the three carried callers turn 1's prose never spoke.
> **A placement is refuted if it names none in both of its runs.**

Two runs a placement. The reading is `tools/bench/lib/seat-grade.mjs`, unchanged, applied identically
to every arm — and re-applied to all arms from stored transcripts if the rule changes mid-run, as it
did last time.

## THE MULTIPLE-COMPARISON DISCOUNT, stated before the data

Two placements are tested, so **there are two chances for one to clear**, and a clearing placement is
correspondingly weaker evidence than the same result would be if only one had been tried. This
registration does not pretend to correct that arithmetically — with a binary outcome and two runs a
side there is no p-value to adjust, and inventing one would be worse than naming the problem.

**The discount is replication, and it is mandatory rather than advisory:**

- **one placement clears, the other does not** → the clearing placement is **PROVISIONAL**. It is not
  written up as a result until a **fresh pair of arms on that placement alone** reproduces it. Until
  then the record says *"one of two placements cleared on first test, unreplicated"*.
- **both clear** → stronger on its face, and also the reading most likely to mean the *control* arm
  was anomalous rather than that both fixes work. Before banking it, the control's two runs are
  checked against mechanism B's two control-equivalent arms; if today's control disagrees with them,
  the run is void rather than positive.
- **neither clears** → the refutation is about the block or the idea, not the position. **This is the
  most informative outcome for twenty-eight minutes of card**, and it needs no discount.

**A partial move is the most likely outcome and the easiest to over-read.** One placement clearing
tells you *a* property mattered; it does not tell you the other property is irrelevant, because the
two arms differ in more than the property each is named for — `last` also moves the block past the
belt's 1,363 tokens, and `before-question` also moves it away from them. **Neither placement isolates
one property.** That is stated here so no result page can imply otherwise.

## What could go wrong

- **`before-question` may not be assemblable cleanly.** If the question section is built somewhere the
  carry cannot precede without reordering unrelated material, the arm is dropped and said to be
  dropped, rather than approximated.
- **`last` puts untrusted-derived names after the instructions.** The names come from the scanned
  graph, not from file contents, and the block already says the contents were not read — but placing
  repository-derived text last is exactly where a prompt-injection surface would be. **Registered as a
  reason not to ship `last` on a positive result without a separate look**, whatever it measures.
- **The placement flag itself changes prompt length by nothing.** Same bytes, different position, so
  no token band is registered and none would mean anything.

## What this cannot show

- **Not a mechanism.** Two properties, two arms, one model, one conversation shape. A clearing
  placement says the position matters here, not why.
- **Not whether the carry is worth having.** That was mechanism B's question and the answer stands
  unless a placement clears.
- **Not anything about teach turns.** First-tier ask only.

## Cost

**Six seat arms, ~42 minutes of card**, on the instrument that already ran. A replication pair for a
provisional result is another ~14 minutes.
