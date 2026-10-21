# Does a more specific naming instruction get obeyed? — registered, then WITHDRAWN before it ran

**Registered 2026-09-09. Withdrawn the same day, before any card, by a measurement on data already
in hand.** The registration is kept in full below the withdrawal, because a registration that is
quietly deleted when it stops being convenient is not a registration.

---

## WITHDRAWN — the belt already contains the experiment

The registration was going to spend four bench arms (~2.5 hours of card) asking whether a *more
specific* naming instruction is obeyed more than a vague one. Before building the wording, a grep for
the exact contract sentence turned up the reason not to: **the teach contract already gives the same
order twice, in the same section of the same belt, at two levels of specificity.**

Vague — `packages/analyzer/src/server/askPipeline.ts:1256`:

> *"Ground the concept in THIS repository: name the real node/file (exact label) the concept lives
> in, and cite real evidence (file:line) when you make a claim."*

Specific — the same belt, nine lines later:

> *"NAME THE REAL COMPONENT IN THAT QUESTION. The example above says 'the auth service' because it is
> an EXAMPLE; your question must name the actual part of THIS repository the lesson is about. A
> closing question still carrying a bare placeholder where the component name belongs is not a
> question the learner can answer, and does not count as a check-in."*

The second is exactly the treatment the arm was going to write: it says what to look for, names the
failure mode, and quotes the example it must not copy. **It ships today, and it has been running on
every teach turn in the corpus.**

### What it scores

296 concept-bearing turns, nine arm files, `granite42-hermes` Q4_K_M — the same corpus as
`teach-mode-driven-end-to-end.md` §7, **scored on disjoint text**: the body is the turn with its
closing question removed, so the two clauses are judged on text that does not overlap.

| clause | scope | obeyed |
|---|---|---|
| **(1) vague** | lesson body | **49.3%** (146/296) |
| **(2) specific** | closing question | **36.8%** (109/296) |

**The specific instruction is obeyed less, not more, and nothing here is in the neighbourhood of the
79 that motivated the hypothesis.** Same model, same belt, same turns, same match rule — a paired
within-turn comparison, which is stronger than the four-arm design would have been on everything
except the confound below.

### Why this WITHDRAWS the hypothesis rather than refuting it

**The pair differs in three things, not one:** specificity, scope size (one sentence against ~150
words), and the syntactic position the name has to land in. A control must differ in the change under
test and nothing else, and this pair differs in three, so **it does not refute specificity and this
page does not claim it does.** Two of the three — the scope and the position — bias *against* clause
(2), so the direction is softer evidence than the gap looks.

What it does do is remove the registration's premise. The argument for spending the card was "we have
never tried a specific naming instruction on this model." **We have. It is in the shipped belt, it has
296 turns behind it, and it did not buy obedience.** Running four arms to write a second one would be
the louder-clause reflex wearing a measurement's clothes — which the registration's own last line
warned about, before it went and proposed exactly that.

### The measurement bug this nearly shipped with

**The first run of this comparison returned 1.0% for clause (2), and it was wrong.** The closing
question was extracted with `[^.!?\n]*\?` — "everything since the last sentence end, up to a question
mark" — which treats the dot in `askPipeline.ts` as a sentence end. A closing question that **did**
name a file was truncated to `ts when that queue backs up?` and scored as naming nothing. The check
under-counted precisely the thing it existed to count, in the direction of the hypothesis, by **36
points**.

Caught by two perfect coincidences in the output — `closeOnly = 0` exactly, and two unrelated counts
both landing on 102 — and fixed with a plant built from the failure itself: the old rule asserted RED
on a real turn shape before the new one was written
(`sentences()` splits on `[.!?]` only when whitespace or end follows). Both coincidences dissolved
once the scopes were made disjoint. **A number that arrives with a perfect coincidence attached has
not been measured yet.**

### What the evidence points at instead

Splitting the corpus by whether a turn names its concept *anywhere* and whether it asks any question
at all:

| | |
|---|---|
| does both | 53.7% (159) |
| names it, asks nothing | 11.8% (35) |
| asks something, names nothing | 11.8% (35) |
| **does neither** | **22.6% (67)** |

**Those 67 turns are the pocket worth opening, and they are not a truncation story:** mean 158 words,
**64 of the 67 carried a visual**, and 30 stopped `complete` against 37 `no-progress`. A turn that
runs to full length, draws a picture, and honours neither naming clause nor the question clause is not
failing one sentence of the belt — and no rewording of one sentence is going to reach it.

**No arms were run. No card was spent.** The next step on this thread is those 67 turns, not a fifth
wording.

---

# The registration as it stood, before the withdrawal

