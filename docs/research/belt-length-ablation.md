# Is the belt's LENGTH the cost? — registered before the numbers

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


**Written 2026-09-05 while the instrumented twenty was still running**, so the prediction below
is blind to its result. That matters more than usual here, because three interventions in a row
have moved the same metrics the wrong way and the tempting story — "the belt is saturated" — is
one I would now believe without checking.

## The pattern that prompted it

Three separate changes, each adding to a 19-bullet teach contract, each measured on the same
twenty conversations:

| intervention | what it added | check-in | stubs | substantive |
|---|---|---|---|---|
| baseline (no lesson state) | — | 22/47 (46.8%) | 17 | 30 |
| belt TURN SHAPE header | an ordering header, one bullet moved | 14/47 (29.8%) | 29 | 18 |
| lesson state | `concept`, `taught` | 20/47 (42.6%) | 17 | 30 |
| three sources | `needsPlan`, `lessonDone` | 12/47 (25.5%) | 23 | 24 |

Every version that added INSTRUCTION lost check-ins and gained stubs. The version that added only
DATA (`concept`, `taught` — filled slots, no new rule) moved almost nothing. That is the shape of
a length effect, and it is also the shape of three coincidences.

## The ablation

Cut the belt to what the contract's hard rules actually enforce, and nothing else:

- one concept per turn
- one visual, drawn with `propose_chart`
- one closing check-in
- the pacing bound (~150 words)
- the refusal rule (never assert what is not in the repository)

Everything else becomes DATA in the slots — the concept, the taught list, the finished-lesson
state — supplied rather than instructed. Same twenty conversations, same model, same lock, both
denominators, the same three-way split.

## The prediction

**If length is the cost: check-in returns toward 22 of 47 and stubs toward 17.**

Stated so it can fail:

- **Refuted if** the short belt holds check-in near 12/47 and stubs near 23. Then length is not the
  mechanism, the interventions were bad on their own terms, and the thing to look at is what each
  one SAID rather than how much was said.
- **Refuted also if** the short belt loses the metrics the cut bullets were protecting — if the
  refusal rule or the pacing bound turn out to have been carrying `paced 46/47`, the cut is a
  regression wearing a win's clothes. Both denominators are reported for exactly this.
- **Visual is not the test.** It has been 0 or 1 of 47 in every configuration measured tonight, and
  a metric that never moves cannot discriminate between belts. If it moves, that is information;
  if it does not, the ablation is judged on check-in and stubs.

## What ships tonight

Nothing. Not the belt change (reverted), not the three sources' belt slots, not the ablation. The
belt that reaches the product is chosen on this run's numbers, and the record is the deliverable
until then.

---

# THE EFFECT SIZE THAT COUNTS — added before the ablation's first call

Two runs of the **identical** configuration (the three sources; the second differed only in which
fields the REPORT wrote, nothing reaching the prompt), at temperature 0:

| identical config | run A | run B | spread |
|---|---|---|---|
| ends with check-in | 12/47 | 18/47 | **6 of 47 — 13 points** |
| stubs | 23 | 19 | **4** |
| substantive | 24 | 28 | 4 |
| paced | 45/47 | 47/47 | 2 |

So the long belt's observed range is **check-in [12, 18] of 47** and **stubs [19, 23]**.

## The bar

A belt change counts only if **BOTH** short-belt runs sit **outside** that range on **check-in**
AND on **stubs**, and the split direction agrees.

- clears the bar: both runs check-in **> 18/47**, both runs stubs **< 19**
- also clears it in the other direction: both **< 12/47** and both **> 23** — a change can be
  proved harmful, which is worth as much
- **anything inside the range is NO EVIDENCE**, and the record says exactly that rather than
  reporting a direction

Two runs a side is the minimum this bar can be judged on, and it is a weak minimum: two points
give a range, not a variance. A result that clears it is worth acting on; a result that clears it
narrowly is worth repeating before it ships.

## And the prediction from earlier still stands

Check-in returns toward 22/47 and stubs toward 17 if length is the cost. Against the bar above,
that means both short-belt runs above 18/47 on check-in and below 19 stubs. It is now falsifiable
in a way it was not when written, because the noise floor is measured rather than assumed.

---

# THE RESULT — four runs, and the hypothesis does not survive

