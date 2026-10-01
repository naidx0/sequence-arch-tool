# The teach bench — and the rule that governs reading it

## READ THIS BEFORE COMPARING TWO RUNS

**One twenty-conversation run cannot discriminate a belt change.** Measured 2026-09-05, two runs
of the IDENTICAL configuration at temperature 0 — the second differed only in which fields the
report wrote, nothing reaching the prompt:

| identical config | run A | run B | spread |
|---|---|---|---|
| ends with check-in | 12/47 | 18/47 | **6 of 47 — 13 points** |
| stubs (<=35 words, no check-in) | 23 | 19 | 4 |
| substantive turns | 24 | 28 | 4 |
| paced | 45/47 | 47/47 | 2 |

Thirteen points of check-in, between two runs of the same belt.

**Every comparison drawn from single runs on 2026-09-05 is inside that noise and is not
evidence** — the belt TURN SHAPE header (check-in 22 → 14), lesson state (22 → 20), the three
concept sources (22 → 12, then 18), and the "every slot added to the belt makes the turn worse"
pattern read off them. The interventions may still be real; they are simply not shown by those
numbers, and the record now says so rather than carrying a story the data cannot hold.

The failure is the instrument's, and it was avoidable: the second run existed only because a
missing field forced it, not because anyone planned a replicate.

## AND THE CHECK-IN METRIC WAS MEASURING THE WRONG THING

`endsWithQuestion` is `/\?\s*$/` — a trailing question mark. Measured 2026-09-05, of 31 questions
across 47 turns, **15 were CLARIFYING** ("would you like me to show the diagram?"), the one shape
the teach contract bans outright, and every one of them satisfied it.

Re-graded on "ends with a comprehension question or a prediction", the four ablation runs read
**2, 6, 1 and 1 of 47** against the 12, 18, 19 and 19 originally reported. **Every check-in number
in this repository from before 2026-09-05 is the first quantity, not the second.**

`endsWithCheck` (from `packages/analyzer/src/server/checkIn.ts`) is now recorded beside it. Both
stay: the old one keeps earlier runs comparable, the new one is the honest claim. Its counts are
FLOORS — the shapes are phrase-matched, and an unrecognised question counts as not-a-check, which
biases the number down rather than flattering the contract.

## THE RULE

1. **Two runs minimum, per side, before any comparison is reported.** A single run may be reported
   as a measurement of itself ("this configuration produced N of 47") and never as a difference.
2. **A difference counts only when both runs of one side fall outside the observed range of both
   runs of the other**, on each metric claimed. Inside the range is "no evidence", written in
   those words.
3. **Denominators travel with every number** — turns, and substantive turns separately, because
   17 to 29 of 47 turns in any given run are stubs that never became lessons and a rate over all
   turns hides that.
4. **Errored conversations are excluded from averages and counted separately.** The scoreboard
   already does this; a report that says "20 clean, 0 errored" is making a claim, not decorating.

## Pinning what can be pinned

`temperature: 0` is already set and is NOT sufficient — the spread above was measured with it. If
the provider exposes a seed, pin it per conversation; Ollama's OpenAI-compatible endpoint accepts
`seed` on `/v1/chat/completions`, and whether it actually determines the sample on this build is a
measurement nobody here has made. Until someone makes it, assume it does not and replicate.

## Running it

```bash
SEQUENCE_AI_BASE_URL=http://127.0.0.1:11434/v1 \
SEQUENCE_AI_MODEL=granite42-hermes \
SEQUENCE_AI_API_KEY=ollama \
TEACH_EVAL_LIMIT=20 \
node tools/bench/teach-eval.mjs
```

`TEACH_EVAL_LIMIT` is a COUNT, and `0` means **no limit** — it runs all 54, which is not what
someone typing `0` for "none" expects. Take the GPU lock first
(a `gpu.lock` file the lanes agree on): a contended card took one conversation from 402 s to
2,615 s, and a CPU-saturated box killed another outright with `provider request failed`.

`reasoningEffort: 'none'` is set in the bench's params because granite42-hermes thinks by default
and the bench does not grade reasoning — worth about 20× wall clock. That is a BENCH setting; the
product default is unchanged (`docs/research/thinking-on-vs-off.md`).
