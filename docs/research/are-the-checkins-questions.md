# Are teach mode's check-ins questions? — 31 of them, measured

**The first measurement anyone has made of whether the pop-up questions the owner liked are the
kind of question the contract asks for.** No GPU: it reads the questions the bench already
recorded and classifies them against the belt's own taxonomy.

Source: `tools/bench/out/teach-eval-report.json`, the 20-conversation run of 2026-09-05,
47 turns, **31 questions**, every turn carrying the `questions` field.

## The split

| shape | count | the contract's position |
|---|---|---|
| **clarifying** — *"Would you like me to show…"*, *"Shall I…"*, *"Do you want…"* | **15 of 31 (48%)** | **BANNED OUTRIGHT** |
| comprehension — *"Do you understand…"*, *"Does that make sense…"* | 1 of 31 | wanted |
| prediction — *"what do you think…"*, *"what happens if…"* | 1 of 31 | wanted, the preferred close |
| none of the three | 14 of 31 | unclassified |

One id per class:

- clarifying — **`ml-02`**: *"Would you like me to show you the actual file contents or explain any
  specific part in more detail?"*
- comprehension — **`ml-04`**: *"Check-in: Do you understand why the dot appears at both the start
  and end of name sequences in this code?"*
- prediction — **`ml-10`**: *"Would you like me to show how the softmax probabilities are used in
  the model's prediction…"* — and note this one is ALSO clarifying, which is why the counts overlap
  and the honest total is not a partition.

**The belt's own words:** *"NEVER ask a CLARIFYING question — not one, not at the open, not
mid-lesson, not at the close. … THE TEST: if their answer would change what you do next, it is
clarifying and it is banned; if it only reveals whether they followed you, it is a comprehension
check and it is wanted."*

**Nearly half the check-ins are the one shape the contract forbids outright**, and two of 31 are
the two shapes it asks for. The bench's `classifyQuestion` types all 31 as `other`, which is
consistent: it looks for prediction and why-shaped questions and finds effectively none.

## The parroting share

**5 of 31 (16%)** carry the contract's own label as visible prose — `Check-in:` — detected by
`parrotMarkers`:

```
ml-04  t0   Check-in: Do you understand why the dot appears at both the start and end …
ml-05  t0   Check-in: Would you like me to show how the neural net's learned weights compare …
ml-06  t0   Check-in: Would you like me to show how this NLL value is printed during training …
ml-12  t0   Check-in: Would you like me to show how this counts matrix is used in `nn_bigram.py` …
math-02 t0  Check-in: Would you like me to show how this gradient appears in the specific lines …
```

That label is contract vocabulary a learner should never read. It had been fixed — the belt's
quotable example was replaced with a description — and the fix rode on the TURN SHAPE belt change
that was reverted when the ablation refuted it. **The revert restored the parroting**, which is a
consequence I should have predicted at revert time and did not.

Four of those five are also clarifying questions, so the parroted label and the banned shape arrive
together.

## What this does and does not say

It says the questions are mostly **offers to do more work**, not checks on whether the learner
followed. That is a different failure from "no question at all", and it is invisible to the
`endsWithQuestion` metric, which counts a trailing `?` and is satisfied by every one of the 15.

It does **not** say the lesson taught nothing — that is the skipper bench's question, and its
scoring half does not exist yet.

**A caveat on the classifier:** the three shapes are matched by phrase, the categories overlap
(`ml-10` is in two), and 14 of 31 match none. A phrase matcher is the right instrument for "is this
an offer or a check" and the wrong one for anything finer. The counts above are floors, not a
partition.
