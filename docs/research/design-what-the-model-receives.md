# What the model actually receives on a teach turn

**Measured 2026-09-06 from the code and the captured arms. Nothing on the card. Nothing built.**

Max sat in Teach mode and reported three things: the model has no real context of the workspace;
every turn reads like a fresh start with nothing cached or re-read; and the lesson circles, producing
text rather than landing a point. This is the count behind that, so the next decision rests on
numbers instead of impressions.

## The prompt, in order and in tokens

Turn one of `harness-01` against this repository, built from the real pipeline (1,078 nodes, 2,884
edges):

| # | section | chars | ~tokens | share |
|---|---|---|---|---|
| 1 | base prompt — the architecture digest and the question | 11,494 | **2,874** | 53% |
| 2 | instruction belt — tool and plan rules | 9,821 | **2,456** | 46% |
| 3 | teach context — the lesson | 172 | **43** | **0.8%** |
| | **total, before any tool result or history** | | **~5,373** | |

**Forty-six per cent of the prompt is instructions about tools the model then does not call.**
Measured over 104 turns in the two ceiling arms: **tool calls were zero on 103 of them.**

## What of the workspace is included, summarised, and absent

The digest is what stands in for the repository:

| | in the digest | in the graph |
|---|---|---|
| services | **10** | — |
| datastores | 1 | — |
| service-level edges | **300** | — |
| folders | **0** | — |
| topics | **0** | — |
| **file-level edges** | **0** | **2,884** |
| **packages named** | **0** | **10** |

**The model is given a service-level sketch and none of the file graph.** Coverage on the built
prompt reports `edgesSeen 0 of 2,884` and `packagesSeen 0 of 10` — not a chip undercounting, the
prompt genuinely contains none of them.

This is the sharp end of it: **the charts are derived from the file graph, and the model has never
seen the file graph.** It writes prose about a repository it knows as ten service names while the
product draws a picture from 2,884 edges beside it. Those two are not describing the same thing, and
nothing in the turn reconciles them.

## What is re-read every turn that could have been carried

**All of it.** The digest and the instruction belt — 5,330 of the 5,373 tokens — are rebuilt and
re-sent on every turn of every conversation. Neither changes between turns of the same lesson: the
repository is not being rescanned and the rules are constant.

Across a four-turn lesson that is **four full copies** of the same ~5,300 tokens. Across the 104
turns measured, roughly **554,000 tokens of identical prompt**, re-sent.

## What the turn keeps from the previous turn

**Corrected 2026-09-06, after this page was first written and before anything was built on it.**
The first version said file reads were not carried at all. That is true of the BENCH and not of the
product, and the difference matters enough to state plainly.

**The product carries**, per assistant turn, through `renderAskHistorySection`:

| | cap |
|---|---|
| prose | truncated to 1,200 chars |
| work verbs | 12 |
| **file NAMES read** | 20 |
| tool names | 12 |
| proposal titles | 8 |

**The bench carries prose only** — `history.push({ role, text: text.slice(0, 2000) })` — so every
number measured on the arms understates what a person in the app receives. The arms are still the
right measure of the digest and the belt, which do not come from the client, and they are the wrong
measure of history.

**What neither carries** is the thing the complaint is about: **file CONTENT**, the chart's
STRUCTURE (a proposal title is not its focus and neighbours), and what was actually taught about a
concept. A turn that read `brief.ts` hands the next turn the *name* `brief.ts`, a paragraph of its
own prose about it, and none of `brief.ts`.

Beside that, the turn keeps the concept queue and the open next-picture prediction.

## The cost per turn

| | measured over 104 turns |
|---|---|
| provider calls per turn | **5.4** (561 total; modal value 6) |
| tool calls per turn | **0 on 103 of 104** |
| wall clock | ~50 s a turn; 86 minutes for two 52-turn arms |

**Five to six model calls per turn, each carrying the same ~5,300-token prompt, producing no tool
call.** The loop is not gathering anything; it is re-asking.

## What a person in that chat needs, against what the model gets

| what the person needs | what the model gets |
|---|---|
| the file they are looking at | ten service names |
| what depends on it | 300 service-level edges; none of the 2,884 file edges |
| the picture on screen explained | no knowledge that a picture exists — the chart is derived beside it |
| continuity: "as I said last turn" | ≤ 8 truncated paragraphs of its own prose |
| what it already read | the file's NAME; never its content |
| an answer that lands | 5.4 rounds of the same prompt, then whatever it has |

