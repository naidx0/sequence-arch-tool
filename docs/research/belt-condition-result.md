# The belt condition — refuted, because tool calls rose fifteenfold

**Stage two of three, 2026-09-06T20:11–21:07:16Z, one card hold (3,288 s), `granite42-hermes`, four
turns, next-picture form, `SEQUENCE_ASK_TRIM_TOOLS=1`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The four clauses

| clause | registered | measured | |
|---|---|---|---|
| **1. tool calls must not RISE** | ≤ 2 of 104; refuted above 4 | **30 of 104** (16 and 14) | **REFUTED** |
| **2. fabrication must not rise** | `claims` per turn within the control's range | **not recorded by the bench** | **UNMEASURABLE** |
| **3. refusals must not rise** | stub rate within the control's range, matched turns | 27%, 12% → **8%, 4%** | passes |
| **4. charts must not fall** | a fall **voids** the run | 67%, 69% → **71%, 71%** | passes, no void |

**The condition is refuted on clause 1**, and the registration said in advance what that means: *a run
where the model starts calling tools it should not is a failure even if every token figure improves.*
Every token figure did improve.

## The control is the same-build one

Per the correction recorded before any result: **`carry-1` and `carry-2`** ran on the build carrying
the flag, with the flag off, and no source moved between them and the belt arms. The registered
control (`ceiling-1/2`) predates two product changes and is printed below only as the confounded
reading it is.

| arm | tool calls | calls/turn | chart % | stub % (all) | stub % (turns 1–2) | |
|---|---|---|---|---|---|---|
| `ceiling-1` | 0 | 5.2 | 69% | 6% | 0% | registered control, **confounded** |
| `ceiling-2` | 1 | 5.6 | 69% | 17% | 8% | registered control, **confounded** |
| `carry-1` | **1** | 4.9 | 67% | 29% | 27% | **valid control** |
| `carry-2` | **1** | 5.2 | 69% | 21% | 12% | **valid control** |
| `belt-1` | **16** | 4.8 | 71% | 8% | 8% | belt |
| `belt-2` | **14** | 4.7 | 71% | 10% | 4% | belt |

**Both readings agree on clause 1** — 0 and 1 against 16 and 14 — so the disagreement clause does not
fire and the belt does not get a re-run on those grounds.

## The finding: the TOOLS section suppresses tool calls

| | `chartCalls` | `planCalls` | turns with any tool call |
|---|---|---|---|
| control | 1, 1 | 0, 0 | 1, 1 of 52 |
| belt | **11, 9** | **5, 5** | **9, 8 of 52** |

`planAccepted` was 5 and 5, so the plan calls were not malformed — the model proposed plans and they
were taken.

**Removing the instructions that describe the tools made the model use them fifteen times more.** The
expectation behind the whole condition was that 2,456 tokens instructing tools called once in 104
turns were inert. They were not inert: **they were holding the model back.** The section does not
teach the tools, it constrains them, and the constraint is most of what it does.

That is the risk named before the run, arriving in the opposite direction to the one anyone expected.
It is also the strongest argument yet that the belt is load-bearing, and it was found by trimming it.

## Bands

| band | registered | measured | |
|---|---|---|---|
| repeated content | from 97% to **below 85%**; refuted above 90% | **96.9% → 96.5%** | **REFUTED** |
| tokens a turn fall | at least 500; refuted below 300 | **631** | passes |
| provider calls a turn | not above 5.4 | 4.8, 4.7 | passes |

### The repeated-content band was ill-formed, and this is the sixth law a fourth time

The trim removes 631 tokens **from the repeated block itself**, so it lowers the numerator and the
denominator together and the *share* barely moves: 5,943/6,134 → 5,312/5,503.

I did do the arithmetic when registering it — the page says "the arithmetic ceiling is about 86%" —
and the arithmetic was wrong, because I subtracted the saving from the turn total but not from the
repeated total. **A ratio whose numerator is a subset of its denominator cannot be moved by removing
material from both.** The absolute number (631 tokens, and 1,363 on a first-tier ask) is the honest
quantity, and it is the one band 2 measures.

## What is not known

**Clause 2 could not be evaluated at all.** `claims.unsupportedTechnologies` is produced by the
pipeline and **not recorded by the bench**, so the fabrication kill — the one that mattered most —
has no measurement. That is a threshold registered against a quantity the *instrument* cannot
produce, which is a new variety of the same mistake: the sixth law is about what the change can move,
and this is about what the bench can see.

**It should be recorded before any belt work resumes**, and it is cheap: the pipeline already returns
it beside `stopReason` and `checkInSkipped`, both of which the bench now records.

## What this does not claim

- **Not that the belt should stay as it is.** It says removing `TOOLS` wholesale changes behaviour in
  a way the registration called a failure. A smaller trim, or moving the constraints out of the
  section into the tool definitions, is untested and plausible.
- **Not that the extra tool calls were bad answers.** Nothing here grades them. `planAccepted` says
  they were well-formed; whether the turns were better is a seat question, and the stub rate falling
  from 27% to 8% on matched turns is a hint in the other direction that this run cannot settle.
- **Not a first-tier reading.** These are teach conversations, where `TOOLS` is 632 tokens. On an
  engineer's ask it is 1,363 and the entire belt, so both the saving and the risk are larger there
  than anything measured here.