**Written 2026-09-09, before the wording exists and before any card. On the teach contract.**

## The gap this addresses

Measured card-free over nine arm files, **296 teach turns given a concept**, `granite42-hermes`
Q4_K_M (`docs/research/teach-mode-driven-end-to-end.md` §7):

| does the lesson name the concept it was given? | |
|---|---|
| exact label, which is what the contract demands | **54.4%** |
| stem only | 11.1% |
| **neither** | **34.5%** |

**65 of the 102 misses completed normally, at full length, with a visual.** So this is mostly
disobedience rather than turns that ran out of road, and the clause is **present and unconditional** —
verified by dumping the composed belt, where the teach section is last of four with nothing
contradicting it (§4).

## The hypothesis, and why it is not "say it louder"

The instruction that carried **53 → 79** on a small model elsewhere was concrete about *what to
enumerate*:

> *"Name EVERY component the description mentions, including the client or caller at one end and the
> store at the other."*

The teach contract's version names a *property the answer should have*:

> *"Ground the concept in THIS repository: name the real node/file (exact label)."*

**The hypothesis is that specificity — telling the model what to look for — is what the first sentence
had and the second lacks.** It is the fifth instruction failure in this tree, and the first where
neither self-gating nor contradiction explains it, which is why a wording arm is worth a run at all.

**This is one wording written by one person.** A null says this wording did not help; it does not say
specificity cannot.

## THE CONTROL IS A FRESH ARM, NOT THE 54.4%

**The number above is a PRIOR, not a control**, and using it as one would be the mistake this
repository has a law about. Those 296 turns ran on a different build, over several days, on
`granite42-hermes`. An arm's control must differ from the treatment in the change under test and
nothing else.

**So: two control arms and two treatment arms, same build, same model, interleaved
control/treatment/control/treatment, a wording switch the only difference** — on the pattern of the
existing `SEQUENCE_TEACH_CHECKIN_FORM` env switch (`askPipeline.ts:3071`), which is how a wording
variant is already carried into a bench arm here.

**Run on `granite42-hermes` Q4_K_M, not on the current default.** §6 measured that a teach turn on
`minicpm5-hermes` Q8_0 hits the 180-second deadline mid-lookup and writes no lesson at all — three
attempts, no lesson. A bench arm on that model would produce void turns, not a measurement. **Any
result is therefore a granite result and the page must say so.**

## The kill, and the power limit that constrains it

Each arm is 13 conversations × 4 turns = **52 turns**, so two arms a side is about **104 turns a
side**, of which roughly 70% are given a concept.

At a base rate near 54%, the standard error on ~70 concept-bearing turns is about **6 points**, so a
difference under roughly **12 points is not something this design can resolve.** Registered
accordingly:

- **KILL: refuted unless the exact-label rate rises by 12 points or more, in BOTH treatment runs,
  against the higher of the two control runs.**
- **A rise smaller than that is reported as "no detectable change", never as "a small improvement".**
- **The `names neither` rate must not rise** in either treatment run. A wording that raises exact
  naming while pushing more turns into naming nothing has moved turns from the stem bucket and is not
  a win.

**Stated now because it is free now:** at these numbers the likely outcome is *no detectable change*,
and that is a real answer to "is specificity the missing ingredient" — it would move the explanation
somewhere other than wording, which is where four of the five previous failures ended up anyway.

## Void by construction

A turn is void for this measurement when `conceptGiven` is absent — there is nothing to name. Those
are already excluded above (296 of 424). **An arm with fewer than 30 concept-bearing turns is void and
re-run**, because the power statement above assumes roughly 70 and a short arm silently weakens the
kill.

## What could go wrong

- **The new sentence lengthens the belt.** The teach section is already the largest of four. Token
  count is reported beside the result; no band is registered on it, because a naming sentence is a few
  dozen tokens and a threshold there would be a quantity the change cannot move.
- **It could cost the visual.** The contract's one-visual rule sits in the same section. `visual`
  is reported per arm; **a fall in the visual rate voids the run rather than refuting it**, because
  that would mean the sections are coupled and the arm measured two changes.
- **It could raise refusals.** Stub rate is reported against the control's range.

## What this cannot show

- **Not that the lessons teach better.** It measures one clause: does the turn name the file it was
  told to teach. A lesson can name it and still be poor.
- **Not a minicpm5 result**, and not transferable to another quantisation.
- **Not the deadline finding's answer.** §6 is a separate problem and this does not touch it.

## Cost

**Four bench arms, roughly 2.5 hours of card**, on the pattern the belt re-run used. Nothing else on
the card while they run, including diagnostics from this lane.

**Not started** — and now never starting; see the withdrawal at the top.
