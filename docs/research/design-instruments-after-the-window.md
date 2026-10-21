# Three instrument repairs the window's two reports point at

**Written 2026-09-06 after the card window, before anything is built. Nothing here is implemented.**

Both reports from the window end in the same place: a question could not be answered because the
instrument could not carry or record what the code decides on. Neither report ends in a product fix,
and that is the finding — the product was measured by three tools that each lost something on the
way.

## What each report asks for

| from | the gap | what it cost |
|---|---|---|
| next-picture | `teach-eval.mjs` never carries `openPrediction` between turns | **7 questions, 0 reveals** — the band has no denominator at all |
| next-picture | the report records no `atCap` | the largest gate bucket (10 of 28 turns) cannot be confirmed |
| seat | `chat.json` is hashed as **bytes** | a void raised on a re-serialisation where zero fields changed |
| seat | the seat asserts a chart, never a lesson | three DIFFs reported where there was one absence |

## A. The bench must carry the prediction between turns

**Build this second, after the reproduction below.** It is the only one that turns an unmeasurable band into a measurable one, and
the band is already registered and already paid for in card time.

In the product the prediction round-trips:

```
askPipeline sets openPrediction
  → teachTurn.finish() writes lesson.open = {…, askedAt}
    → the next turn reads input.teachContext?.open
      → the reveal line is appended
```

The bench calls the pipeline directly, so `finish()` never runs and nothing carries `open`. The
repair is to do in the bench what `teachTurn` does in the product: keep the returned
`openPrediction` on the conversation's lesson state and pass it back in `teachContext` on the next
turn.

**It must reuse the product's own carrier, not re-implement it.** A bench that decides separately
what "carrying a prediction" means is one rule in two places, and this repository has been bitten by
that shape three times — the two ask handlers, the checkpoint migration on one route, and the
staleness check the preflight nearly duplicated. `teachTurn.finish()` and `readLesson` already do
it; the bench should call them.

### Planted cases

1. **A question asked on turn N produces a reveal on turn N+1.** Two scripted turns with a stubbed
   provider, no model: turn 1 returns prose plus a next-picture question, turn 2 must contain
   `Last turn you were asked`. **This fails today** — that is the point.
2. **The reveal names the arrow the question was built from**, not a re-derived one. Re-deriving
   next turn would answer about whatever concept is current, which may not be the one asked about —
   a true sentence in the wrong place, and the reason the product carries it rather than recomputing
   it.
3. **A conversation with one turn produces no reveal and no error.** The last turn's question simply
   has nowhere to land.
4. **A prediction is cleared when the turn asked nothing**, so a stale reveal cannot survive a turn
   that asked no question.
5. **The carrier is the product's.** A source-level case: `teach-eval.mjs` must reach the reveal
   through `teachTurn`/`lesson.open` and must not contain its own `openPrediction` bookkeeping.

### The kill number

**Two runs after this lands must produce at least 5 reveals between them, from the 7-question rate
already measured.** Fewer than 5 means the carrier is not the only thing missing and the band stays
unread rather than being scored on a handful. More than 0 but fewer than 5 is the dangerous middle:
it would let a percentage be computed off three answers, which is exactly what the registration's
own refutation clause was written to prevent.

## B. The bench report must record `atCap`

Three fields — `atCeiling`, `spentOnNothing`, `outOfTime` — per turn, plus rounds used. Ten of 28
turns in run 1 had a chart, substantive prose, no model check-in and no derived one, and `atCap` is
the only condition left in that branch; it cannot be confirmed because nothing writes it down.

**Cases:** a turn that hits the round ceiling records `atCeiling`; a turn that hits the deadline
records `outOfTime`; a turn that completes normally records neither. **Kill number:** if, after this
lands, the "unexplained" bucket is still non-empty on a re-read of the same arms, the gate list in
the report is wrong and the analysis above must be redone rather than patched.

## C. The seat must hash content and assert the lesson

Two small changes, one page:

- **Hash the parsed document, not the bytes.** `chat.json` came back byte-different and
  field-identical across a reload — 1,177 differing bytes, 0 differing fields, a `work` step
  re-serialised with its keys reordered. The void was right about the file and wrong about the
  conversation. Hashing `JSON.stringify(parsed, sortedKeys)` still catches a real change and stops
  calling a re-serialisation a changed conversation.
- **Assert `lesson.json` exists on a teach turn.** The seat asserted a chart and got three DIFFs
  from one absence. A beat that reads "the turn was taught as a lesson and a lesson was written"
  separates "no lesson" from "a lesson with no chart", which are different defects with different
  owners.

**Kill number:** if hashing the parsed document makes the reload void unraisable in a case where the
conversation genuinely changed, the change is wrong — so it ships with a case that mutates one field
and requires the void to fire.

## What is NOT here, and why

**The product defect the seat found is not in this page.** The leading hypothesis — web2 sends no
`threadId`, the server falls back to `index.activeId`, and a mismatch leaves the turn with no lesson
— is a hypothesis, and confirming it needs a request against a running app, which is a provider call.

But a **card-free** confirmation exists: a unit case over `beginTeachTurn` with
`threadIdFromRequest: undefined` and an `index.activeId` naming a different session, asserting
whether a lesson is written. If that reproduces, the defect is established without a model and the
fix can be designed on its own page.

**It is built FIRST, before A, B or C** — and this contradicts the order I first wrote here. The
reason is the sentence I had already written to justify it: a product defect confirmed card-free is
worth more than three instrument repairs, and an ordering that puts the repairs first disagrees with
its own argument. A is next, because it is the one that turns an unmeasurable band into a measurable
one.

## What this page does not claim

- **Not that the instruments were useless.** Each of the three found the thing it was built to find:
  the seat caught a stale process and a real absence, the bench measured the walk condition cleanly,
  and the preflight caught its own gap. The repairs are about what they *could not say*, not about
  what they said wrongly.
- **Not that the next-picture band will read after A.** A carries the reveal; whether 3–4 questions a
  run is enough to score a percentage is a separate question the kill number is meant to force.
- **Not a product claim of any kind.** Every item here changes a measuring tool. The one product
  defect in sight is deliberately left out until it is reproduced.
