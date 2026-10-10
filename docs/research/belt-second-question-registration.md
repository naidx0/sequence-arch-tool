# The belt's second question — does the product draw for an engineer?

**Registered 2026-09-06, before any arm runs. A NEW question with its own clauses and its own
control. It does not reopen `belt-condition-registration.md`.**

## Why this is a new page and not an amendment

The belt condition registered *tool calls must not rise; refuted above 4*. The run returned 30, and
**the condition is refuted on its own terms.** That record does not move.

The proposal that arrived afterwards was to read that same clause as *"the interesting number rather
than the disqualifying one"*, because tool calls rising is what you want if the tool is the one that
draws. The reasoning is good and the conclusion may well be right. **Re-reading a registered clause in
light of its result is exactly what registrations exist to prevent**, and doing it here would cost
more than the run is worth: every future clause becomes negotiable once one has been renegotiated
after the fact.

So the old page keeps its verdict, and the new question gets a new page, new clauses, a new control,
and an instrument chosen for the question rather than inherited from the last one.

## The mechanism the proposal named is NOT supported, and the correction matters

The proposal was: *the section that documents `propose_chart` is the thing suppressing
`propose_chart`.* Checked against the section's own text, three things are wrong with it.

**1. `TOOLS` does not document `propose_chart`.** The tool's example and the instruction to call it
live in the **teach contract** (`askTools.ts:3711`), which `SEQUENCE_ASK_TRIM_TOOLS=1` does not
remove. The trimmed section describes `read_file`, `search_files`, `read_topology`, `who_calls`,
`edit_file` and `propose_files`.

**2. `TOOLS` instructs the model to call tools.** Its opening line is *"Retrieve before you answer:
emit one or more fenced blocks, then stop."* A section cannot be described as suppressing tool use
when its first sentence orders it.

**3. Not one retrieval call happened in either arm.** Every belt tool call was a chart or a plan —
11+5 = 16 and 9+5 = 14, exactly the totals — and the controls were 1+0 and 1+0. **Removing the
section that says "retrieve before you answer" produced zero retrievals**, the same as leaving it in.

So the effect is real and reproduced across two runs, and **the mechanism is unknown.** What is
established is narrower and stranger than the proposal: *the presence of the `TOOLS` section changes
tool-calling behaviour for tools it does not describe, in the direction opposite to its own
instruction.* Candidate explanations — token position, the syntax warning, the sheer length of a
contract for tools the turn does not need — are untested, and this registration does not pick one.

## The finding that most affects the plan: those 20 chart calls bought almost no pictures

| | chart calls | chart rate |
|---|---|---|
| control | 1, 1 | 67%, 69% |
| belt | **11, 9** | **71%, 71%** |

On a **teach** turn the derived chart already fires, so the model calling `propose_chart` eleven times
moved the chart rate by two to four points. **The belt arms therefore cannot support "removing
`TOOLS` makes an engineer get a picture."** They are the wrong tier, and on that tier the picture was
already arriving by a path the engineer does not have.

That is the fifth law's neighbourhood: a rate measured where a second mechanism supplies the same
outcome is not a measurement of the mechanism under test.

## The question, and the only instrument that can answer it

> **On a first-tier ask — an engineer, no teach mode — does a picture appear?**

The bench cannot answer it: the bench runs teach conversations, and the derived chart confounds the
outcome. **The seat read is the instrument**, three turns of a dependency question, which is the form
that already produced a usable failure once.

## The instrument does NOT need fixing first — checked, and the blind spot is elsewhere

This section first said no arm could run until a tool-drawn chart was counted as a chart. **That was
wrong, and it was wrong in the expensive direction: it blocked a cheap arm on a fix nothing needed.**
Checked before building it:

- **`chartsThisTurn` already counts tool draws.** The tool path increments it and pushes
  `chart:proposal` (`askPipeline.ts:830-831`).
- **The bench counts the event**, not the variable — `e.type === 'chart:proposal' || e.type ===
  'canvas:block'`. A tool-drawn chart counts.
- **The seat counts the rendered page** — `[data-testid="ai-canvas-chart"]`. That is ground truth: a
  picture a person can see.

**The blind spot is the carry, and only the carry.** `lastChartThisTurn` is set once, inside the teach
gate, and the carry's chart slot reads it — so a tool-drawn picture is recorded nowhere for the next
turn. That is a product gap already registered as finding 2 of the carry redesign. **It does not
block these arms**, because neither of these instruments reads that variable.

**So the arms can run as they are.** Recorded this way rather than quietly deleted, because a
registration that blocks on a fix nobody needs wastes exactly what registering things is supposed to
save.

## AMENDED before any arm ran — the witness, and a third outcome the clause could not express

**Two corrections, both landing before a single arm completed. One arm reached turn 1 and was
stopped; no arm file exists, and nothing is being re-read to fit this.**

### 1. The selector is nested

`[data-testid="ai-canvas-chart"]` **alone scores a chart REFUSAL as a picture.** Verified in the
source rather than reasoned about: `SeqChartView.tsx` renders `<ChartRefusal>` at lines 94, 103 and
182 — spec did not validate, kind maps to no drawn family, renderer threw — and `ChartRefusal` emits
`seqchart-fail`, **never a `ChartFrame`**, so no `seqchart` marker. The outer article wraps it
regardless.

