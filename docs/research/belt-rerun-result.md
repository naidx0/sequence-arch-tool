# The belt re-run — fabrication measured, no detectable rise

**Four arms, 2026-09-07T20:01:42Z–21:53:15Z, one card hold (6,693 s), `granite42-hermes`,
`TEACH_EVAL_REPO=sequence`, 13 conversations × 4 turns an arm, interleaved control/treatment, tree at
`935b67d9`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The clause that has stood unmeasured since 2026-09-06

> **Clause 2 — fabrication must not rise.** Unsupported technologies per claim-checked turn, with
> `claimsRan` as the denominator. **Refuted if the treatment rate is 3 or more in both treatment
> runs, against a control maximum of 1.**

| arm | flag | conversations | clean turns | claim check RAN on | unsupported technologies | stub |
|---|---|---|---|---|---|---|
| control | off | 13 | 52 | **52** | **0** | 19.2% |
| treatment | **trim** | 13 | 52 | **52** | **0** | 3.8% |
| control | off | 13 | 52 | **52** | **0** | 21.2% |
| treatment | **trim** | 13 | 52 | **52** | **0** | 3.8% |

**Zero unsupported technologies in every arm, on 52 of 52 claim-checked turns each.** The kill does
not fire.

## The reading, fixed before the numbers existed

**"No detectable rise" — not "no rise".** The registration set the smallest difference this design
can honestly call a signal at 3 or more in both treatment runs, derived from a measured base rate of
0–1 per 52 claim-checked turns. At 0 and 0 the test saw nothing, and it could only ever have seen
something large.

**The denominator is what makes the zero mean anything.** 52 of 52 turns were claim-checked in every
arm, so a zero says the check ran on every clean turn and found nothing — not that nobody looked.
That distinction cost three separate instrument fixes to be able to state: recording `claims` at all,
keeping each arm's file, and recording whether the check ran.

**It licenses nothing further**, as registered before it could be seen. This closes the question. The
belt stays **refuted on clause 1** on its own terms; more arms after reading this number would be
optional stopping with extra steps, and power here needs a new registration with a larger design
fixed in advance.

## The belt condition now has a full verdict

| clause | registered | measured | |
|---|---|---|---|
| 1. tool calls must not rise | ≤ 2 of 104 | **30 of 104** | **REFUTED** |
| 2. fabrication must not rise | 3+ in both treatment runs | **0, 0** | no detectable rise |
| 3. refusals must not rise | within the control's range | 3.8%, 3.8% vs 19.2%, 21.2% | passes — they **fell** |
| 4. charts must not fall | a fall voids the run | 71.2% vs the control's range | passes |

**Refuted on clause 1, and the reason is now known: removing the tool instructions made the model
call tools fifteen times more, and nothing measurable was invented as a result.**

## What must not be said, and was nearly the headline

**These are TEACH bench arms.** The derived chart already fires on a teach turn, so the earlier belt
run's twenty extra `propose_chart` calls moved the picture rate only 67/69% → 71/71%. **They cannot
support a claim that removing `TOOLS` gets an engineer a picture** — wrong tier, and a second
mechanism supplying the same outcome. That sentence was proposed, checked and withdrawn before this
run; it is repeated here because it is the tempting one.

**Refusals falling is not banked either.** Stub rate went 19.2%/21.2% → 3.8%/3.8% — a large,
consistent move in a direction nobody registered as a win. Reported, not claimed: the clause was
one-sided (refusals must not *rise*), and reading a fall out of a clause written for a rise is the
shape this house refuses.

## The arm selection, stated because it was nearly wrong

`tools/bench/out` holds **nine** `teach-eval-sequence-*` files. Five predate this run, and **three of
them share the control's configuration exactly** — `nowire-norefs-notrim` — differing only in when
they ran. **A filter on filename pattern would have found five controls and two treatments**, and the
control maximum is the number the kill is stated against.

**The four arms were selected by their recorded run instant** (`when > 2026-09-07T20:00:00Z`), which
lives in the file rather than in the name. The other five are excluded: three belt-era controls from
the early hours, two carry-wiring arms.

## Two instrument notes on myself

- **I read an arm file mid-write and reported 12 conversations where there were 13.** The writer is
  incremental on purpose, so a crashed run keeps its results; the cost is that a file read during a
  run is a partial file. A count taken from an artefact whose run has not ended is not a count.
- **I released the card on a log I had read rather than on a check that the process was gone.** It
  happened to have finished. The check took one command and should have come first.

## What this does not claim

- **Not that trimming `TOOLS` is safe.** Clause 1 refuted the condition; this measures a consequence.
- **Not that fabrication did not rise.** It says a design that could only see a large rise saw none.
- **Not a first-tier result.** On an engineer's ask `TOOLS` is 1,363 tokens and the entire belt; these
  are teach conversations where it is 632.
