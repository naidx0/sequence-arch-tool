# Why is the product ~17× slower than the bench? — registered before the measurement

**Written 2026-09-05 before reading the Ollama log or timing either path.**

## The gap

Same repository (makemore, 3 files), same model, same native tool schemas, both now with
`reasoningEffort: 'none'`:

- **bench: 17–18 seconds a turn**
- **product: 288 seconds, 14,077 input tokens, deadline, no chart**

Ruled out by measurement already: thinking (4× per call, off), prompt size (14k), tool schemas
(both send them), model residency (loaded throughout).

## What I expect, and why

**I expect the single call to be slower on the product path, not equal.** The arithmetic forces it:
the product turn ran **2 rounds in 313 seconds** on this repository — about 156 seconds per call —
where the bench's whole 3-turn conversation is 17–18 seconds. A multiplication of equal calls cannot
produce that; there are not 25 calls hiding in a 2-round turn.

**So I expect the difference to be in the request the two paths build, not in how many they make.**
The most likely single cause, in order:

1. **The stream flag.** The ask handler streams deltas to an SSE client; the bench calls
   `generateTextWithUsage` and waits. If streaming makes this runner re-evaluate the prompt, or
   disables a fast path, that is a per-call cost paid on the product path only.
2. **A different options set causing a second runner** — `num_ctx` above all. A 65,536 context is
   what `ollama ps` reports; if only one path asks for it, the other gets a different runner and one
   of them pays a load, or pays prompt evaluation with layers off the GPU.
3. **Call count**, which I rank last for the reason above but which the numbers must still be
   checked against.

## What would refute me

- **The single call is the same speed on both paths** → the 17× is a multiplication after all, my
  arithmetic above is wrong, and the next thing to count is calls per turn and the size of each.
- **The call is slower and the options are identical** → the difference is not in what is sent, and
  the remaining suspects are the streaming path itself and anything the product does between calls.

## The numbers to report, per path

`prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration`, plus the options each
path sent (`num_ctx`, `num_predict`, `keep_alive`, the tool list, `stream`), and whether a model
load appears in the server log between them.

## READ — my prediction is CONFIRMED, and every cause I ranked is refuted

**The single call IS slower on the product path**, decisively. From the turn's own
`providerCallMs`:

| | calls | each | prompt |
|---|---|---|---|
| product, teach, makemore | 3 | **150.3s, 134.8s, 3.6s** | **4,821 tokens** (`contextBreakdown`) |
| product, NON-teach, same app | 1 | **9.7s** | 2,766 tokens |
| direct call, same model, same tools | 1 | **1.2–10.4s** | **16,084 tokens** |

So the product spends 150 seconds on a **4,821-token** prompt while a direct call to the same
server handles **16,084 tokens in 1.2 seconds**. It is not a multiplication: the calls are few and
each is enormous.

**And the ranked causes are all wrong.** Measured, one at a time, on identical prompts:

