# Requiring the closing beat to be a CHECK — registered before the re-baseline

**Written 2026-09-05, before the re-baseline runs, with the change in the tree.**

## What changed

`gradeTeachTurn`'s closing rule tested for a trailing `?`. It now requires the closing question to
be a CHECK — comprehension or prediction — using the same `gradeCheckIn` the bench and the server
already use. An offer is bounced with a message naming what is wrong with it.

Narrow on purpose: the CLOSING BEAT only. The contract explicitly permits an offer mid-lesson, and
that stays legal. What an offer may not do is stand in for the check-in.

## The measurement that asks for it

Both runs, 94 clean turns, using the stored text:

- **24 of 94 turns close on a CLARIFYING offer** — the one shape the belt bans outright.
- **The product bounced 0 of those 24.** Its clarifying rule keys on our own tool vocabulary
  (chart kinds, formats, dialects), a deliberately closed class, and an offer to explain something
  needs no vocabulary of ours.
- After the change: **24 of 24 bounced, and all 10 real checks untouched.**

## Why this is registered rather than just landed

It changes what happens on **roughly a quarter of all turns**, and a bounce is not free: it spends a
corrective round, and the model may answer it by padding rather than by checking. The direction is
genuinely unknown, so it is written down before the numbers exist.

**Prediction.** Check-in rises above the current [5, 5] of 47 on both re-baseline runs, because a
turn that would have closed on an offer is now told to close on a check and has a round in which to
do it.

**What would refute it:**

- check-in does not clear [5, 5] on both runs → the bounce does not convert; the model answers the
  complaint some other way;
- **stubs get worse than the current [23, 24]** → the corrective round is being spent on padding,
  which would make this a cost with no benefit and is the outcome that should reverse the change;
- word budget violations appear where there were none → same story, louder.

## The ordering, stated because it is the part that can be got wrong

This lands BEFORE the re-baseline on purpose. The re-baseline exists to give the mid-length belt arm
a comparable range; a change landed *after* it would sit inside both arms of that experiment and
outside the baseline they are read against, which is exactly the contamination that made the
`[4, 12]` chart-call range unusable (`redirect-visual-result.md`). Everything that is going to change
lands first, the baseline is taken of that tree, and the arm moves one thing.

The re-baseline therefore does double duty: it is the arm's baseline, and it is this change's
measurement.
