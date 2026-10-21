# Which models fit the card, and why that does NOT excuse the visual metric

**Reported by the research lane** (vault, named rather than linked), measured uncontended
2026-09-04 20:26–20:29. Recorded here because this is where the teach bench lives, and because two
things about it need correcting before anyone acts on it.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The finding

Every installed model runs 100% on the GPU at 4k, 8k and 16k context **except `deepseek-teach`** —
9.2B Qwen 3.5 with a CLIP projector, 7.6 GB on disk — which spills **24–28% to the CPU at every
context** and generates at **21–26 tokens/second**, against 60 for `ornith:9b` and 116 for the
granites.

That is a real constraint and it explains a slow historical run: the 54-conversation report at
`aeb1fdc6` was produced under `deepseek-teach`, on the one model that does not fit.

## CORRECTION 1 — the run holding the lock tonight is not on that model

It is on **`granite42-hermes`**, passed explicitly as `SEQUENCE_AI_MODEL`, and the bench prints it:
`teach-eval: 20 of 54 conversations, model granite42-hermes`. A granite fits the card at 116 t/s.

So the fit finding sizes the *historical* report, not the current run. The 16-minute stall earlier
was contention — another session had `ornith:9b` resident — not spill.

## CORRECTION 2 — the visual metric does not depend on the projector, and this is the one that matters

The suggestion was to say whether 33%/0% is "even reachable by a model that cannot see the diagram
it is asked to reference". **The visual metric never asks a model to see anything.** It grades
OUTPUT. From `gradeTeachTurn`:

- `visualThisTurn` — did the turn make a `propose_chart` call, or a successful canvas write;
- or, in prose, a ```` ```seqd ```` fence, or a box-drawing glyph (`│─└├┌┐┘►▶↓`).

Every one of those is something the model **writes**. A text-only model with no projector at all can
score 100% on this metric by calling `propose_chart`, which is a tool call in the same belt as every
other tool it uses.

**So a low visual rate is a product defect, not a model limitation**, and it must not be excused as
one. The candidates are the prompt contract (the instruction is not strong enough, or arrives after
the model has committed to prose) and the tool surface (the chart tool is not offered, or its schema
is refused) — and those are distinguishable from the run's own data, by looking at whether refused
`chart:proposal` calls appear in the turns that scored zero.

A vision projector would matter for a *different* metric — one asking the model to read a diagram it
was given. Teach mode has no such metric today.

## What to do with the fit table

**Do not swap the product's model on it.** That is a product decision, and the projector may be
carrying something the bench does not measure. The fit table sizes runs; it does not choose models.

The actionable part is narrower: **a bench run under `deepseek-teach` should expect roughly 4–5×
the wall-clock of one under a granite**, and any timing comparison between the two is measuring the
card, not the contract.
