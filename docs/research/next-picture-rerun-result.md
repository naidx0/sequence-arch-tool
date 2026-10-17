# The next-picture re-run — the carrier works, the band is killed

**Two runs, 2026-09-06T13:27–14:08Z, `granite42-hermes`, one card hold (2,507 s), against the bands
registered in [`next-picture-rerun-registration.md`](next-picture-rerun-registration.md).**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The kill number

**3 reveals of 11 questions across two runs. Registered kill: at least 5.**

Per the registration, **one to four is a kill, not a pass** — it would let a percentage be computed
off a handful, which is exactly what the refutation clause exists to prevent. **The 30–70% band
stays unread**, and the reason is now a measured one rather than an absence.

| | nextpic-3 | nextpic-4 | control (1 and 2) |
|---|---|---|---|
| questions asked | 5 | 6 | 3, 4 |
| **reveals** | **1** | **2** | **0, 0** |
| asked on a final turn — nowhere to land | 3 | 4 | — |
| questions that *had* a following turn | 2 | 2 | — |

## The repair works. The conversations are too short.

The control produced **0 reveals of 7** because nothing carried the prediction between turns.
`69a3498f` fixed that, and the fix is confirmed: **3 of the 4 questions that had a following turn
were revealed** — 75%, against 0 of 7 before.

**7 of the 11 questions were asked on the FINAL turn of their conversation.** There was no next turn
for the reveal to land in. That is not a carrier fault and no amount of re-running changes it: the
bank's conversations are two and three turns long, and the check-in tends to arrive at the end.

So the registration's own caveat is the finding. It said the question rate is a ceiling the carrier
cannot move, and set the kill at 5 *because* it sits just under it. The ceiling turned out to be
lower still: not "3–4 questions a run" but **2 questions a run that can possibly be answered.**

**What would move it**, and neither is a re-run: conversations long enough that a question is not the
last thing said, or a check-in that arrives a turn earlier. Both are changes to the condition, and
both need registering before they are measured.

## The `atCap` attribution was wrong, and is redone

The earlier reading attributed ten of 28 turns per arm to `atCap` **by elimination** — it was the only
condition left in that branch. The bench records `stopReason` now (repair B), so it can be read
instead of inferred:

| reason | nextpic-3 | nextpic-4 |
|---|---|---|
| **`complete`** | **4** | **5** |
| `no-progress` | 3 | — |
| `ceiling` | — | 2 |

**Nine of the fourteen completed normally.** They were not at cap at all. `atCap` explains five, and
the registration said what to do about that: *"if the recorded reason disagrees, the gate list is
wrong and the analysis is redone rather than patched."*

So the gate list is wrong, and this is what is actually established:

1. **stub, ≤35 words** — 3 and 4 turns.
2. **no chart emitted this turn** — 10 and 9 turns, the largest bucket in both arms.
3. **the model wrote its own check-in** — 2 and 2.
4. **at cap** — 3 (`no-progress`) and 2 (`ceiling`).
5. **completed normally and still carried no derived question** — **4 and 5, and this bucket has no
   explanation yet.** A turn that finished, drew a chart, wrote substantive prose and did not close
   with its own check should have had one derived. It did not.

**Number 5 is the open question**, and it is card-free to chase: the derived next-picture question
needs a NEXT concept (`queue[1]`) to ask about, and a lesson whose queue is down to its last entry
has none — the fallback to the default form then needs the current chart to have a focus with
neighbours. That is a hypothesis with the data on disk to check it, and it is not checked here.

## What this run does not claim

- **Not that the next-picture form is worse or better.** Three answers say nothing about
  comprehension. The band was registered to measure that and it is unread.
- **Not that the carrier is unproven.** It is proven: 3 of 4 landable questions revealed, against 0
  of 7 before it existed.
- **Not that `atCap` is irrelevant.** It explains five turns. It was simply not the explanation for
  the bucket it was assigned to.

## The fifth bucket: the hypothesis is refuted

The open question was why nine turns completed normally, drew a chart, wrote substantive prose,
closed without their own check, and still carried no derived question. The hypothesis on the page
was that the lesson had reached its last queue entry, so there was no NEXT concept to ask about.

**Refuted. All nine had `queueLen: 6`** — a full queue, `queue[1]` present, a next concept available
in every case:

| arm | conversation | turn | queueLen | concept |
|---|---|---|---|---|
| nextpic-3 | `harness-01` | 2 | 6 | harness.ts |
| nextpic-3 | `harness-02` | 0 | 6 | client.ts |
| nextpic-3 | `harness-07` | 0 | 6 | grade.ts |
| nextpic-3 | `mix-06` | 1 | 6 | client.ts |
| nextpic-4 | `harness-02` | 0 | 6 | client.ts |
| nextpic-4 | `harness-04` | 0, 1 | 6 | diff.ts |
| nextpic-4 | `mix-03` | 0 | 6 | diff.ts |
| nextpic-4 | `mix-06` | 0 | 6 | client.ts |

