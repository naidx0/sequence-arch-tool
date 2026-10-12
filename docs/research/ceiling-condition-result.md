# The ceiling condition — the ceiling moved, and two clauses refuted

**Condition A, two runs, 2026-09-06T14:58–16:24Z, `granite42-hermes`, one card hold (5,160 s),
against the bands registered in [`ceiling-condition-registration.md`](ceiling-condition-registration.md)
before any run.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The four registered claims

| | registered | measured | |
|---|---|---|---|
| 1. landable questions | ≥ 8 across two runs (control 4) | **19** | **cleared** |
| 2. reveal rate on landable | ≥ 60%, refuted below 50% | **47%** (9 of 19) | **REFUTED** |
| 3. the inherited kill number | ≥ 5 reveals | **9** | cleared |
| 4. the teach contract holds | rates within the control's range | check-in **4–6%** vs 11–14% | **REFUTED as written** |

**LANDABLE 19 of 23 questions asked. REVEALS 9 of 19.** The control was 4 landable of 11 asked, and 3
reveals.

## The ceiling moved, and it moved a long way

Four turns instead of two or three took landable questions from **4 to 19**, and reveals from 3 to 9.
Only 4 of the 23 questions were still asked on a final turn, against 7 of 11 before. The mechanism
the registration named is real and the lever works: a question asked before the end of a lesson has
somewhere to land.

## Clause 2 is refuted, and the comparison is worth looking at twice

47% is below the 50% floor I registered, so **the clause fails as written**. But the control's 75%
was **3 of 4** — a rate measured on four questions. This is 9 of 19. A well-measured 47% against a
poorly-measured 75% is not evidence that the reveal became less reliable; it is the first honest
estimate of a rate the earlier run could not measure at all.

**The refutation stands** — I registered the floor and it was missed — but the reading that "a longer
conversation degrades the reveal" is not supported by these numbers, and I am not making it.

## Clause 4 was badly registered, and here is the evidence

The clause compared per-turn rates across arms. **The condition changes the number of turns**, so it
changes what a per-turn rate is an average over — and the clause was measured on a denominator the
condition itself altered.

| | stub | chart | check-in |
|---|---|---|---|
| control, all turns | 11–14% | 64–68% | **11–14%** |
| ceiling, all turns | 6–17% | 69% | **4–6%** |
| ceiling, **first two turns only** | 0–8% | 69% | **8–12%** |
| ceiling, **the padded turns alone** | 12–27% | 69% | **0%** |

On the turns the control actually has, the contract holds: chart 69% against 65–69%, check-in 8–12%
against 12–15%, stub lower in both arms. **The all-turn fall is entirely the padded turns, which
carry a check-in 0% of the time in both runs while still drawing a chart 69% of the time.**

So the honest verdict is: **the teach contract did not degrade, and my clause could not have told the
difference.** A clause that compares rates across arms of different lengths is measuring composition,
not quality. The right form — and this is a correction to the registration, not to the run — is
either absolute counts on matched turns, or rates computed on the first N turns of every arm.

## The finding nobody registered: the third and fourth turns draw but never ask

**Not one padded turn ended with a check-in, in either run — 0 of 52.** They drew charts at the same
69% as every other turn. So a lesson extended past its scripted replies keeps producing pictures and
stops asking anything.

That is the most interesting thing in the run and it was not one of the four claims. It is not
reported as a finding about teaching — nothing here measures whether those turns help — but it is the
question the next registration should be built around, and it is card-free to investigate from the
`checkInSkipped` reasons these arms recorded.

## The recorded reason, at last doing its job

`checkInSkipped: no-chart-derived-this-turn` appears on **5 and 6 turns** — the first time this
bucket has been read rather than inferred. It does not cover everything: 11 and 9 turns still carry
no recorded reason despite drawing a chart and finishing normally, so **the branch I added covers
part of the gate and not all of it.** That residue is smaller and better-defined than the nine it
replaced, and it is the next card-free thread.

## What this run does not claim

- **Not that the band is readable.** Nine reveals clears the kill number, but clause 2 is refuted, so
  by the registration's own terms the 30–70% comprehension band is **still not scored here**.
- **Not that four turns is better teaching.** It produces more landable questions. Whether a
  four-turn lesson helps a learner is a seat question and nobody has asked it.
- **Not anything about condition B.** A cleared the kill number, so by the registration B remains a
  change nobody needs to make yet.

## Cost

**5,160 s of card, one hold, taken and released through the wrapper** — against the 56–70 minutes the
registration estimated. Four turns cost more than the estimate assumed: 86 minutes, not 70.
