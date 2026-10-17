# Placement — all three refuted. It is not where the block sits.

**Six arms plus three discarded, 2026-09-07T16:12:06Z–17:08:03Z, one card hold (3,357 s),
`granite42-hermes`, the real `sequence` repo, three turns an arm, cycled tail/before-question/last,
tree at `f8fb8b6e`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered kill, and the outcome

> **A placement is refuted if turn 2 names none of `eval/grade.ts`,
> `functions/repoFunctionGraph.ts`, `harness/designDrawBaseline.ts` in both of its runs.**

| placement | run | verdict | of the three | of the five | turn-2 tools | attributed |
|---|---|---|---|---|---|---|
| `tail` (control) | 16:12:06 | NULL | **0** | 0 | none | 0 |
| `tail` (control) | 16:52:55 | INCONCLUSIVE | **0** | 1 | none | 0 |
| `before-question` | 16:15:55 | INCONCLUSIVE | **0** | 1 | `read_topology` | 0 |
| `before-question` | 16:57:01 | NULL | **0** | 0 | none | 0 |
| `last` | 16:39:02 | INCONCLUSIVE | **0** | 2 | `read_topology`+`propose_topology` | 0 |
| `last` | 17:00:13 | INCONCLUSIVE | **0** | 3 | `read_file` | 0 |

**All three placements are REFUTED. Across six arms and eighteen turns, the three discriminating
names were never spoken once.**

## CORRECTION, 2026-09-07 — two of the three placements rest on ONE informative arm, not two

**Found after publishing, by asking a question the arms never asked themselves: did turn 1 actually
produce a referent list?**

Turn 1's tools are the MODEL's choice. On three of the twelve arms run in this stage it answered with
`search_files` alone and never called `who_calls` — so **no referent list was ever produced**, the
carry had nothing to carry, and turn 2 was graded as though it had declined a list that did not
exist. A later probe arm said so in plain words: *"I don't have a list of dependants from earlier in
this conversation."*

| placement | arms whose turn 1 produced a list | the refutation now rests on |
|---|---|---|
| `tail` (control) | **1 of 2** — 16:12:06 is VOID | one informative arm |
| `before-question` | **1 of 2** — 16:57:01 is VOID | one informative arm |
| `last` | 2 of 2 | two informative arms, unchanged |

**What survives unchanged.** `last` is refuted on two informative arms. Every informative arm across
the whole stage — nine of them — named **zero of the three**. No arm anywhere has ever named one.

**What is weaker than this page first said.** `tail` and `before-question` were reported as refuted
on two runs each; each has one informative run. Their registered kill said *"names none in both
runs"*, and for those two placements only one run could have named anything. **They are not
un-refuted — they are refuted on half the evidence claimed**, and this page said two.

**Why it is a correction and not a retraction.** The direction does not change and the conclusion
does not either: nine informative arms, zero mentions of the three, across three placements and two
studies. But "refuted on two runs" and "refuted on one run and one void" are different claims, and
the first was published.

**The instrument now refuses to hide it.** An arm records `listProduced` and prints
`VOID — turn 1 never called who_calls` when it is false. It was added the moment this was found, not
after the next run, and a void arm now exits **6** so a batch replaces it rather than averaging it in.

**GAP CLOSED, 2026-09-07T18:05Z.** `tail` and `before-question` each got their second informative
arm — `tail` needing three attempts, two of which were void and were caught automatically by the new
exit code. Both read **0 of the three**, so both placements are now refuted on the two informative
arms their kill required. See `carry-pointed-probe-result.md` for the full twelve-arm aggregate.

## This is the outcome the registration called most informative, and it needs no discount

The registration named the multiple-comparison problem before the data: two placements tested means
two chances for one to clear, and a clearing placement would have been **provisional** until a fresh
pair reproduced it.

**Nothing cleared, so the discount does not apply.** The registered reading of this outcome, written
in advance:

> *neither clears → the refutation is about the block or the idea, not the position.*

That is what the record now says. **Position was the cheapest cut and it came back negative**, which
removes a hypothesis for forty-five minutes of card rather than leaving it plausible indefinitely.

## What the arms did instead, and why it is not a partial result

Four of six arms read INCONCLUSIVE — turn 2 named one to three of the **five** carried callers that
turn 1's own answer had already spoken aloud. **Registered in advance as not a pass**, and it is not
reported as one: prior chat prose is carried independently of any carry slot, so those names have two
possible sources and no arm can say which.

**The control did it too.** `tail` at 16:52:55 read INCONCLUSIVE with no tool call at all — the same
behaviour as the treatments. Whatever produces those mentions is not the placement, and it was
already happening in the shipped configuration.

**Attribution was zero on every arm.** Not once did a turn name something only the carry could have
supplied.

## Three arms were discarded, and the reason was my own error

While the batch was running I launched a diagnostic arm to investigate a batch arm that had produced
no output. That put **two model streams on one card at once** — the contention the lock exists to
prevent, arrived from inside the lane holding the lock rather than from outside it.

Three arms were touched: the diagnostic (16:30:59), the arm that started while it ran (16:32:05), and
the arm whose tail it overlapped by about thirty seconds (16:26:30). **All three were discarded to
`tools/bench/out/discarded/` rather than assessed.** Deciding after the fact how much thirty seconds
of overlap mattered is a judgement that gets made in the flattering direction, and the replacements
cost twenty minutes.

**The lock is not sufficient for this.** It answers "may this lane use the card", and the failure was
"is this lane already using it". A second question, and nothing asks it.

## One arm was lost silently, which is the night's pattern again

Cycle 1's `last` arm produced **no verdict, no file, and no `REFUSED` line**, and the loop moved to
the next arm. Run standalone afterwards it worked, so it is not a code fault — but a batch that loses
an arm without saying so is the same shape as the bench that overwrote three.

**The runner is not fixed here** — it is named as the next instrument change, and the fix is the one
that worked for the bench: the loop must assert the arm file exists after each arm and stop when it
does not.

## What this does not claim

- **Not that placement never matters.** Two positions, one model, one conversation shape, two runs
  each. It says these two positions did not move this outcome.
- **Not that neither placement isolates its property** — the registration already said they do not.
  `last` also moves the block past the belt; `before-question` also moves it away from it. With both
  refuted that ambiguity no longer matters.
- **Not that the block is unread.** Four arms named carried material with no attribution possible;
  that is consistent with the block being read and with it being ignored, and this design cannot
  separate them.

## What it licenses

**`SEQUENCE_ASK_CARRY_REFERENTS` and `SEQUENCE_ASK_CARRY_PLACE` stay off.** Two registered
measurements have now failed to find a use for the carried list: mechanism B on its presence, this on
its position.

**The remaining live hypotheses are the block's own wording and the idea itself** — and of those, the
wording is the cheaper test and the one this stage has never varied. The block currently says *"a
follow-up saying 'those' or 'which one' means these"*. Whether an instruction to USE the list, rather
than a description of what it is, changes anything is untested.

**That test needs its own registration, and it should say in advance what a wording that works would
mean** — because a prompt-shaped fix to a prompt-shaped problem is the most over-readable result
available here.
