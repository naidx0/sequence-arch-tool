# Moving the reveal ceiling — registered before any run

**Written 2026-09-06 after the re-run, before anything is built or run.**

## The ceiling, measured

The next-picture band was killed at **3 reveals of 11 questions**, and the reason is structural:
**7 of the 11 questions were asked on the final turn of their conversation.** Only 4 could land, and
3 of those 4 revealed — the carrier works at 75%, and there is almost nothing for it to carry.

| | measured |
|---|---|
| questions asked, two runs | 11 |
| **questions with a following turn** | **4** |
| reveals | 3 |
| reveal rate on landable questions | 75% |

The registration before that run named the question rate as a ceiling the carrier could not move. The
real ceiling is lower: **two landable questions a run.**

## The two conditions, and why they are separate

Only one thing has to change for a question to land: **the turn that asks must not be the last one.**
There are two independent ways to arrange that, and they must not be run together, because a
combined arm cannot say which of them did it.

### Condition A — a longer conversation

The bank's `sequence` conversations are two and three turns. A third or fourth turn gives a question
asked at turn 1 or 2 somewhere to land.

**Changed:** the conversation script only. No product code, no check-in logic. `TEACH_EVAL_TURNS=4`
or a per-conversation turn list.

### Condition B — an earlier check-in

The check-in currently arrives when the model has produced prose and a chart, which tends to be the
end of what it has to say. Asking on the first substantive turn of a lesson, rather than whenever the
conditions happen to line up, puts the question ahead of at least one more turn.

**Changed:** the derivation's trigger, which is product code, and therefore the one that needs a
second look at the teach contract before it is touched.

**A runs first.** It changes no product code, and if a longer conversation alone clears the kill
number then B is a change nobody needs to make.

## The bands, before any run

Two runs a side, `TEACH_EVAL_REPO=sequence`, `SEQUENCE_TEACH_CHECKIN_FORM=next-picture`, on a build
carrying `69a3498f`. The control is `nextpic-3` and `nextpic-4`, already on disk: 11 questions, 4
landable, 3 reveals.

**Primary claim — landable questions, not reveals.** Reveals are a product of two things and only one
of them is under test here. A run that asks fewer questions but lands more of them has moved the
ceiling; a run that asks more and lands the same proportion has not.

1. **Landable questions rise.** Registered: **at least 8 of the questions asked have a following
   turn, across two runs**, against 4 in the control. *Refuted below 6* — that would be inside the
   spread two runs can produce, and calling it a rise would be reading noise.
2. **The reveal rate on landable questions holds.** Registered: **at least 60%**, against the
   control's 75% on n=4. *Refuted below 50%* — if a longer conversation makes the reveal itself less
   reliable, the extra questions are not worth having and the finding is about the carrier, not the
   ceiling.
3. **The kill number from the original registration is inherited unchanged: at least 5 reveals
   across the two runs**, with one to four still a kill rather than a pass. Clearing 1 and 2 without
   clearing this means the ceiling moved and the band is still unreadable, which is a real result and
   must be reported as one rather than as a near-miss.
4. **The teach contract does not move.** Registered: the check-in rate, the chart rate and the stub
   rate stay within the control's own range. *A change here refutes the condition regardless of the
   reveal count* — a longer conversation that degrades the turns is not a way to measure the band,
   and this is the clause the original next-picture registration used for the same purpose.

## What this cannot show, recorded now

- **Not whether the pictures teach.** That is what the band was for, and the band stays unread until
  it has a denominator. Clearing the kill number makes the band *readable*, not answered.
- **Not that four turns is the right lesson length.** It is a lever for a measurement. Whether a
  learner wants a four-turn lesson is a seat question and nobody has asked it.
- **Not B's effect.** A alone cannot say anything about the trigger; if A clears the kill, B is
  untested and unneeded, and if A fails, B is registered separately before it runs.

## Card cost, stated before it is spent

Two runs of thirteen conversations at four turns rather than two or three: the two-turn arms took
~21 minutes each, so **call it 28 to 35 minutes a run, 56 to 70 for the pair.** More than the arms it
replaces, because the extra turn is the point.

**Not to be run until the fifth bucket has its `checkInSkipped` reason.** Nine turns per pair of arms
currently produce no question for a reason nothing records, and a condition aimed at making questions
land is measured against a denominator that has an unexplained hole in it. That fix costs no card and
belongs first.
