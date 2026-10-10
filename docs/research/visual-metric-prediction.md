# PREDICTION, registered before the run lands — which class dominates the zero-visual turns

> **⚠ EVERY CHECK-IN FIGURE BELOW IS THE OLD METRIC.** `endsWithQuestion` is a trailing question
> mark, and 15 of the 31 questions measured were CLARIFYING offers the contract bans outright.
> Re-graded on "ends with a comprehension question or a prediction", where a transcript exists:
>
> | run | reported | **honest** |
> |---|---|---|
> | baseline (no lesson state) | 22/47 | *not re-gradable — no transcript stored* |
> | belt TURN SHAPE header | 14/47 | *not re-gradable — no transcript stored* |
> | lesson state | 20/47 | **3/47** |
> | three sources, LONG A | 12/47 | **2/47** |
> | three sources, LONG B | 18/47 | **6/47** |
> | short belt, run 1 | 19/47 | **1/47** |
> | short belt, run 2 | 19/47 | **1/47** |
>
> The two earliest runs predate the bench recording turn text (`7ad5ee90`), so their honest number
> cannot be recovered and is not guessed at. Do not quote a figure from this file without the
> right-hand column. See `tools/bench/README.md`.


**Written 2026-09-05, before the 20-conversation instrumented run under `0003b3ca` completed.**
A diagnosis fitted after the fact is worth much less than one that could have been wrong, so this
records the call, the reasoning, and what would refute it — while the answer is still unknown.

## The three classes the run will split on

`chartCalls` counts `tool:start` named `propose_chart`; `chartProposals` counts `chart:proposal`,
which fires only after `validateChart` accepts. Every turn with `visual === false` falls in exactly
one class:

| observation | culprit |
|---|---|
| `chartCalls === 0` | never asked → **the prompt contract** |
| `chartCalls > 0`, `chartProposals === 0` | asked, refused → **the tool surface** |
| `chartProposals > 0` | drew, uncounted → **the grader** |

## The static evidence

**The contract asks for it, twice, and unambiguously.** `askPipeline.ts:1012` — *"EVERY concept
ships ONE visual, drawn with propose_chart: you choose the chart KIND … and supply the items/links;
Sequence renders it."* And `:1008` forecloses the obvious substitute: *"The visual is propose_chart.
It is NOT canvas.write_markdown."*

**The tool is on the belt for a teach turn.** `propose_chart` is in `ASK_TOOL_ALLOWLIST` and is
**not** in `ASK_MUTATING_TOOLS` (`propose_files`, `edit_file`, `propose_topology`, `run_command`),
so the teach narrowing at `askTools.ts:221` — which strips only mutating tools — leaves it available.
The model is not being denied the tool.

**A refusal requires bad arguments, not bad luck.** `validateChart` rejects an unknown `kind`, a
missing `title`, an empty or 40+ `items` list, and node ids absent from the scanned graph. Each is
something the model has to get wrong itself.

