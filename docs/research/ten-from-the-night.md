# Ten things this night established, and what each one is worth doing about

**Written 2026-09-05 by the lane that ran them.** Ordered by what I would do next, not by when it
happened. Every number here is measured and every claim names where it can be checked.

---

## 1. Every check-in number in this repository measured the wrong thing

`endsWithQuestion` is a trailing question mark. Of 31 questions across 47 turns, **15 are CLARIFYING
offers** — *"would you like me to show…"* — the one shape the teach contract bans outright, and all
15 satisfied the metric. Re-graded honestly, four runs read **2, 6, 1 and 1 of 47** against the
**12, 18, 19 and 19** originally reported.

**Do:** nothing more; `gradeCheckIn` ships and every figure is banded. **Watch:** the product grader
still bounces on the old rule, so the app enforces "ends with a question", not "ends with a check".
That is a real behaviour change and belongs to a measured decision.

## 2. A single 20-conversation run cannot discriminate a belt change

Two runs of the **identical** configuration at temperature 0 differed by **13 points of check-in**
(12/47 vs 18/47) and 4 stubs. Every comparison drawn from single runs — the TURN SHAPE header,
lesson state, the three concept sources, and the "every slot makes it worse" pattern read off them —
is inside that noise.

**Do:** the rule is in `tools/bench/README.md` and binds. **Unmeasured:** whether Ollama's `/v1`
honours `seed`. Nobody has checked, and it would cut the noise floor at a stroke.

## 3. Belt length is not the mechanism

The ablation cut the belt tenfold — 6,853 characters to 654 — and refuted its own prediction: check-in
19 and 19 against a long-belt range of [2, 6] *on the honest metric*, stubs **worse** at 25 and 26,
and chart calls **4 and 12 → 0 and 0**. The short belt keeps a visual bullet and lost the visual
entirely.

**Do:** the mid-length arm is registered and unrun — chart instruction kept, the rest dropped.
**Worth more:** whatever makes a model reach for `propose_chart` lives in the bullets that were cut,
not in the one that survived, and no arm has isolated it.

## 4. Two-thirds of teach mode's questions do not need the lesson

First scored skipper run: **8 of 31 good**, 12 menu, 8 unanswered, 3 too-easy. And the first version
of that number — 10 of 31 — was wrong because the graph-only condition was handed an **empty
string**; giving the skipper an actual graph moved it to 8 and made `too-easy` exist at all.

**Do:** the P condition is still unimplemented, so `pulseCheck` is `null` rather than 0. **Do next:**
k>1, because at k=1 the 0.2 threshold does no work and the verdict is "did W beat G once".

## 5. The visual failure has two different causes and they have been discussed as one

In the **bench**, 95.7% of zero-visual turns never called `propose_chart` — the model does not reach
for the tool. In Practical ML's **CLI walk**, the model reached for the board twice and was refused
both times, because it called `propose_topology`, which is genuinely a write.

**Do:** the redirect ships (`722dc48d`). **Registered:** `redirect-visual-prediction.md` — I expect
it to move the CLI and **not** the bench, because the bench never took that path.

## 6. Lesson state was read by the belt and written by nobody

`TeachTurnContext.concept` existed, the contract demanded one concept per turn, and the pipeline
supplied none. 10 of 17 fragment turns were "continue to the next point".

**But the fix did not fix the fragments**: queues fill (12 of 20 openings, 18 of 27 follow-ups) and
**13 of the 30 turns handed a concept still became stubs**. The empty slot was not the cause.

**Do:** `/ask` has **no chat-session identity** — `sessionId` is the auth user id — so the server
cannot key a lesson. That is the blocker for lesson state reaching the product, and it needs a
session id on the ask request.

## 7. The model copies the contract's examples verbatim, and terseness makes it worse

`Check-in:` appears as visible prose in 5 of 31 questions, and the placeholder `X` from
`askPipeline.ts`'s illustration was emitted literally. Parroting tracked **terseness**: 0 and 0 under
the long belt, 4 and 5 under the short one.

**Do:** the parroting fix rode on the reverted belt change and is **not in the tree**. It should
return on its own, with the example rewritten so copying it whole is harmless.

## 8. Four of my own instruments produced confident zeros

`Object.keys` on a `Map`; `extractFacts(..., 'python')` throwing inside a swallowing `catch`;
`kwargs` never read; the skipper's empty graph. A fifth was the research lane reproducing the Map bug
independently.

**Do:** every probe now prints `parse failures: 0` beside its counts. **The rule earned:** an
instrument reporting an absence must first report what it failed to look at.

## 9. The env extractor sees 51 of 51 real reads, and the card must not use that as a licence

`28 of 56 → 51 of 56`, and the five remaining are grep counting my own comments. But on a repository
with no manifest the accusation count went **4 → 18 purely because the extractor improved**, which is
why the card now refuses to print a count where nothing declares anything.

**Do:** nothing outstanding. **Note:** recall and signal moved in opposite directions here, and the
card only got safer because the second-law check was applied to its own left-hand column.

## 10. The same bug shipped twice because the fix was documented in one place

`process.exit()` after a scan trips a libuv assertion on Windows. The `explain` branch carried a note
quoting the exact assertion and the exact symptom; `ask`, `harness` and `diagram export` all still
had it, thirty lines below. A user saw a correct answer and then a C assertion.

**Do:** the source-scan test now forbids the shape anywhere in the dispatcher. **The general lesson:**
a note at the site of one fix does not protect the next command down, and the test is what does.

---

## What I would do next, in order

1. **The mid-length belt arm** (registered, unrun) — the last belt-side explanation standing.
2. **A session id on `/ask`** — the blocker for lesson state reaching a real user.
3. **The parroting fix, standalone** — it was measured, it worked, and it was lost to a revert.
4. **The skipper at k≥3** — the current verdict is one coin flip per question.
5. **The product check-in grader** — decide whether the app should bounce a clarifying close.

Everything above is either shipped, registered with a prediction, or named as unmeasured. Nothing
here is a plan that has not been costed.
