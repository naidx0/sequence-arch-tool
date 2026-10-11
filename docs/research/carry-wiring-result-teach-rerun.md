# Mechanism A, re-run — all four clauses measured, none refuted, and the chart rise did not replicate

**Four arms, 2026-09-07T04:31:30Z–06:58:28Z, two card holds (8,243 s + 576 s = 8,819 s),
`granite42-hermes`, `TEACH_EVAL_REPO=sequence`, 13 conversations × 4 turns an arm, interleaved
control/treatment/control/treatment.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered clauses — all four, at last

| clause | registered | measured | |
|---|---|---|---|
| **1. charts must not fall** | below the control's range in both runs = kill | control **65.4, 69.2** → treat **69.2, 69.2** | **passes** |
| **2. distinct concepts must not fall** | below the control's range in both runs | control **25, 26** → treat **26, 26** | **passes** |
| **3. refusals must not rise** | stub rate within the control's range | control **13.5%, 21.2%** → treat **1.9%, 17.3%** | **passes** (falls, not rises) |
| **4. fabrication must not rise** | rises in **both** runs = kill | control **0, 0** → treat **0, 1** | **passes** — one run, not both |

**Nothing is refuted, and nothing is claimed as a win.** The registration said the case for the teach
half is that discarding a computed value was never intended, and registered four regressions and no
success condition. Four regressions were looked for and none occurred.

## The finding that matters most: the chart rise did not replicate

The first run reported control 67.3, 65.4 against treatment 69.2, 69.2 — both treatment runs above the
control's range, both control runs below the treatment's, a difference with direction agreement by the
replication rule.

**This run's control produced 65.4 and 69.2.** The control's own spread now covers the treatment
entirely, and the same +3 points is no longer a difference at all.

**So the earlier signal was control variance, not an effect.** Two runs a side was not enough to see
that on one pass; it took a second pass whose control happened to land higher. The replication rule
worked exactly as intended — it did not stop the first reading from *looking* like a difference, it
stopped that reading from being the last word.

**This is why the first run's rise was not banked.** The registration had declined in advance to count
a chart improvement as success, and the honest statement then was "the registered regression did not
occur". Had it been written up as "the carry improves the chart rate", this run would now be a
retraction instead of a replication.

## Fabrication, measured for the first time after failing three ways

| arm | claim check RAN on | unsupported technologies |
|---|---|---|
| control-1 | 52 of 52 turns | 0 |
| control-2 | 52 of 52 turns | 0 |
| treat-1 | 52 of 52 turns | 0 |
| treat-2 | 52 of 52 turns | **1** |

**The denominator is the point.** A zero here means the check ran on every clean turn and found
nothing — not that nobody looked. Getting to that took three separate instrument fixes: recording
`claims` at all, keeping each arm's file, and recording `ran` so a clean answer is distinguishable
from an unrun check.

**The one finding, in full**, because a count says fabrication rose and the term says what was
invented:

> conversation `link-04`, turn 3 — term **`redis`**, with `checked: { datastores: true, files: true }`

A model naming Redis in a repository that has none, on a turn where the datastore and file checks both
ran. **One turn in 208.** The kill required a rise in both runs and only one run has it, so the clause
passes — but the honest reading is that a single instance in 104 treatment turns cannot distinguish a
real effect from noise, and this measurement is not powered to.

## Refusals fell, and that is not banked either

Stub rate: control 13.5% and 21.2%, treatment 1.9% and 17.3%. The clause was one-sided — refusals must
not **rise** — and they did not.

The 1.9% arm is tempting and is left alone. The treatment's own spread is 1.9 to 17.3, wider than the
gap anyone would want to claim, and by the replication rule a difference needs both runs outside the
other side's range with direction agreement. One is. **That is the same shape as the chart rise, one
run earlier in its life**, and this page is not going to make that mistake twice on the same day.

## What changed in how this was run

- **Interleaved control, treatment, control, treatment.** The first run put both controls first, which
  is why its timeout drop was unattributable — drift over two and a half hours and a real effect look
  identical when the arms are ordered.
- **Every arm keeps its own file**, named from repo, flags and run instant. The first run lost three
  arms to a single output path.
- **The claim check's denominator is recorded**, so a fabrication zero has something to be zero of.

## What this does not claim

- **Not that the teach half benefits.** Nothing measured moved. That is the expected result for a
  plumbing fix and it is what the registration predicted.
- **Not a measurement of the plumbing.** The bench calls `runAskPipeline` directly and never touches
  `carryStore`; `SEQUENCE_ASK_CARRY_WIRE` gates the bench's own threading here. These arms measure the
  mechanism — does a carry block in the prompt change a teach turn — and not the wiring.
- **Not enough power for a rare event.** One fabrication in 104 treatment turns against zero in 104
  control turns is a difference this design cannot resolve. If fabrication is the thing to protect, it
  needs a bench sized for a rate that low, and that bench does not exist.

## What it does license

**Mechanism A has no registered objection left.** Four clauses, four measurements, none refuted, on an
instrument that now refuses rather than printing a scoreboard over missing data.

**It does not license shipping the flag on.** Nothing measured improved, so the case is still only
that a computed value was being discarded, and the decision belongs to whoever weighs that against a
change to every teach turn in the product. **Default off stands.**
