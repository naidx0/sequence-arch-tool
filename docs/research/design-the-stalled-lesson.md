# A lesson that keeps drawing and stops asking

**Written 2026-09-06 from the ceiling arms, before anything is built. Nothing here is implemented.**

## The finding

**Not one turn past the scripted replies ended with a check-in — 0 of 52 across both runs — while
charts kept coming at 69%.** It was not one of the four registered claims and it is the most
interesting thing in the run.

## What a padded turn has that the first turns do not

From the lesson data in `ceiling-1` and `ceiling-2`, 26 turns a slice:

| | turns 0–1 | turns 2–3 (padded) |
|---|---|---|
| concepts given | 18 | **18** — identical |
| charts drawn | 18 | **18** — identical |
| **concept repeats the previous turn's** | 7, 8 | **18, 17** |
| queue length | mostly 6 | **mostly 6** |
| `stopReason: no-progress` | 4, 6 | **7, 12** |
| stubs | 0, 2 | 3, 7 |
| **ends with a check-in** | 2, 3 | **0, 0** |
| median words | 165, 149 | 177, 119 |

**The queue is not exhausted.** It sits at 6 in both slices — the three candidate causes named when
this was handed to me were the queue running out, the concept repeating, and the check-in's own gate
closing, and the first is refuted outright.

**The concept repeats, and that is a consequence rather than a cause.** `advanceLesson` consumes a
concept only on a turn that *passed* — a visual **and** an accepted check-in. No check-in means no
advance, so the next turn re-teaches the same concept, draws the same picture, and again does not
ask. Repeats rise from 7–8 to 17–18 because the loop has closed on itself.

So the shape is a **stall**: the lesson keeps producing pictures, never consumes a concept, and never
asks anything. Everything that looks like progress — concepts given, charts drawn — is the same
concept and the same chart, again.

## Why the check-in stops, as far as the data goes

Partly measured, and not fully:

- **`no-progress` rises** (4, 6 → 7, 12). `atCap` closes the check-in gate before the derivation, and
  it closes it more often on padded turns.
- **Stubs rise** (0, 2 → 3, 7). Below 35 words the gate closes too.
- **That leaves 14 and 18 turns that completed, drew a chart, and still did not ask** — and
  `checkInSkipped` is null for almost all of them.

**The instrument has a hole and it is mine.** `checkInSkipped` is only written when every *other*
condition passed and the chart was missing. A turn that is `atCap` **and** has no derived chart
records nothing at all, because the branch never runs. So the largest remaining group is invisible
for the same reason the original nine were.

## The first thing to build

**Record which condition closed the check-in gate, for every teach turn, not only when the others
passed.** One reason per turn, from the same body that decides — `stub`, `at-cap`, `own-check-in`,
`no-chart-derived-this-turn`, or the derivation's own five — so the bucket is covered rather than
sampled.

That is instrumentation, not behaviour: **nothing about when a check-in fires changes.** It is
deliberately first because this question has now been answered wrongly four times by inference, and
the fix each time was to record the quantity the code branches on.

### Planted cases

Card-free; the gate's conditions are pure given a turn's inputs.

1. **A stub turn records `stub`,** and nothing else — the first condition wins, so a turn that is both
   short and at cap reports the one the code actually tested first.
2. **An at-cap turn records `at-cap`,** where today it records nothing.
3. **A turn whose own text ends with a check records `own-check-in`** — not a fault, and it must be
   distinguishable from a fault.
4. **A turn with no derived chart records `no-chart-derived-this-turn`**, unchanged.
5. **A turn that asks records no reason at all** — the two cannot both be present.
6. **Every teach turn records exactly one of them or a question**, asserted over a fixture
   conversation: no turn may be silent, which is the property the whole page is about.

### The kill number

**On the next two arms, fewer than 5% of teach turns may carry no reason and no question.** Today it
is 27 of 52 a run. Above 5% the recording is still sampling rather than covering, and the next
explanation would again be an inference — at which point recording is not the answer and the gate
itself needs restructuring.

## What this does not claim

- **Not that the stall is bad for a learner.** A lesson that redraws the same picture while the
  learner says "got it" may be exactly what a stuck learner needs. Nothing here measures that, and
  the seat has never been asked.
- **Not that the check-in should fire more often.** That is Max's question, already on his page, and
  this changes nothing about when it fires.
- **Not that padding is the cause.** The stall shape appears in the first turns too, at half the
  rate; the padded turns make it visible rather than create it.
- **Not a fix for the repeats.** `advanceLesson`'s rule — consume only on a turn that taught — is
  deliberate and older than this finding. Whether a stalled lesson should force-advance is a design
  question that needs its own page, and it should not be smuggled in behind an instrumentation change.
