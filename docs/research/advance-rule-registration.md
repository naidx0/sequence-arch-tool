# The advance rule — registered before the run

**Written 2026-09-06 after building it, before any arm runs.**

## What changed and why

A turn that wrote a lesson and drew its chart **has taught**, and the queue advances on that, whether
or not it managed to ask a check-in. Previously the advance required both, and the coupling stalled
the syllabus.

Measured on the ceiling arms, over the turns past a lesson's scripted replies:

| | first turns | padded turns |
|---|---|---|
| concepts given | 18 of 26 | **18 of 26** |
| charts drawn | 18 of 26 | **18 of 26** |
| **concept repeats the previous turn's** | 7, 8 | **18, 17** |
| queue length | mostly 6 | **mostly 6** |
| ends with a check-in | 2, 3 | **0, 0** |

No check-in meant no advance, so the same concept was re-taught and the same picture redrawn while
every surface reported concepts given and charts drawn. **The check-in stays a separate feature; its
absence is a defect in the turn and not a reason to freeze the lesson behind it.**

Built with the predicate in one place — `lessonState.taughtThisTurn` — called by both
`teachTurn.finish` and the bench, because those two had already drifted once.

## The kill number

**Fewer than 3 repeated concepts in the padded arm, against today's 17.**

A repeat is a turn whose `conceptGiven` equals the previous turn's in the same conversation. Three
allows for a genuinely bounced turn or two; anything at or above it means the stall survives the
ruling and the coupling was not the cause.

## The bands, before the run

Two runs, `TEACH_EVAL_REPO=sequence`, `SEQUENCE_TEACH_CHECKIN_FORM=next-picture`,
`TEACH_EVAL_MIN_TURNS=4`, on a build carrying the ruling. **The control is `ceiling-1` and
`ceiling-2`** — same flag, same length, same model, without it.

1. **Repeats collapse.** Registered: **fewer than 3 per arm**, against 18 and 17. *Refuted at 3 or
   above in either run.*
2. **The queue actually moves.** Registered: **the median queue length at the last turn is below 6**,
   against 6 today. A queue that never shortens is the stall by another name. *Refuted if it is still
   6 in both runs.*
3. **Distinct concepts taught rises.** Registered: **at least 3 distinct concepts per conversation on
   average**, against roughly 1 today. This is the one that says a learner saw more of their
   repository rather than the same file four times.
4. **The check-in rate does not fall.** Registered: within the control's own range on matched turns
   — **the first two turns of each conversation**, not all of them, per the fifth law
   (`docs/how-to-verify.md`): a clause comparing rates across arms of different lengths measures
   composition. Both arms here are four turns, so the denominators match, but the clause is stated on
   matched positions anyway because that is the form that survives the next change of length.
5. **Silent turns fall.** The reason-per-turn build lands with this, so: **fewer than 5% of teach
   turns carry no reason and no question**, against 27 of 52 today. *Refuted above 5%* — the
   recording would still be sampling rather than covering.

## What this cannot show

- **Not that advancing teaches better.** It measures whether the syllabus moves, not whether a
  learner is better off seeing four concepts than one four times. That is a seat question and it has
  not been asked. A stuck learner might be better served by the repeat.
- **Not that the check-in matters less.** It is decoupled from the advance, not deprioritised. Its
  own rate is clause 4 precisely so this change cannot quietly cost it.
- **Not a reading of the comprehension band.** The next-picture band is still unread and nothing here
  scores it.

## Card cost

Two runs of thirteen conversations at four turns. The ceiling arms took 86 minutes for the pair:
**call it 80 to 95 minutes.** Not to be started inside another lane's lock, and the report ends with
the release time so the next lane can be woken on it.