## The first thing to build

**Carry what the turn already found, and stop re-sending what has not changed.**

A per-lesson context that persists across turns of one conversation, holding: the files read and
their content ranges, the chart last drawn with its focus and neighbours, and the concepts already
taught with what was said about each. Sent as a compact block in place of the eight truncated
paragraphs.

**Why this first, ahead of enlarging the digest:** it is the only one of the three complaints that
fixes the other two. A turn that knows what the last one read stops re-reading (the cost), and a turn
that knows what was already explained stops circling (the repetition). Enlarging the digest addresses
neither and makes the per-turn cost worse.

### Planted cases

Card-free; the context assembly is a pure function of a lesson and its turns.

1. **A file read on turn 1 is present on turn 2 without being re-read** — the case Max's report is
   about.
2. **The chart drawn on turn 1 is named on turn 2**, so a learner can ask "why that arrow" and be
   answered rather than redrawn at.
3. **A concept already taught is marked as taught**, with what was said, so turn 3 can say "as we
   saw" instead of repeating it.
4. **The carried block is bounded** — a lesson of twenty turns must not grow the prompt without
   limit; oldest detail degrades to a title before it is dropped, and dropping is reported.
5. **Nothing carried is invented.** Every carried item traces to a real event in a real turn: a
   file that was read, a chart that was emitted. The first law applies to the context as much as to
   the answer.
6. **A fresh conversation carries nothing** — no bleed between lessons.

### The kill number

**Repeated prompt content must fall below 40% of the per-turn total, from today's 99%** (5,330 of
5,373 tokens identical between turns of one lesson). Above 40% the carry is a veneer on the same
re-send and the cost complaint is unanswered.

**And a second, on the symptom:** distinct concepts named across a four-turn lesson must rise, on the
arms already registered for the advance rule. If the lesson still circles with a carried context, the
cause was never the context.

## What this does not claim

- **Not that the digest is the wrong shape.** A service-level summary may be right for a design
  question and wrong for a lesson about one file. This counts what is there; it does not rule on it.
- **Not that Teach mode should be improved.** Per the ruling of 2026-09-06 it is the third tier and
  nothing further is built there without a word. **This measurement is about the ask path, which
  every tier uses** — the digest, the belt, the re-send and the discarded reads are not teach-mode
  code, and the same 5.4 calls and 99% repeat apply to a design question from an engineer at the
  board.
- **Not a claim about quality.** Nothing here says the answers are wrong. It says what the model was
  given when it wrote them.
- **Not measured on the seat.** Max's three complaints are a person's report; these are the numbers
  under them. Whether carrying context makes the chat feel different is a seat read nobody has done.

## The carry, wired — and it fails the kill number I set

Measured dry, no card, building the real prompt turn by turn for `harness-01`:

| turn | base | belt | carry | total | **repeated** |
|---|---|---|---|---|---|
| 1 | 2,874 | 2,456 | 0 | 5,330 | **100%** |
| 2 | 2,874 | 2,456 | 79 | 5,409 | **99%** |
| 3 | 2,874 | 2,456 | 135 | 5,465 | **98%** |
| 4 | 2,874 | 2,456 | 191 | 5,521 | **97%** |

**Repeated content goes 100% → 97%. The kill number was 40%. The carry fails it, and it was always
going to.**

The repeated content *is* the digest and the belt — 5,330 tokens rebuilt unchanged every turn. The
carry does not touch either. It **adds** 79 to 191 tokens; tokens a turn go **up**, not down.

**The kill number was aimed at the wrong build, and that is my error.** I wrote it on this page
against "the first thing to build", and the first thing to build addresses continuity, not the
re-send. A carry cannot lower a ratio whose numerator it does not touch. This is the second clause
I have registered against a quantity the change could not move — the first was the ceiling
condition's clause 4 — and both failed the same way: **a number chosen for the finding rather than
for the build.**

### What the carry's kill number should have been

Two, neither of which is measurable without a card window:

- **provider calls a turn**, against today's 5.4 — the loop re-asks because it lacks what it found;
- **repeated CONCEPTS across a lesson**, against 17 and 18 in the ceiling arms — the circling.

