# Mechanism B — clause 1 refuted: the carry reaches the prompt and the model does not use it

**Four arms, 2026-09-07T15:18:48Z–15:46:34Z, one card hold (1,666 s), `granite42-hermes`, the real
`sequence` repo, three turns an arm, interleaved control/treatment/control/treatment, tree at
`9fd1a212`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered clause

> **Clause 1:** on a three-turn dependency conversation, turn 2 names at least one of
> `eval/grade.ts`, `functions/repoFunctionGraph.ts`, `harness/designDrawBaseline.ts` — the three
> carried callers turn 1's prose never spoke. **Refuted if it names none in both runs.**

| arm | flag | turn 2 verdict | of the three | of the five | tools on turn 2 | attributable |
|---|---|---|---|---|---|---|
| control-1 | off | NULL | 0 | 0 | none | 0 |
| control-2 | off | NULL | 0 | 0 | none | 0 |
| treatment-1 | **on** | **INCONCLUSIVE** | **0** | 3 | none | **0** |
| treatment-2 | **on** | NULL | **0** | 0 | `read_file` | refused |

**Neither treatment run named one of the three. The clause is REFUTED.**

## The refutation is about the model, not about a mechanism that never ran

Three earlier voids in this stage were changes that could not have worked — an empty slot, a carry
the product never threaded, an experiment whose arms differed in nothing. **This is not one of
them**, and that was checked rather than assumed.

The arms could not settle it themselves: `carryOut` is stripped from the payload as an internal
field, the context breakdown does not name the carry as a section, and adding a client-visible copy
of the prompt to make the measurement easier would be the instrument writing its own result. So it
was settled where it could be — `packages/analyzer/src/test/carry-referents-delivered.test.ts` drives
the real pipeline with a stub provider and reads the prompt the model is handed:

- with the flag on, the prompt carries the block header, the carried names, **`3 of 84`**, and the
  line saying the contents were not read;
- with no carry, none of it appears — so the first case is not passing on text the prompt always
  contains.

**The list arrives. The model does not use it.** That is a finding about the answer, not about the
plumbing, and it is the first result in this stage that is.

## What treatment-1 did instead, which is the interesting half

It named `cli.ts`, `diagramCli.ts` and `doctor.ts` — **three of the five that turn 1 had already
spoken aloud** — and called no tool at all.

**Registered in advance as INCONCLUSIVE, and it is reported as inconclusive.** Prior chat prose is
carried by the product independently of any carry slot, so those three have two possible sources and
the run cannot say which. It is not weak evidence for the carry; the carry is not the only path to
them, so it is no evidence for it. Reported as *"turn 2 named an item from turn 1's list"* it would
be true and worthless.

**It is suggestive of something else**, and that is worth saying without banking it: the control arms
named nothing at all, and the treatment arm that had the block named three carried items with no
tool call. If a fifth arm reproduced that, the question worth asking is not whether the carry works
but whether it changes *which* prior material the model reaches for — a different question from the
one registered here, needing its own registration.

## A correction made during the run, and applied to every arm

The attribution rule reported treatment-1 as **"3 items the carry alone could have supplied"**. That
was false, and the verdict one line above it already said so.

`attribute()` refused attribution when a tool ran, but did not model **prior prose** — so a
prose-explained name with no tool call was credited to the carry. The verdict called it INCONCLUSIVE
for exactly the reason the attribution ignored, and the two contradicted each other in the same
output.

Fixed so a prose-explained name is **never** attributable, recorded separately instead; two cases
lock it. **All four arms were then re-graded from their stored transcripts by the corrected rule**,
so every number above comes from one reading applied uniformly, not from the reading each arm
happened to run under.

This is the flattering error the rule was built to prevent, arriving through a door the rule did not
model. It was caught because the arm printed its verdict and its attribution next to each other and
they disagreed.

## WHERE THE BLOCK SITS — read from the assembled prompt, at zero card

Asked before anything else was built on this result, and answerable from the prompt the delivery
check already captures. The assembled prompt is **19,583 chars (~5,440 tokens)** and the order is:

```
 28%   --- STRUCTURE DIGEST ---
 ...   <untrusted_repo_content>  (the scanned workspace)
 74%   --- QUESTION ---            "Of those, which one would I have to change first?"
 74%   --- ALREADY IN THIS CONVERSATION ---   <- the carry block
 75%   --- TOOLS (attached repo) ---          <- ~1,363 tokens of instructions
```

**It is in the context half, not the instruction half** — appended to the tail of `basePrompt`
(`askPipeline.ts:2311`), which is the last thing before the instruction belt begins.

Two properties of that position are worth naming, and neither is claimed as the cause:

- **The block comes AFTER the question.** When the model reads *"of those"*, the antecedent has not
  yet appeared. It arrives one line later. Whether a pronoun resolves backwards over a section
  boundary is not something this run tested.
- **The entire TOOLS section sits between the block and the point of generation.** That is
  ~1,363 tokens on a first-tier ask — and it is the same section the belt condition showed changes
  tool behaviour fifteenfold when removed. The carried list is the second-furthest thing from the
  answer, not the nearest.

**This does not show the placement caused the refutation.** It shows the refutation is a statement
about *this block, in this position, in this prompt* — which is four things, and the cheapest cut is
position, not a different model. Two placements are testable on the same arms for the same 28
minutes of card:

1. **before the question**, so the antecedent precedes the pronoun;
2. **last**, after the instruction belt, immediately before generation.

**Neither is run here and neither is registered yet.** Naming them is not the same as testing them,
and a placement study needs its own registration with its own control — which is the same build with
the block in the current position, not the flag off.

## What this does not claim

- **Not that the referents slot is worthless.** One conversation shape, one model, four arms. It says
  this model, on this question, did not reach for the carried list.
- **Not that a better rendering would fail too.** The block says *"a follow-up saying 'those' or
  'which one' means these"*. Whether a different wording is used is untested, and is the obvious next
  registration.
- **Not a statement about the picture.** That is the belt's second question and still needs a browser.
- **Not powered for a rare effect.** Two runs a side, one shape.

## What it licenses

**`SEQUENCE_ASK_CARRY_REFERENTS` stays off**, and the case for the fourth slot is now weaker than
when it was built: the material arrives and is not used.

**Stage four's question is answered as registered.** The next question is not "how much to carry" —
it is whether anything in the prompt makes a model prefer carried material over the prose it already
has, and that is a wording question, not a plumbing one.