**The first path is the product's own fabrication guard.** An item naming a node absent from the
scanned graph refuses by design, because a picture that fabricates is believed faster than prose that
fabricates. So the exact case the contract exists to catch would have scored as *a picture drawn*
against a kill of *no picture in three turns*.

**The witness is now `[data-testid="ai-canvas-chart"] [data-testid="seqchart"]`.** Unforgeable — the
outer marker is gated on structured chart data and a raw SVG cannot reach it, which
`AiCanvas.test.tsx` asserts rather than assumes. Evidence of rendering — the inner one exists only
when a `ChartFrame` drew. No exclusion clause needed, because the outer gate already excludes the
injected path.

**`role="img"` is not a fallback and never was.** Three components carry it, two are not charts, and
model SVG can put it in the DOM.

### 2. The clause stays BINARY — a third verdict was proposed and withdrawn

A three-valued clause was drafted here — `PICTURE` / `PROPOSED AND REFUSED` / `NO PICTURE` — and it
is withdrawn, because **this registration had already decided the question and decided it better.**

Clause 1 says *"at least one of the three turns **renders a chart**"* and, in the same breath,
**"This is the whole question and it is binary on purpose."** A refusal is not a chart rendered, so
under the clause as written a refusal **already counts as no picture** — correctly, and by its
author's explicit choice. Adding a third verdict would have widened a clause somebody had
deliberately narrowed.

**Clause 2 settles it independently.** It notes that `propose_chart` refuses ungrounded nodeIds and
treats a fabrication rise as evidence the model found a way around that — so **the refusal path was
already load-bearing in this registration**, which means a refusal was never meant to satisfy clause
1.

**So the nesting is not an amendment at all.** `ai-canvas-chart` means *the product decided to draw*;
*renders* means *a frame drew*. **The registered clause always demanded the second and the instrument
was measuring the first.** One selector in the arm, and nothing else changes.

**`PROPOSED AND REFUSED` is still RECORDED**, per turn, as an observation — proposed count, drawn
count, refusal count. It is not a verdict and does not enter the kill. *The product proposed a chart
and then declined to draw it* is worth knowing if it happens; it is not a third answer to a binary
question.

## The clauses

Two arms, same build, `SEQUENCE_ASK_TRIM_TOOLS` the only difference, **seat instrument, ask intent,
teach off**, two runs a side.

1. **A picture appears in three turns.** Today: zero, in the one read taken. **Registered: with the
   flag on, at least one of the three turns renders a chart, in both runs. Refuted if both runs give
   three turns and no picture.** This is the whole question and it is binary on purpose.
2. **Fabrication must not rise.** `claims.unsupportedTechnologies` per turn, recorded since
   `9a599904`, against the control's range. **Kill: refuted if it rises in both runs.** A model drawing
   a repository it has not read is the failure mode that matters most here — a chart is a claim about
   nodes, and `propose_chart` refuses ungrounded nodeIds, so a rise would mean it is finding a way
   around that.
3. **Retrieval must not fall.** The section removed is the one that documents `read_file`,
   `search_files` and `who_calls`. Both arms measured zero retrievals on the bench, so on the seat
   this is registered from the seat's own control, whatever it turns out to be. **Watch-line, not a
   kill** — the sixth law forbids a threshold before the control has produced the quantity.
4. **The answer must still be right.** A picture in front of a wrong answer is worse than prose in
   front of a right one. Judged by reading the three turns against the repository, written down with
   quotes. **Kill: an arm that draws and gets the dependency wrong is a failure, not a pass.**

## What could go wrong, and how this would detect it

- **A picture appears and it is generic.** Clause 4, read as an engineer. A chart of the three
  services when the question was about one file is a pass on clause 1 and a failure on clause 4, and
  the page must report it as such rather than banking clause 1.
- **The seat is one conversation.** Two runs a side is thin for a binary outcome, and this page says
  so rather than pretending otherwise: **a 2-of-2 result is a signal, not a rate.** If both arms agree
  the finding is directional and the next step is a bench built from engineer asks, which does not
  exist.
- **The trim breaks something the seat does not exercise.** Editing turns lose `edit_file`'s contract
  entirely. **Out of scope here and stated as a known cost**: nothing in this registration licenses
  shipping the trim, only measuring it.
- **Nothing is built before the arms run.** No instrument fix, no product change — both arms sit on
  the build that already carries the flag, so the control is valid under the control law without any
  further work.

## What this cannot show

- **Not whether `TOOLS` should be removed.** Clause 1 asks whether the product draws for an engineer
  when it is gone. Shipping the removal is a separate decision that has to weigh editing turns, and
  this measures none of them.
- **Not the mechanism.** Established above as unknown. A result here says whether the outcome changes,
  not why, and the page must not be cited as though it explained the belt.
- **Not that a picture is what the engineer wanted.** The seat read said an engineer asking a
  dependency question got prose. Whether a chart is the right answer to *"which one would I have to
  change first"* is a judgement clause 4 makes explicitly, and it can come out against the picture.

## Order and cost

**Nothing to build first.** The control, then the treatment: four seat reads of three turns, roughly
25–30 minutes of card.

This sits **behind** the carry redesign's own arms only if they are ready first; both are cheap, both
use the seat, and either order is defensible. What is not defensible is running either one on the
teach bench and calling it a first-tier result.
