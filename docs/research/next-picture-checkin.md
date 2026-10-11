# Ask the prediction before the picture — registered, built behind a flag, unrun

**Registered 2026-09-05T23:45Z. Built and tested; no card run has happened, and the flag is off.**

> **RULED 2026-09-06, on the wording and on the reveal.** I had asked *"which do you think depends
> on it?"*; the evidence page asks *"which breaks first if X changes what it returns?"*. Both are
> now superseded by the ruling: **"which of these would break if X changed what it returns"**, with
> no *first*.
>
> The reason, recorded because the wording is the measurement: **"breaks first" asserts an order the
> scanned graph does not have**, and a reveal claiming one would state what the scan cannot support —
> the first law of this product. **"depends on it" is answerable from recall**, which makes it a
> lookup rather than a prediction, and a lookup cannot be violated, which is exactly the property
> Brod's surprise condition needs. **"would break" is both**: falsifiable, because naming a
> non-dependent is wrong, and answerable from the graph, because the dependency is an edge.
>
> And the reveal the page registered is now built: **one added line naming the arrow that decides
> it**, from the graph. The flag reads complete only with it. It is in CODE, not asked of the model,
> for a measured reason — the prompt already carried a branch instructing the model to resolve an
> open prediction, and **nothing ever set `open`, so that branch had never once fired**. A reveal
> that depends on the model doing it is a reveal that does not happen, which is the same lesson the
> derived visual and the derived check-in each cost a night to learn.
>
> The prediction is **carried across the turn**, not re-derived: re-deriving it from the queue would
> answer whatever concept happens to be current, which is not necessarily the one the learner was
> asked about — a true sentence in the wrong place. It is cleared on a turn that asked nothing, so a
> stale reveal cannot survive.

## The change

Today's derived check-in asks the learner to **read** the picture already on screen: *"Looking at
the picture: if brief.ts changed what it returns, which of cli.ts, index.ts or repoServer.ts do you
think would break first?"* The answer is visible. That is a comprehension question about a diagram
in front of you, which is close to free.

The new form asks a **prediction about the picture the product holds and has not shown** — the chart
for the next concept in the queue:

> *"Before I draw it — next is brief.ts. Which of cli.ts, industryStarters.test.ts or
> inferAskTarget.ts do you think would break if brief.ts changed what it returns? I will show you
> the picture next turn."*
>
> and next turn, with the picture:
>
> *"Last turn you were asked which would break. It is **cli.ts**, and the arrow that decides it is
> `cli.ts → brief.ts` in the scanned graph — that is the dependency, so a change to what it returns
> reaches there."*

**One visual per turn is unchanged.** The next concept's chart is built to source a truthful
question and then discarded; nothing emits it. The turn still ships exactly one picture — the one
for the concept it actually taught.

`SEQUENCE_TEACH_CHECKIN_FORM=next-picture` selects it. Absent or unset puts the current form on
every turn, byte for byte as before, and a test asserts the comprehension form is untouched.

## The evidence, and the belief it does not support

The **pretesting effect**: attempting an answer before meeting the material improves retention of
that material, *including when the attempt is wrong*. And **Brod's surprise condition**: a violated
prediction is remembered better than a confirmed one.

What neither supports — and what this product has been quietly assuming — is that **a picture
teaches by being shown**. A diagram nobody predicted against is a diagram nobody engaged with. The
derived visual work this week established that the product can *draw* reliably; it established
nothing about whether drawing helps.

## The registered bands

On the **sequence** condition:

| form | expected correct |
|---|---|
| current (read the picture on screen) | **≥ 90%** |
| next-picture (predict the one not yet shown) | **between 30% and 70%** |

**Refuted** if the next-picture form scores **≥ 90%** — the prose gave the answer away, so it is not
a prediction — **or ≤ 20%** — it is a quiz on material the learner had no basis to answer, which is
not a pretest either.

**Also refuted, separately, if any of these move**: the check-in rate, the chart rate, or outcome
four (a second turn continuing rather than restarting). Those three describe whether the teach
contract still holds; a check-in change that costs one of them is not a trade this measures.

## Two defects found while building it, before any run

1. **The distractors were the wrong kind.** The first version drew them from any node and produced
   *"which of acp, cli.ts or repo depends on it?"* — one file among two service names. The odd one
   out is visible without knowing anything about the repository, so the question measured
   shape-spotting. Distractors are now files with the answer's own extension.
2. **They were constant.** Taking the first two candidates gave every concept the same pair
   (`client.ts`, `executor.ts` on all three concepts tried). A learner meeting the same two wrong
   answers twice learns *"pick the unfamiliar one"* — a rule about the question, not about the code.
   The choice is now a hash of the focus label: same lesson always asks the same question, so two
   bench runs are comparable, while different concepts get different distractors.

Both are locked by tests. Neither would have shown up in a run; both would have quietly made the
next-picture number mean something other than what the bands assume.

## Status

**Flag off, unrun.** Queued behind the check-in gate runs — the bands are read against the sequence
condition, which is itself behind the check-in gate in the card queue.
