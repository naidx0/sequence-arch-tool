# The carry's two card-bound numbers — one unmoved, one confounded

**Stage one of three, 2026-09-06T19:06:53–20:08:34Z, one card hold (3,702 s), `granite42-hermes`,
four turns, next-picture form. Control: `ceiling-1` and `ceiling-2`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


| arm | turns | provider calls | calls/turn | repeated concepts | |
|---|---|---|---|---|---|
| `ceiling-1` | 52 | 270 | **5.2** | **25** | control |
| `ceiling-2` | 52 | 291 | **5.6** | **25** | control |
| `carry-1` | 52 | 255 | **4.9** | **1** | carry |
| `carry-2` | 52 | 272 | **5.2** | **0** | carry |

## 1. Provider calls a turn: no change

Control [5.2, 5.6], carry [4.9, 5.2]. **The ranges touch at 5.2**, so by the replication rule — a
difference counts only when both runs fall outside the other side's range — this is **not a
difference**. `carry-2` sits inside the control's range.

The carry did not reduce the loop. That is the honest reading of a fall of about a third of a call
per turn on two runs a side.

## 2. Repeated concepts: 25, 25 → 1, 0 — and it is not the carry's result

**This is confounded, and the confound is mine.**

`96aaeea8` — *a turn that taught advances the queue, whether or not it asked* — was committed at
**17:39Z**. The control arms ran **14:58–16:24Z**, before it. The carry arms ran **19:06–20:08Z**,
after it. So the treatment arms carry **two changes** and the control carries neither.

The advance rule was registered with this exact kill number: *fewer than 3 repeated concepts per arm,
against 18 and 17*. It measured **1 and 0**. Distinct concepts across a run went **11 → 35**.

**So the advance rule's registration is answered and its kill number is cleared** — and the carry's
contribution to that collapse is **unmeasured**, because a change that was registered to produce
exactly this outcome shipped between the control and the treatment.

## The methodological failure, named

**An arm's control must differ from the treatment in the change under test and nothing else.** I ran
the carry against a control that predates a different product change, and the result is a number I
cannot attribute. The advance rule got its answer by accident; the carry did not get one at all.

It is the same family as the fifth and sixth laws — a comparison that cannot support the claim laid
on it — and it is worth stating separately because it is not about the *clause*, it is about the
*control*: **a control taken before an unrelated change is not a control.**

What it costs: to measure the carry alone, both sides must be re-run on one build with the carry as
the only difference. That is two more arms, about 90 minutes of card, and it is not queued — the
belt condition and the seat read come first, and the carry redesign (stage four) may change what is
worth measuring anyway.

## What this does not claim

- **Not that the carry does nothing.** It was not measured. Its own recording is meanwhile known to
  be defective in two ways (a failed read leaves no trace; one of three read paths is recorded) and
  its excerpt cap discards ~92% of what a turn read, so a re-run before the redesign would measure a
  thing that is about to change.
- **Not that the advance rule caused the whole collapse either.** It is the overwhelmingly likely
  cause — it was registered to produce it and the size matches — but these arms cannot separate the
  two changes, and saying "the advance rule did it" with the same confidence as "the carry did not"
  would be reading the confound in the direction that flatters the registration.