| belt | stubs | substantive | paced | check-in | visual | chart calls | never-asked |
|---|---|---|---|---|---|---|---|
| LONG A | 23 | 24 | 45/47 | 12/47 | 1/47 | 4 | 45/46 |
| LONG B | 19 | 28 | 47/47 | 18/47 | 1/47 | 12 | 41/46 |
| **SHORT 1** | **25** | 22 | 47/47 | **19/47** | 0/47 | **0** | **47/47** |
| **SHORT 2** | **26** | 21 | 47/47 | **19/47** | 0/47 | **0** | **47/47** |

Short belt: 654 characters, 4 bullets. Long belt: 6,853 characters, 19 bullets. A tenfold cut.

## The verdict: no evidence for the short belt, and evidence of a trade

The bar said both short runs must fall outside the long belt's range on check-in AND stubs. They
do — **in opposite directions**:

- check-in **19 and 19**, one point above the long range [12, 18] — the narrowest clear possible
- stubs **25 and 26**, above the long range [19, 23] — *the wrong way*
- chart calls **4 and 12 → 0 and 0**, never-asked **47 of 47**

**The prediction is refuted.** It required check-in toward 22/47 AND stubs toward 17. Cutting the
belt tenfold moved check-in by one point and made stubs worse, so **belt length is not the
mechanism** — which kills the tidiest story available and the one this file was written to test.

The short belt still contains the visual bullet, and the model stopped asking for a chart
altogether. Whatever was making it reach for the tool occasionally lives in the bullets that were
cut, not in the one that survived.

## Two errors of my own that this exposed

1. **The bar was under-specified.** "Both runs outside the range on both metrics" is satisfied by a
   split like this one. It should have required the direction to AGREE with the prediction; the
   prediction did require it, the check did not, and the code reported "BAR CLEARED" for a result
   that refutes it. Fixed in the wording above; the lesson is that a mechanical bar has to encode
   the direction or it will happily confirm the opposite of what was predicted.
2. **A one-point margin is not a clear.** This file already said a narrow clear is worth repeating
   before it ships. 19 against a range topping out at 18 is that case exactly.

## What ships

**Neither belt.** The product keeps the long belt it has. Nothing measured tonight justifies
changing it, and the four runs above are the reason rather than a preference.

## Registered next, not run

**Does a MID-LENGTH belt — the chart instruction kept, the rest of the cut bullets dropped — land
inside or outside both ranges?** The short belt lost the visual entirely while keeping the visual
bullet, so the chart instruction alone is evidently not what produces a chart call. If a mid belt
recovers chart calls, the causal part is in the bullets around it; if it does not, the visual is
being produced by something other than the contract's wording, and the prediction file for the
visual metric needs reopening.

Two runs a side, direction required to agree, same twenty conversations.

---

# THIRD ARM: the mid-length belt — registered 2026-09-05, before any run

## Why this arm and not another

The short belt **kept a visual bullet and lost the visual entirely** — chart calls 4 and 12 → 0
and 0, never-asked 47 of 47. So the thing that makes the model reach for `propose_chart` is not
"there is a bullet telling it to". The full belt has **two** chart bullets and the short belt
condensed them into one, dropping the half that says what a chart is FOR:

- `askPipeline.ts:1057` — *"The visual is propose_chart. It is NOT canvas.write_markdown: one chart
  carries the whole breakdown … in ONE validated call … while a markdown block is prose wearing a
  picture's clothes."*
- `askPipeline.ts:1061` — *"EVERY concept ships ONE visual, drawn with propose_chart: you choose
  the chart KIND … Give items a nodeId when they stand for a real part of the repository."*

The short belt carries a compression of :1061 only. **:1057 — the one that distinguishes the tool
from the alternative the model would otherwise reach for — was cut.**

## The mid belt, defined exactly

The short belt's four rules, with **both** chart bullets restored **verbatim** from the full belt:

1. ONE concept this turn, ~150 words
2. `:1057` verbatim
3. `:1061` verbatim
4. END with one short check-in question
5. Ground every claim; never assert what the code does not show

Nothing else from the nineteen. That is the only difference from SHORT, which is what makes the
arm interpretable.

## The prediction, with direction required

Observed ranges, two runs a side:

| metric | LONG | SHORT |
|---|---|---|
| check-in | 12–18 of 47 | 19, 19 |
| stubs | 19–23 | 25, 26 |
| chart calls | 4–12 | 0, 0 |

**Predicted: chart calls return into or above [4, 12] on BOTH runs, while stubs come back below 25
on both.** That is the claim that :1057 is load-bearing for tool use.

Direction agreement is required — the error the last arm exposed. A result counts only when both
runs fall outside the compared range **in the direction predicted**; outside in the wrong direction
is a refutation, not a clear, and the check must encode that rather than testing "outside".

