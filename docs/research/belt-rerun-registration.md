# The belt re-run — fabrication, registered before the arms

**Written 2026-09-07, before any card. Completes a verdict that has stood partial since 2026-09-06.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## What is unfinished

The belt condition (`SEQUENCE_ASK_TRIM_TOOLS=1`, removing the `TOOLS` section) was **refuted on
clause 1**: tool calls rose from 1 in 104 turns to 30. That stands and is not re-opened.

**Clause 2 — fabrication must not rise — could not be evaluated at all.** The bench never recorded
`claims.unsupportedTechnologies`, which the pipeline already returned. Fixed at `9a599904`; the
re-run has not happened. So the belt carries *"refuted on clause 1, clause 2 unmeasured"*, and a full
verdict is now possible.

**The re-run buys the reason, not the verdict.** Clause 1 already refuted the condition. What is
missing is whether the extra tool use came with more invention — and publishing *"removing
instructions made the model use its tools"* without that is the trade this house refuses.

## The arms

Bench, `TEACH_EVAL_REPO=sequence`, four turns, `granite42-hermes`. **Two runs a side, interleaved
control/treatment/control/treatment.** Control is the same build with the flag **off**.

## THE FABRICATION THRESHOLD, written before the numbers exist

The measure is **unsupported technologies per claim-checked turn** — `claimsRan` is the denominator
and it is reported beside every count, because a zero without it says only that nobody looked.

**Registered kill: refuted if the treatment rate is 3 OR MORE in both treatment runs, against a
control maximum of 1.**

### And the power limit, registered rather than discovered

The comparable rate measured on this model is **0 to 1 unsupported technologies per 52 claim-checked
turns**. At that base rate, two runs a side can only see a large rise. So, stated in advance:

- **a rise to 3 or more in both treatment runs, against a control maximum of 1**, is the smallest
  difference this design can honestly call a signal;
- **anything smaller is reported as "no detectable rise", never as "no rise".** The second law: with
  events this rare, absence of a signal is not evidence of absence, and the design is the reason;
- **2 in both runs is explicitly NOT a refutation.** It is *no detectable rise*, reported
  inconclusive.

**This is a weak test and saying so now costs nothing.** Discovering it after a null would be
motivated reasoning.

### AMENDED before any arm was read — the kill and the power limit contradicted each other at 2

The first version of this page carried a generic kill — *"exceeds the control's maximum in both
runs"* — written before the power analysis three paragraphs below it. Control maximum is 1, so **2
fired the kill while the power limit forbade calling 2 a signal.** On a base rate of 0-to-1 per 52
claim-checked turns, 2 is exactly where a reader lands.

**The power limit wins and the kill was rewritten to match it**, because the power limit is derived
from the measured base rate and the kill line was a formula that predates it.

**Amended with four arms already running and NOTHING read from them** — the log held one line, no
scoreboard, no claims figure, no arm file from this run. A contradiction resolved before any data
exists is a registration being repaired; the same edit after a number would be the thing
registrations exist to prevent, and the distinction is the whole reason this paragraph gives its
evidence.

### WHAT INCONCLUSIVE LICENSES, decided before it can be seen

**Nothing further.** An inconclusive fabrication result — anything below 3 in both treatment runs —
**closes this question**. The belt stays refuted on clause 1 on its own terms, and the record reads
*"fabrication showed no detectable rise, at a design that could only have seen a large one."*

**It does not license more arms.** Adding arms after reading a 2 is optional stopping with extra
steps, and that is the one door a pre-registration exists to shut. If anyone wants power here, that
is a **new registration with a larger design fixed in advance** — not an extension of this one, and
not a decision taken while looking at a number.

## The void precondition, decided by the runner

An arm is **void** when the artefact gate fires — `claims`, `stub` or `conceptGiven` missing on any
clean turn (exit 5) — or when `claimsRan` is 0, because a fabrication rate with no claim-checked
turns is a rate with no denominator.

**The runner decides this, not a reader.** The carry line lost three arms to a precondition nobody
checked until after publishing, and **six of twenty-one** arms there were void — the figure this page
first gave as *five of twenty-one*, which was never true at any reading: five was the numerator from
the earlier count of seventeen. **A hybrid is worse than a stale number**, because a stale one can be
traced to the reading that produced it and a hybrid cannot — and it had no business sitting in the
clause arguing that voids must be counted by construction. A void arm is replaced,
not averaged in.

## The correction that must survive into the result

**The earlier belt arms ran on the TEACH bench, where the derived chart already fires.** Twenty extra
`propose_chart` calls moved the picture rate only 67/69% → 71/71%. **Those arms cannot support a
claim about an engineer getting a picture** — wrong tier, and a second mechanism supplying the same
outcome. Any result page from this re-run repeats that, because the tempting sentence is the one it
forbids.

## What this cannot show

- **Not whether `TOOLS` should be removed.** Clause 1 refuted the condition; this measures a
  consequence, not a decision.
- **Not the mechanism.** Removing 2,456 tokens of tool instruction raised tool calls fifteenfold and
  nothing explains why. This does not attempt it.
- **Not a first-tier result.** Teach bench, teach conversations. On an engineer's ask `TOOLS` is
  1,363 tokens and the entire belt.

## Cost

**Four bench arms, ~2.3 hours of card.** Nothing else on the card while they run, including
diagnostics from this lane.
