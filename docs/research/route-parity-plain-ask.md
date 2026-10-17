# The plain ask on both routes: no drift — and what that number is worth

**Run 2026-09-05T23:20Z at `b14dbdbe`, card-free.** The assembly-drift law applied to the plain ask,
which — unlike the teach turn — has never had a per-route gate.

## Why it went over HTTP

The law's corollary: *a bench that calls the pipeline directly measures the pipeline, not the
product.* Both routes call the same `runAskPipeline`; the question is what they **hand** it. Driving
the pipeline twice would have compared two calls this bench wrote and found nothing, confidently.

That is not hypothetical. Earlier today a `reasoningEffort` change landed on `/api/ask` only while
every seat test drives `/api/ask/stream`, and the result measured against it was void. The teach turn
got one shared assembly and a per-route source scan out of that; the plain ask got neither.

So: a stub provider that records every request body and returns a canned completion, an app instance
on its own port with its own `SEQUENCE_USER_DIR` — the user's `~/.sequence` is neither read nor
written and no other session's app is touched — and the twenty plain asks from `plainAsks.mjs` put
through **both** routes.

## The numbers

| | bare config | with params |
|---|---|---|
| asks × routes | 20 × 2 = **40 turns** | 20 × 2 = **40 turns** |
| crashes / non-2xx | **0** | **0** |
| provider calls | 44 — **1.10 per turn** | 44 — **1.10 per turn** |
| turns making no call | 0 | 0 |
| **assembly drift** | **0 of 20** | **0 of 20** |
| fields compared | `messages, model, tool_choice, tools` | `messages, model, reasoning_effort, temperature, tool_choice, tools` |

Not compared: `stream` and `stream_options`, which are *expected* to differ by route. Flagging them
would have buried the finding this was looking for.

One ask, `pa-05` ("what is the default learning rate in train()?"), takes **three** provider calls
instead of one — a tool round-trip to read the file — and takes three on **both** routes. Consistent,
so not drift; recorded because a per-turn call count that varies by question is worth knowing before
a card run is priced.

## The zero is only worth what the detector can see, twice over

**First: it detects.** A comparison that always says "same" reports clean on a broken product, and
this repository has shipped a fake gate that mirrored both sides and could not fail. So the run ends
by asking **one** route **two different** questions and comparing those. The detector reports drift
(`messages`). If it ever stops doing so, the run prints that the zero is void.

**Second: the first pass could not have caught the bug it exists for.** With a bare config the only
fields on the wire are `messages`, `model`, `tools`, `tool_choice` — so "0 drift" said nothing about
`reasoning_effort`, which is exactly the field that landed on one route and not the other this
morning. A comparison is only as wide as the keys it walked.

Hence the second pass: `ai.json` carries `params: { temperature: 0, reasoningEffort: 'low' }` (both
real knobs — `parseAiParams` in `provider.ts`), which puts `temperature` and `reasoning_effort` on
the wire. **Still zero drift, now over six fields including the one that actually broke.**

## What this does and does not establish

It establishes that, for these twenty plain asks, the two routes hand the provider byte-identical
requests across every field either of them sends, under two configurations.

It does not establish that they behave identically **after** the provider answers — response
shaping, event emission, what reaches the store and what the seat sees are all downstream of the
comparison point, and the chart-persistence defects found earlier this week were all downstream.
Nor does it cover the teach turn, which has its own shared assembly and its own gate.

**Nothing was changed.** The number is the report.
