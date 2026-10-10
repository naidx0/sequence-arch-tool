# Where I disagreed with the three design pages

**2026-09-06.** The research lane wrote three design pages and this lane built from them. Two pages'
disagreements were recorded in commit bodies as the builds landed; the third's were not, because I
built it from a relayed description before the vault was reachable and only read the page afterwards.
All of them are collected here so the pages can be read against what was actually built.

## `design-the-scripted-seat.md`

Recorded in `2905a1b8` and `scripted-seat.md`.

- **§4's `void_unless` names *scrolled* as its example, and the seat has no scroll beat.** The scroll
  lives in `capture-journey.mjs --video`, which is where the frozen-thirteen-seconds defect actually
  happened. I kept the rule and changed its subject: a beat is void unless its **frame hash changes**,
  plus the chart-shown rule as written. `voided N of M` on a rule that could never fire here would be
  decoration.
- **§5 estimates ~300 new lines on ~530 owned.** Actual: the seat is 579 lines and the replay 211, on
  `capture-journey.mjs` 275 + `chromium.mjs` 154. The estimate predates the planted cases, the void
  rules, the evidence copies and the ledger block.
- **§6 case 2 as written** ("plant a broken selector, expect the beat to fail by name, `beats 3 of 5`")
  is fault injection I did **not** build. I did the thing it is for instead: read every selector out
  of `AiCanvas.tsx` and verified each matches on the live app. Planting a broken selector proves the
  harness notices; checking the real ones proves the harness is right today, and only one of those
  was affordable.

## `design-the-counting-gate-for-sequence.md`

Recorded in `87ddf513` and `counting-gate.md`.

- **§3's "ran N of N declared" is not checkable as an equality, and I did not build it that way.**
  Declarations counted on disk came to 2,942 against 3,007 tests run. A `test()` inside a loop
  produces many tests from one declaration, so `ran` legitimately exceeds `declared` and an equality
  would fire on healthy packages. I built the half that is exact — *every built test file is
  reachable by some glob* — which is what caught the real defect. The declaration count is a lower
  bound, not an equal.
- **§7's "nine packages" is eight** under node's runner: `api-types` has no tests and `web2` uses
  vitest. (The page's own addendum reached the same correction.)

## `interactive-and-visual-teaching-the-evidence.md`

**Not previously in a commit body.** I built its registered change from a relayed description while
the vault was unreachable, and read the page only afterwards. Two gaps, both mine:

- **I under-built the change.** The page registers the prediction *and* "one added line naming the
  arrow that decides it" on the reveal — its implication 1, that feedback must carry the reason and
  not only the verdict. I built the prediction and **not** the reveal line. It is unbuilt, and the
  flag should not be read as complete until it is.
- **The wording differs, deliberately, and I had not surfaced why.** The page asks *"which do you
  think breaks first if X changes what it returns?"*; I ask *"which do you think depends on it?"*
  The scanned graph has no ordering, so a reveal claiming which breaks *first* would assert something
  the scan cannot support, and this product's first law is that a claim traces to evidence. Mine is
  exactly checkable against the edge set — but by the page's own Brod reasoning it is a weaker
  prediction, because "depends on it" can be answered from recall while "breaks first" is a
  judgement that can be violated. **That is a real trade and it deserves a ruling rather than my
  quiet preference.**

The page also records a note back to this lane worth keeping: both defects found while building the
change — distractors of the wrong kind, and distractors that were constant — are about *what a
multiple-choice item measures*, and neither is in the evidence page, which cited format numbers
without a word on distractor construction.