### Two things the data does say

**A chart with three items and two links never produces a question — 0 of 7.** Five items and four
links does, 11 of 30. So chart size is a *necessary* condition and not a sufficient one.

**A chart whose links point in mixed directions never produces one — 0 of 22.** Every question came
from a chart whose links all point the same way: 8 from `4 inbound, 0 outbound`, 3 from
`0 inbound, 4 outbound`. Mixed shapes — (1,1), (1,3), (2,2), (3,1) — produced none at all.

But uniform direction is not sufficient either: `4 inbound, 0 outbound` splits **8 asked against 4
not**. Something still decides between two charts of identical shape and direction, and it is not in
the report.

### So the honest answer is the same shape as the last one

**The bench does not record why a check-in was NOT derived.** `atCap` was invisible until `stopReason`
was recorded, and this is one layer deeper: `deriveNextPictureCheckIn` has five ways to return
nothing — no focus item, no focus, no dependents, a distractor pool under two, fewer than two
distinct distractors — and a turn that hits any of them looks exactly like a turn that hit none.

**The next thing to build is a `checkInSkipped` reason on the turn**, exactly as `stopReason` was
added, and it costs no card. Until then the fifth bucket stays open, and I would rather leave it
open than name whichever of the five ways sounds most plausible.

## The bucket, closed — and BOTH earlier readings were wrong

`checkInSkipped` is built, and the nine turns re-read through the derivation itself, each with the
next concept its own lesson would have had:

**All nine WOULD have produced a question.** The derivation never refused — `harness-01` would have
asked about `harness.mjs`, `harness-02` and `mix-06` about `executor.ts`, `harness-04` about
`proseDiff.ts`, `mix-03` about `score.ts`, `harness-07` about `scan.ts`.

So the gate that closed is **upstream of the derivation**, and only one candidate survives:
`lastChartThisTurn === undefined`. **The bench's `charts` array is not that quantity.** It is what
the turn ended up with on the canvas; `lastChartThisTurn` is what the pipeline itself derived during
the turn. From the report the two look interchangeable, and that is why this bucket survived two
wrong explanations. The pipeline now records `no-chart-derived-this-turn` for exactly this case.

**And the mixed-direction reading above is withdrawn as an explanation.** It was measured on the
chart the TURN drew; `deriveNextPictureCheckIn` builds its own chart for the NEXT concept and never
looks at that one. The correlation is real and reported honestly — 0 of 22 mixed-direction turns
asked — but it is a correlation between two charts of the same graph region, not the mechanism. A
number that correlates is not a cause, and I published it one step short of checking which chart the
code reads.

## Was the chart the model's own? No — for eight of the nine

The next candidate was that the canvas chart came from the model's own tool call, so the pipeline's
`chartsThisTurn === 0 && !canvasWriteSucceededThisTurn` guard skipped the derivation and with it the
check-in. The guard is real — read from source, `askPipeline.ts` derives a chart **only when the turn
has not already produced one** — so the mechanism is available. It is not what happened.

| | chartCalls | proposals | chartOutcomes |
|---|---|---|---|
| the nine (no question) | 0 in 8 of 9; 2 in `harness-07` | 1 in all nine | 0 in 8 of 9; 2 in `harness-07` |
| the eleven that asked | **0 in all eleven** | **1 in all eleven** | **0 in all eleven** |

**Eight of the nine are indistinguishable from the eleven on every chart field the report carries.**
One — `harness-07` turn 0 — fits the hypothesis exactly, with two tool calls and two outcomes, and it
is the only one that does.

**So the design question does not go on Max's page.** It was to be raised *if* a model-drawn chart
never earns a derived check-in; that is true of one turn in nine and cannot carry a product decision.
Raising it now would be asking the owner to rule on a mechanism that explains 11% of the case.

### The fourth reading, and why this is where guessing stops

That is four explanations tried against this bucket — the queue's end, the chart's link directions,
the model's own chart — and three refuted, one withdrawn. Every one was a plausible reading of data
that could not settle it, because **the report has never carried the quantity the code branches on.**

It does now. `checkInSkipped` records `no-chart-derived-this-turn` for exactly this case, and the next
pair of arms will say it outright rather than being inferred from four fields that happen to
correlate. **The remaining question is answered by the next run, not by more reading of this one** —
and it costs no extra card, because the field rides along with whatever runs next.