**A canvas write also counts as a visual.** The grader's flag is `chartsThisTurn > 0 ||
canvasWriteSucceededThisTurn`, so a turn that drew on the canvas instead of proposing a chart still
scores. **A zero-visual turn therefore means the model produced neither** — not that it chose the
wrong one of the two.

## The prediction

**`chartCalls === 0` will dominate — the prompt contract, not the tool surface.** I expect it to be
the majority of zero-visual turns and would be surprised below 70%.

The reasoning, stated so it can be wrong:

1. The tool is available and unrefused, so "asked and refused" needs the model to invent a chart
   kind or a node id. That happens, but it needs the model to have *tried* — and a model that tries
   usually gets `kind` right, because the schema publishes the enum.
2. The instruction is one bullet in a belt of roughly fifteen, and instruction-following on a small
   local model degrades with belt length. The failure mode of a 4B-class model under a long contract
   is fluent prose with no tool call, not a malformed one.
3. `canvas.write_markdown` counting as a visual removes the most likely near-miss. If the model were
   reaching for the wrong visual verb, those turns would score and never appear in this split.

**Secondary:** refusals will be non-zero but small, and concentrated where the contract's own warning
bites — *"Give items a nodeId when they stand for a real part of the repository — invented structure
is refused"*.

**`chartProposals > 0` with `visual === false` will be zero or near it.** The wiring is direct: the
event fires from the same `result.chart` that increments `chartsThisTurn`, which is the grader's
flag. A non-zero count here would mean those two disagree, which is a real bug and would be the most
valuable outcome of the run.

## What refutes it

- **Refusals dominate** → the tool surface is the culprit, the contract is landing, and the fix is in
  `validateChart`'s strictness or the schema's discoverability. My reasoning about small-model
  failure modes would be wrong.
- **Proposed-but-uncounted is non-zero** → the grader and the event disagree, and the visual metric
  has been measuring the wrong thing a second time. That would be the third instrument defect in this
  bench and the most important finding available.
- **Never-asked is under 70% but still the largest** → directionally right, confidently wrong; the
  contract is a contributor rather than the cause, and the fix is not a prompt edit alone.

## What it would mean if confirmed

The visual instruction is present, correct, and ignored. That points at the belt's *shape* rather
than its wording — an instruction competing with fourteen others — and the cheapest test would be
whether the rendered teach belt places it where a model still attends, not whether it says the right
words. It would also mean the metric is honest: a real product defect, measurable, and not a model
limitation, since a text-only model can call the tool.

---

# THE RESULT — confirmed, in both configurations

**Read 2026-09-05, after the 20-conversation run completed (20 clean, 0 errored, 47 turns, 13.6
minutes).** The prediction above was registered before any of it.

## The three metrics, turn-level, with denominators

| metric | |
|---|---|
| paced (<=250 words) | **46/47 (97.9%)** |
| ends with a check-in | **22/47 (46.8%)** |
| visual present | **0/47 (0.0%)** |

## The split, and the same split under the shipped configuration

The run that answers the question had `reasoningEffort: 'none'`, which is NOT the product default —
and the paired comparison in `thinking-on-vs-off.md` shows that turning hidden reasoning off takes
the visual rate from 2/14 to 0/14. A split computed only there would be a split over a configuration
in which the metric under investigation had been zeroed.

So both are reported. **They agree.**

| class | thinking ON (shipped, 7 convs) | thinking OFF (20 convs) | example |
|---|---|---|---|
| never asked — `chartCalls === 0` | **11/12 (91.7%)** | **45/47 (95.7%)** | `ml-01 t1` |
| asked, refused — calls>0, proposals=0 | 1/12 (8.3%) | 2/47 (4.3%) | `ml-04 t0` / `ml-01 t0` |
| drew, uncounted — proposals>0 | **0/12 (0%)** | **0/47 (0%)** | (none) |

## Against the prediction

- **"`chartCalls === 0` will dominate … I would be surprised below 70%."** — 91.7% and 95.7%.
  **Confirmed**, and by a wide margin in both configurations.
- **"Refusals will be non-zero but small."** — 1 and 2. **Confirmed.**
- **"Proposed-but-uncounted will be zero or near it."** — 0 and 0. **Confirmed.** The grader and the
  event do not disagree; the visual metric is not defective a second time.

The reasoning offered for the call also survives: the tool is on the belt, unrefused, and a model
that tries mostly gets `kind` right — so the failure is not the tool surface. Across 47 turns the
model made **4** `propose_chart` calls; across the 14 thinking-on turns it made **9**.

## What it means, stated as narrowly as the evidence allows

The visual instruction is present, correct, and ignored. That points at the belt's SHAPE rather than
its wording — an instruction competing with roughly fifteen others — and the cheapest next test is
whether the rendered teach belt puts it where a small model still attends, not whether it says the
right words.

**It is a product defect, not a model limitation.** `propose_chart` is a tool call; a text-only model
with no projector can score 100% on this metric. Nothing here excuses the 0%.

**One thing this does NOT establish.** Hidden reasoning more than doubled the call rate per turn
(9 calls in 14 turns against 4 in 47). Whether the belt's shape or the model's reasoning budget
matters more is a separate question, and this run cannot separate them.