Both need two arms. The token numbers above are complete and card-free; the wall-clock and call-count
halves are not, and no dry provider can supply them, because both depend on what a real model does
with the prompt rather than on what the prompt contains.

### And the 40% belongs to a different change

Sending the digest and the belt once per conversation instead of once per turn is what moves 97% to
anywhere near 40%. **That is not built and not decided** — it is a change to the ask path for every
tier, and it needs a ruling before a line of it exists.

## The carry's recording has the Codex shape, and I built it today

The research lane measured OpenAI Codex CLI's trace: 507 patch-apply records, `success: true` on all
of them, `success: false` zero times, and **no failure or rejection event type in the schema at all**
— in a harness that records non-zero exit codes faithfully everywhere else. A gate that cannot fail.

Asked whether the carry has the same shape. **It does, in two ways, and neither would have shown up
by reading my own intentions.**

**1. A failed read leaves no trace.** The seeding loop is

```
  try { body = …read the file… } catch { continue; }
  evidenceLedger.push({ round: 0, body });
  carriedReads.push({ path: rel, excerpt: body });
```

The `catch` skips to the next file *before* the push. So a file the turn tried to read and could
not is absent from the carry entirely — there is no representation of a failed read in the type, any
more than Codex has one for a rejected patch. **`CarriedFile` has `path`, `excerpt` and `turn`, and
no way to say "tried and could not".**

The consequence is precisely the loop the carry exists to stop: a file that cannot be read is
retried by every subsequent turn, forever, because nothing records that it was already attempted.

**2. It records one of three read paths.** `carriedReads.push` appears at exactly one site — the
harness pre-read. The two tool-driven `file:read` sites never reach it. Tool calls are 1 turn in 104
today, so the gap is currently almost invisible; **"currently almost invisible" is how the Codex
schema looked too**, and the belt condition may raise the tool rate, at which point the carry would
silently stop recording most of what it exists to record.

### Not fixed now, deliberately

Stage one of the card window is running on this build. Changing the source and rebuilding mid-window
would put the two arms of one condition on two builds — the exact defect that made the first
checkpoint prediction unmeasurable. **The fix waits for the window to finish**, and is:

- `CarriedFile` gains a failed state, so "tried and could not" is carried and not retried;
- `carriedReads` is populated from the file-read events rather than from one call site, so every
  path records;
- a planted case per path, and one asserting a failed read is carried as failed — the case that
  cannot pass if the type has no way to express failure.

**The general rule this is the second instance of:** a record that can only be written on success is
not a record, it is a receipt. The counting gate learned it (a gate that cannot fail is not a gate);
the carry needed teaching separately, which is what makes it a law rather than an anecdote.

## And it is sized for the learner at the engineer's expense

Max has stated the identity: an engineer with a hard system in front of them is first, ordinary
builders second, learners third. Asked whether anything in the carry is optimised for the third at
the first's expense. **Yes, and it is worse than a sizing choice.**

| | |
|---|---|
| what the turn actually reads | **200 lines** a file, up to 3 files (the harness pre-read) |
| what the carry keeps | **600 characters** a file — a header line plus roughly ten lines of code — for the newest **3** files only |

The carry discards about **92% of what the turn read**, and then tells the next turn:

> `Read packages/analyzer/src/server/scan.ts (turn 1): …ten lines…`

For a learner shown one small concept a turn, ten lines may genuinely be the concept. **For an
engineer tracing a dependency through 200-line files it is a fragment presented as the file** — and
the degraded form is worse still, because it says *"do not re-read to confirm it exists"* about a
file whose content the next turn largely does not have.

**That line was written for the learner's shape and is wrong for the engineer's.** A turn that has
ten lines of a two-hundred-line file and has been told not to re-read it will answer from the
fragment. Not carrying the file at all would be better than carrying a tenth of it under a label
that says it is carried.

**Named, not balanced**, per the ruling. The fix belongs with the recording fix after the window:
the excerpt cap should be a function of what the reader is for — an engineer's turn wants the file,
a learner's turn wants the idea — and *"do not re-read"* must only be said about material that is
actually carried in full.

**One thing it does NOT do**, checked rather than assumed: the concept slot is teach-only
(`teachContext.concept`), and it is simply absent on an engineer's turn. It costs the first tier
nothing. The defect is the caps and the instruction, not the shape of the record.