**Refuted if:**
- chart calls stay at 0 on either run → the wording is not what produces a chart call, and the
  visual-metric prediction in `visual-metric-prediction.md` needs reopening: something other than
  the contract is deciding this, and 95% "never asked" has a cause nobody has named.
- stubs stay at 25+ on both → the stub cost is not belt length OR chart wording, and the remaining
  suspect is the lesson-state slots supplied as data, which is the one thing never ablated.
- check-in falls back inside [12, 18] on both → the short belt's one-point gain was noise, which a
  one-point margin always suggested.

**Not run tonight** unless the card is free after the skipper bench and nothing else is queued. Two
runs when it runs.


---

# RE-READ, after the check-in metric was fixed

**Every check-in number above measured "ends with a question mark".** Of the 31 questions those
turns produced, 15 are CLARIFYING — *"would you like me to show the diagram?"* — the one shape the
belt bans outright, and every one satisfied the old metric. Re-graded offline from the stored
transcripts, on "ends with a comprehension question or a prediction":

| run | OLD check-in | **NEW check-in** | clarifying | parroted label | stubs |
|---|---|---|---|---|---|
| LONG A | 12/47 | **2/47** | 9 | 0 | 23 |
| LONG B | 18/47 | **6/47** | 11 | 0 | 19 |
| SHORT 1 | 19/47 | **1/47** | 15 | 4 | 25 |
| SHORT 2 | 19/47 | **1/47** | 15 | 5 | 26 |

## The mixed result resolves, and the short belt is worse

The short belt's apparent gain — 19 against [12, 18] — was **entirely clarifying questions**. On the
metric the contract actually asks for it produces 1 and 1, against the long belt's [2, 6]:

- check-in: both short runs **below** the long range — worse
- stubs: both short runs **above** the long range — worse
- direction **agrees** on both

So the arm clears the bar **in the harmful direction**, which this file said counts for as much as
the helpful one. **The short belt is measurably worse, not ambiguous**, and the earlier "cleared in
opposite directions" reading was an artifact of grading question marks.

## Two things this exposes

1. **Real check-ins are 3 to 19 times rarer than anything reported.** The best of four runs produced
   6 of 47. The teach contract's closing beat is mostly not happening, and the metric said it was.
2. **Parroting tracks belt terseness**: 0 and 0 under the long belt, 4 and 5 under the short one. The
   terse "END with one short check-in question" invites the model to write the label `Check-in:`
   literally; the fuller instruction suppressed it. That is the opposite of what the parroting fix
   assumed — it treated the EXAMPLE as the cause, and terseness looks like a cause too.

The ruling is unchanged: neither belt ships. The reason is now stronger — the short belt is not
merely unproven, it is worse on both metrics once they are measured honestly.


---

# THIRD ARM, AMENDED — the honest metric changes both the belt and the prediction

The arm registered above was written against `endsWithQuestion`. That metric counted clarifying
offers, so both the belt it proposed and the numbers it predicted need restating before it runs.

## Amendment 1 — the check-in bullet gives the SHAPE

Terseness invited the parroted label (0 and 0 under the long belt, 4 and 5 under the short) and
length invited offers (15 of 31 questions clarifying). So the mid belt's closing bullet does neither
— it names what the question must BE:

> `- END with one question the learner can answer from the concept you just taught. Never an offer
> to show, explain or continue — "would you like me to…" is not a check, it is a menu. Do not label
> it.`

That is the contract's own test made into the instruction rather than left as a prohibition
elsewhere in a nineteen-bullet belt.

## Amendment 2 — the prediction, on the honest metric

Ranges re-measured with `gradeCheckIn`:

| metric | LONG (2 runs) | SHORT (2 runs) |
|---|---|---|
| real check-ins | **2–6 of 47** | 1, 1 |
| stubs | 19–23 | 25, 26 |
| chart calls | 4–12 | 0, 0 |
| clarifying questions | 9–11 | 15, 15 |
| parroted labels | 0, 0 | 4, 5 |

**Predicted: both mid-belt runs above 6 of 47 on real check-ins, and clarifying below 9 on both.**
Chart calls into or above [4, 12], stubs below 25.

Direction agreement required on every claim: outside a range in the wrong direction is a
refutation, not a clear. That is the error the first arm exposed and the check now encodes it.

**Refuted if** real check-ins land inside [2, 6] — then naming the shape does not produce the shape,
and the closing beat is not something the belt can buy at any length. That would be the most useful
refutation available, because it is the last belt-side explanation standing.

Two runs, not tonight.
