# Trimming the instruction belt — registered before the build

**Written 2026-09-06, before anything is built. On the ask path, which every tier uses.**

## The quantity this build touches

*Named before any threshold, per the sixth law.*

**The `TOOLS (attached repo)` section of the instruction belt, and nothing else.** It does not touch
the digest, the fixed prose in the base prompt, the `TEACH MODE` contract, the `CHARTS` section, the
`AI CANVAS` section, or the carry.

So every threshold below is on **repeated content, tokens a turn, and provider calls a turn**. Every
other number here is a watch-line.

## Two corrections to the figure that prompted this

**The belt is not one size, and "46%" was a teach turn.** Measured per tier, repo attached:

| | belt | composition |
|---|---|---|
| **first tier — an engineer's ask** | **1,363 tokens** | **`TOOLS` alone, 100%** |
| third tier — a teach turn | 3,087 tokens | `TEACH MODE` 1,841 · `TOOLS` 632 · `CHARTS` 398 · `AI CANVAS` 218 |

On a first-tier ask the belt is **entirely tool instructions** — there is nothing else in it. On a
teach turn tool instructions are 1,248 of 3,087, and the largest single block is the teach contract,
which is third-tier and out of scope by the standing ruling.

**So the piece worth removing is `TOOLS`, and it is largest exactly where the first tier lives.**

## Why only `TOOLS`, and not `CHARTS` with it

`CHARTS` is 398 tokens and the chart rate is 69% of turns. `TOOLS` is 632–1,363 tokens and the tool
rate is **1 turn in 104**. Removing both would confound the one instruction that is plainly working
with the one that plainly is not, and a run that lost charts could not say which section did it.

**`CHARTS` stays. `AI CANVAS` stays.** If `TOOLS` comes out cleanly, they are separate conditions
after it.

## The bands

Two runs a side, `TEACH_EVAL_REPO=sequence`, four turns, on a build carrying the flag. **Control:
`ceiling-1` and `ceiling-2`.**

1. **Repeated content falls.** From 97% to **below 85%** on a teach turn. *Refuted above 90%.* Stated
   modestly on purpose: `TOOLS` is 632 tokens of a 5,521-token teach turn, so the arithmetic ceiling
   is about 86% and a threshold below that would be the sixth law's mistake a fourth time.
2. **Tokens a turn fall by at least 500** on a teach turn, from 5,409–5,521. *Refuted below 300.*
3. **Provider calls a turn do not rise** above 5.4. *Refuted above 6.5.*

## What could go wrong — the belt may be why the model behaves at all

This is the risk, and a rise is as much a failure as a fall.

- **Tool calls must not RISE.** Today: 1 turn in 104. A model that stops being told how tools work
  may call them wrongly, or call ones it should not. **Registered: tool calls stay at or below 2 of
  104. *Refuted above 4*, and a run where the model starts calling tools it should not is a failure
  even if every token figure improves.**
- **Tool calls must not fall to a hard zero across both runs** either. One in 104 is already almost
  nothing, but if the instruction is the only reason a tool is *ever* called, removing it removes a
  capability. **Watch-line, not a kill** — at a base rate of 1%, two runs cannot distinguish zero
  from one honestly, and the sixth law forbids a threshold on a quantity this measurement cannot
  resolve.
- **Fabrication must not rise.** `claims.unsupportedTechnologies` per turn, against the control's
  range. **Kill: refuted if it rises in both runs.**
- **Refusals must not rise.** A model unsure what it may do refuses more. Measured from
  `checkInSkipped`, the stub rate and the subject-less refusal count. **Kill: stub rate stays within
  the control's range on matched turns** — matched, per the fifth law.
- **Charts must not fall.** The `CHARTS` section stays, so this should not move; if it does, the
  sections are coupled and the condition is void rather than refuted. **Registered: chart rate within
  the control's range. A fall here voids the run.**

## What this cannot show

- **Not whether the tool instructions are good.** It measures whether removing them changes
  behaviour. A model that never called tools with them and never calls them without them tells you
  the instructions were inert, not that they were wrong.
- **Not the first tier directly.** The bench runs teach conversations, where `TOOLS` is 632 tokens.
  On a first-tier ask it is 1,363 and the whole belt — so the saving there is **larger** than
  anything these arms can show, and the arms understate the case rather than overstate it. A
  first-tier measurement needs a bench of engineer asks, which does not exist.
- **Not a latency claim.** Wall time is reported but not registered: it moves with the machine and
  with whatever else holds the card.

## Card cost

Two runs a side on the four-turn shape: **80 to 95 minutes**, the same as the ceiling arms. Runs
after the carry's two card-bound numbers, per the standing order.

## Correction to the control, made after the run started and before any result

**This page names `ceiling-1` and `ceiling-2` as the control. Those arms are invalid for it**, by the
law ruled an hour before this run began: an arm's control must differ from the treatment in the
change under test and nothing else.

The ceiling arms ran **14:58–16:24Z**. Since then two product changes shipped — the advance rule
(`96aaeea8`, 17:39Z) and the carry (`876ee1b5`). A belt arm compared against them would differ in
**three** changes, and the result would be unattributable in exactly the way stage one's repeats
number was.

**A valid control already exists.** `carry-1` and `carry-2` ran **19:06–20:08Z** on the build that
carries the belt flag (`0c928ea2`, 19:05Z) with the flag **off**, and no source has moved since. Same
build, same four turns, same form; one difference, which is the flag.

**The registration is not rewritten.** Changing a control after a run has started is the thing
registrations exist to prevent, and swapping it quietly would be worse than the original error. So:

- **the result will be reported against BOTH** — `carry-1/2` as the valid same-build control, and
  `ceiling-1/2` as the control this page registered;
- **the thresholds are read against the valid control**, and the registered-control reading is
  printed beside it and labelled confounded;
- if the two readings disagree, **that disagreement is the finding**, and the belt gets a clean re-run
  rather than a verdict.

The bands themselves — tool calls must not rise, fabrication must not rise, refusals must not rise,
a fall in charts voids the run — are unchanged. Only what they are measured against is corrected,
and the correction is recorded here rather than applied silently.

## Clause 2 is now measurable — and the belt needs a re-run to reach a verdict

The 2026-09-06 run reported clause 2 **UNMEASURABLE**: `claims.unsupportedTechnologies` is produced
by the pipeline and was never recorded by the bench, so fabrication was unmeasured on a run whose
entire registered risk was fabrication rising.

The bench records it now, with two things beside the count:

- **which terms** were unsupported, because a count says fabrication rose and the terms say what was
  invented — the difference between a number to act on and a number to worry about;
- **`checked`**, the claim check's own flags, because the check says in its source that *an empty
  finding list from a check that could not run is not a clean bill of health*. A zero without those
  flags is the vacuity this repository keeps finding, one layer out.

**Until a run carries it, the belt has a partial verdict and not a verdict.** Clause 1 is refuted
decisively and that stands — 30 tool calls of 104 against a ceiling of 2, agreed by both controls.
But *refuted on clause 1 with clause 2 unmeasured* is what the record says, and a re-run is what
turns it into *refuted, and here is what it did to fabrication*.

**The re-run is not queued.** Clause 1 already refutes the condition, so the re-run buys the reason
rather than the verdict, and it costs 90 minutes of card. It goes behind the carry redesign unless
someone rules otherwise.

