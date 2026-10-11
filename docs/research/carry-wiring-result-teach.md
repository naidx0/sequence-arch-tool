# Mechanism A, the teach half — charts did not fall, and three clauses were destroyed by the instrument

**Four arms, 2026-09-07T01:23:26Z–03:50:02Z, one card hold (8,797 s), `granite42-hermes`,
`TEACH_EVAL_REPO=sequence`, 13 conversations × 4 turns an arm, tree at `e6f09cfa`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered clauses

| clause | registered | measured | |
|---|---|---|---|
| **1. charts must not fall** | below the control's range in both runs = kill | **65.4–67.3% → 69.2%, 69.2%** | **passes** |
| **2. distinct concepts must not fall** | below the control's range in both runs | **no control data** | **UNMEASURED** |
| **3. refusals must not rise** | stub rate within the control's range | **no control data** | **UNMEASURED** |
| **4. fabrication must not rise** | rises in both runs = kill | **no control data** | **UNMEASURED** |

**One clause of four was answerable.** The other three had their data recorded per turn and then
deleted before it could be read — see *What the instrument destroyed*, below, which is the more
useful half of this page.

## Clause 1, which is the one that mattered

| arm | flag | visual present | paced | ends with check-in | 90 s timeouts |
|---|---|---|---|---|---|
| control-1 | off | **67.3%** | 88.5% | 46.2% | 6 |
| control-2 | off | **65.4%** | 94.2% | 23.1% | 6 |
| treat-1 | **on** | **69.2%** | 92.3% | 42.3% | **2** |
| treat-2 | **on** | **69.2%** | 90.4% | 50.0% | **1** |

**Charts did not fall.** The registered regression was the likeliest and the costliest, and it did not
happen: both treatment runs sit above the control's range (65.4–67.3), and both control runs sit
below the treatment's (69.2–69.2), so by the replication rule this is a difference with direction
agreement — **upward, by about 3 points.**

**It is not reported as a win.** The registration says the case for the teach half is that discarding
a computed value was never intended, and that no benefit had been measured. A 3-point rise on 13
conversations an arm is a difference this design can see, not an effect anyone should build on, and
the registration deliberately declined to register a chart *improvement* as a success condition.
**The honest statement is that the registered regression did not occur.**

Nothing else registered moved. Paced (88.5–94.2 control) and check-in (23.1–46.2 control) both have
control ranges wider than any treatment value, so neither can show anything here — the check-in
range in particular is 23 points wide across two runs of the same configuration, which is worth
remembering before anyone reads a check-in number from this bench again.

## The unregistered observation, and why it is not banked

**Timeouts fell from 6, 6 to 2, 1.** Four to five fewer 90-second stalls per arm, on turns of ~39–41k
characters. That is a large relative move and it is exactly what a carry might cause — a turn that
does not re-derive what it already has finishes sooner.

**It is a watch-line, not a result.** The registration says wall time is not registered because it
moves with the machine and with whatever else holds the card, and these four arms ran back to back on
one hold with nothing else running, so the ordering (control, control, treatment, treatment)
confounds it with anything that drifted over two and a half hours. A thermal effect and a real effect
look identical here. **If it matters, it needs arms run in the opposite order.**

## What the instrument destroyed, which is the finding worth keeping

`teach-eval.mjs` wrote every run to one path — `tools/bench/out/teach-eval-report.json`. Four arms ran;
**each overwrote the last**, and only the final arm's detail survived.

The printed scoreboard goes to the log, so all four arms kept their chart, paced and check-in rates,
and clause 1 was answerable. **Clauses 2, 3 and 4 read fields that live only in the JSON** —
`conceptGiven`, `stub`, `claims.unsupportedTechnologies` — and those were recorded, per turn, on every
arm, and then deleted.

From the one surviving arm (treat-2), so the shape of what was lost is visible:

| | treat-2 |
|---|---|
| turns | 52 |
| stub | 8 (15.4%) |
| turns with claims recorded | 13 |
| **unsupported technologies** | **0** |
| distinct concepts | 26 |

**Zero fabrications in the treatment arm** is the number clause 4 wanted, and with no control range it
says nothing: the second law is explicit that absence of a signal is not evidence of absence, and a
zero with nothing to compare it against is exactly that.

### The shape of the failure

**The run looked complete.** Four arms, four exit codes of zero, four scoreboards, one clause
answered. Nothing errored, nothing warned, and three quarters of the registered measurement was gone
before anyone looked. **An instrument that is accurate about what it did and silent about what it was
asked to do** — the same family as the mutation harness that could not tell me it had failed to
restore, and as `success: false` never appearing in a log that only records successes.

**Fixed in the same commit as this page.** `TEACH_EVAL_OUT=<name>` names a run's report, and when it
is unset a timestamped copy is written anyway, so an unnamed multi-arm run cannot silently destroy
its own evidence. The fixed path is still written for whatever reads it by name.

## Two smaller instrument defects, recorded not fixed

- **The progress line prints `[9/74]` when the run is 13 conversations.** 74 is the bank size; the
  denominator shown is not the denominator of the run. In a repository whose third law is that
  denominators travel with their number, that is worth a line of code.
- **`born=unknown` on the lock.** The lock tool could not resolve the holding shell's start time, so
  the reaper could not have distinguished this hold from a recycled pid. The card was released
  explicitly rather than left to it.

## What this does not claim

- **Not that the teach half is safe to ship on.** One of four clauses passed; three are unmeasured,
  including fabrication, which is the one with a real downside. **Default off stands.**
- **Not that the carry helps teach.** Charts rose 3 points and the registration declined in advance to
  treat that as a win. Nothing here measures whether a lesson got better.
- **Not a measurement of the plumbing.** The bench calls `runAskPipeline` directly and never touches
  `carryStore`; `SEQUENCE_ASK_CARRY_WIRE` gates the bench's own threading here. **These arms measure
  the mechanism — does a carry block in the prompt change a teach turn — and not the wiring.** The
  registration named this before the run; it is repeated because a result page gets quoted without
  its registration.

## What happens next

**The three unmeasured clauses need one more pair**, now that runs keep their files: two arms, ~50
minutes of card, reading concepts, stub and fabrication against a control. Until then mechanism A has
**one clause of four**, and that is what the record says.
