# The derived check-in: the prediction is met, and half of it should not be banked

**Two runs, 2026-09-05, lock held for the runs and released. Registered in
`derived-checkin-prediction.md` before the first call.**

## The numbers

| | re-baseline | **chk-1** | **chk-2** |
|---|---|---|---|
| check-in, all turns | 3, 4 of 47 | **16/47** | **18/47** |
| check-in, substantive | 3/23, 4/25 | **16/27** | **18/28** |
| of those, appended by the product | — | **13** | **15** |
| **of those, written by the model** | 3, 4 | **3** | **3** |
| stubs | 22, 24 | 20 | 19 |
| visual, substantive | 0/23, 0/25 | 15/27 | 17/28 |
| closing shapes | — | pred 15, clar 5, comp 1 | pred 17, clar 7, comp 1 |

**The registered prediction is met**: check-in clears 4 of 47 on both runs, in the predicted
direction, by a wide margin.

## What the number does not mean

**The model's own contribution did not move: 3 and 3, against a baseline of 3 and 4.** Every point of
the gain is the product appending a question. That is what the change was built to do, and it is
worth saying plainly rather than letting "check-in 3 → 16" stand as if teach mode got better at
closing a lesson. It did not. The product now closes it.

## Two things I will not bank, both mine

**1. The check is landing on turns that taught nothing.** Of 13 and 15 derived checks, **6 and 7 sit
on read-first preambles** — turns whose entire prose is *"First, let me read the relevant file to
understand the implementation"* at 33 to 57 words. One lands directly after a clarifying offer.

That is worse than a cosmetic blemish, because the queue advances on **a visual AND an accepted
check**. A preamble turn now has both. **The derived check can advance a lesson past a concept that
was never taught** — which is the opposite of the reason it was built, since outcome 4 failed because
the queue would not advance at all.

**2. The stub improvement is an artifact of my own change.** A stub is `words <= 35 && !endsWithQuestion`.
Appending a question flips a 33-word turn out of the stub class **without adding one word of
teaching**. Stubs 20 and 19 against [22, 24] is therefore not evidence of anything, and I am
recording it as contaminated rather than as a second win — the same contamination I have been
policing all night, produced by me.

## The fix this asks for, not made yet

The gate should not be "a chart exists". It should be **"this turn taught"** — the derived check
appends only when the turn carries substantive prose, not a preamble. The obvious threshold is the
stub boundary the bench already uses, which would have withheld the check on 5 and 7 of these turns.

That is a change with its own prediction and it is registered here rather than slipped in: with the
gate, check-in falls from [16, 18] to roughly [8, 11], **and that is the honest number** — a check-in
on every turn that actually taught, and none on the turns that did not.

## Quiz or check — the reading I owe

Read in place, it reads as **a check, not a quiz**, and the reason is that it points at something on
the screen: *"Looking at the picture: if bigram_counts.py changed what it returns, which of
nn_bigram.py or sampling.py do you think would break first?"* It asks the learner to use the diagram
rather than recall a fact, and it is answerable by someone who followed the lesson and not by someone
who did not — which is the property the whole check-in metric exists for.

**Where it reads badly is exactly where it should not have fired.** Appended to *"First, let me read
the relevant file"*, the same sentence reads as a non-sequitur — a question about a picture attached
to a turn that taught nothing. The wording is not the problem there; the gate is.

One phrasing note for later: it opens the same way every time. Over a six-concept lesson a learner
would read "Looking at the picture:" six times, and that is the shape of thing that starts to feel
mechanical. Worth varying once the gate is right, not before.

## The gate, landed — and a correction to my own registered number

Gated on **"this turn taught"**, never on "a chart exists", with two conditions:

- **substantive prose**, at the 35-word stub line;
- **the turn did not run out** (`atCap`) — the ceiling or the no-progress rule ending a turn means
  the model never delivered, so there is nothing to check the learner on. The 40- and 50-word
  preambles the word gate lets through are exactly these.

**My registered prediction of roughly 8 to 11 of 47 was wrong, and I am correcting it before the
run rather than after.** It came from counting derived checks on turns under 70 words. The gate sees
**prose only**, without the appended question, and at that measurement a 35-word line withholds
**4 of 13 and 6 of 15** — giving **12 and 12**, not 8 to 11. Adding the `atCap` condition removes an
unknown further few.

**Revised prediction: check-in lands in [9, 13] of 47 on both runs**, with the word gate alone
accounting for 12 and 12. **Refuted if** it stays above 13 on either run (the gate is not reaching
the preambles) or falls below 9 (it is withholding checks from turns that did teach).

## And a third number that was never shared

Writing the gate exposed one more: **35 words lived only in the analysis scripts.** Every stub
figure in this directory was computed at that line by a script reading the reports, while the bench
source defined no such threshold and the product did not know it — three places, one number, none of
them shared. `TEACH_STUB_WORDS` is now exported by the product, gated on by the product, and imported
by the bench, which records `stub` per turn from it.