| suspect | result |
|---|---|
| hidden reasoning | 5.7s vs 1.2s — real, 5×, already off, not 100× |
| `temperature: 0` (bench sets it, product does not) | 1.2s either way — **not the cause** |
| prompt size | product's prompt is 4,821 tokens; direct at 16,084 is 1.2s |
| the teach-narrowed tool set | 3.2s and 3.9s against full's 3.7s and 1.8s — **not the cause** |
| streaming (my ranked #1) | the ask path passes `undefined` for `onDelta` and does **not** stream |
| model reload / residency | one entry in `ollama ps` throughout |

## Where it is, and the next probe

The gap is **inside the product's provider call**, between `generateTextWithUsage` — which is fast
when called directly with the same config, prompt and tools — and what the ask handler wraps around
it. A non-teach app turn is also slower than a direct call (9.7s for 25 output tokens at 2,766
tokens of prompt), so the overhead is not teach-specific; teach only makes it visible by needing
three calls instead of one.

**The next probe is one instrumented number, not another theory:** time the HTTP round trip inside
`callProviderMeteredWithUsage` and compare it with the total that `providerCallMs` records. If the
round trip is fast and the total is slow, the cost is in the metering wrapper (`usageStore` read and
write per call, `decide`), and it is ours. If the round trip is itself slow, the same request is
slow through the app and fast through a script, and the difference is in the request the app builds
— which can then be dumped and diffed byte for byte.

**The Ollama server log was not available for this**: `AppData/Local/Ollama/server.log` stops at
13:35 while these runs were at 16:10–17:40, so a second server instance is handling them and its
log is elsewhere. `prompt_eval_duration` / `eval_duration` per request would answer the question
immediately and should be recovered before the next attempt.

## The log was live and I misread it — registered before reading it

The `server.log` timestamps are LOCAL and my run times were UTC. Local 13:40 IS UTC 17:40; there is
one ollama process and the log never stopped. **My "a second instance is serving" was a
timezone error, the same class of mistake as the two lock files this morning** — and I made it while
holding the note that says to watch for it.

**Registered before opening the log: I expect the round trip to be SLOW** — that is, Ollama's own
per-request wall time will be close to the 150s, so the time is spent inside the model server and
NOT in our metering wrapper.

The reason is arithmetic rather than preference. The turn produced **719 visible output tokens
across three calls in 289 seconds**. A wrapper overhead would sit between fast requests; 150s inside
one request with few visible tokens means the model generated a great deal that never reached the
answer — hidden reasoning that the `reasoningEffort` change did not actually reach, or an unbounded
generation, or a retry loop inside the provider.

**Refuted if the GIN wall times are short** (a few seconds each). Then the cost is ours, between
`generateTextWithUsage` and `callProviderMeteredWithUsage`, and the wrapper gets read line by line.

## READ — confirmed, and the cause is my own incomplete change

**The round trip is slow.** Ollama's own GIN wall times for seat6's calls are **2m30s and 2m14s** —
the 150.3s and 134.8s `providerCallMs` recorded, inside the model server. The wrapper is exonerated;
my direct calls to the same server minutes later are 0.9–10.4s.

**And the log says exactly what it was doing:**

```
total time = 149.892s / 13,061 tokens
total time = 134.567s / 8,388 tokens
total time = 262.311s / 14,731 tokens
cmn common_reaso: activated, budget=2147483647 tokens
```

**Eight to fourteen thousand generated tokens per call**, against 719 that reached the answer, with
an unbounded reasoning budget. The turns were thinking, at length, invisibly.

### Why, and it is not the model

`/api/ask` and `/api/ask/stream` are **two handlers** with two `callProvider` closures. My
`reasoningEffort: 'none'` change went into the first. **Every seat test drives the second.** So the
run recorded as *"reasoning-off refuted"* was measured on a path where reasoning was never off, and
that refutation is void — not because the prediction was right, but because the experiment did not
contain the change it was testing.

This is the `teachContext` drift again in a different costume: one rule, two places, one of them
quietly different. The assembly could not be unified — they are genuinely two handlers — so the gate
is a source scan asserting **both** ask routes narrow reasoning for a teach turn, sliced per route
so a neighbouring handler's copy cannot satisfy it.

### What is now unknown again

Whether reasoning-off saves the turn. The earlier answer was measured on the wrong path. It needs
one run on `/api/ask/stream` with the fix in, against **288s, deadline, no chart** on makemore.

## The deciding run — registered before it

One run on `/api/ask/stream`, 5-node makemore fixture, with the narrowing now on that route.
Against **288s, deadline, no chart, 8,000–14,700 generated tokens per call.**

**Predicted:** the turn finishes inside the budget with at least one derived chart, and per-call
generated tokens fall from thousands to hundreds.

**Refuted if** it still ends on `deadline` *with the Ollama log showing reasoning off* — then the
cost is somewhere none of the refutations have looked, and the next probe is the request body dumped
from the stream route and diffed byte for byte against the direct call's.

The log line for each call is reported beside my own timing, so the two clocks can be checked
against each other rather than trusted.

## READ — half confirmed, and the other half is a structural finding

**One run, `/api/ask/stream`, makemore, the narrowing now on that route:**

| | before | after |
|---|---|---|
| wall | 288s | **27s** |
| stopReason | deadline | **complete** |
| provider calls | 3 (150.3s, 134.8s, 3.6s) | **6 (9.99, 0.90, 0.96, 3.08, 3.81, 7.37s)** |
| reasoning activations in the Ollama log | present, `budget=2147483647` | **0** |
| charts | 0 | **0** |

Ollama's own GIN lines for the six calls: `9.984297s, 895.8121ms, 958.0268ms, 3.0826726s,
3.8126744s, 7.373347s` — matching `providerCallMs` to the millisecond, so the two clocks agree
rather than being trusted.

**Reasoning was the cost.** 288 seconds to 27, deadline to complete, and the void verdict on
`7cc05148` is settled: that prediction was right and had simply never been executed.

**The chart half is refuted, and not for a tuning reason.**

## `/api/ask/stream` has no lesson state at all

The lesson lives entirely in `/api/ask`: `resolveAskThreadId`, `readLesson`, `newLesson`,
`writeLesson` and the `buildTeachContext` call are all inside that handler. Inside the stream
handler — lines 4490 to 6842 — the count of those symbols is **zero**, and the only teach context it
sends is `{ known: teachKnown }`. No concept. No taught list. No `lessonDone`.

**And `/api/ask/stream` is the route the web client uses** (`askClient.ts`: `ASK_STREAM_ROUTE`).

So: no `lesson.json` is ever written for a real user turn, no concept reaches the belt, and
`buildConceptChart` — which returns nothing without a concept — can never fire. Confirmed by a
second turn on the same thread: still no lesson on disk, still no chart, `stopReason: ceiling`.

**Every lesson-state result on record describes a path users do not take.** The queue, the concept
per turn, the finished-lesson slot, the derived visual at 14/21 and 20/26 — all measured through the
bench, which calls `runAskPipeline` directly, and all reaching the product only through the
non-streaming route nothing drives.

This is the third instance today of one rule living in two places with one of them different —
`teachContext`, then `reasoningEffort`, now the whole lesson. The first two were fixed by unifying
the assembly and by a per-route gate. This one is larger: the stream route needs the lesson wiring
the non-stream route has, and the gate afterwards should assert both routes read and write a lesson,
not just that both narrow reasoning.
