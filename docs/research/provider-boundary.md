# Where does the provider path stop at a dependency boundary? — registered before the run

**Registered 2026-09-05T23:10Z. Neither arm has been run.** The card is held by another lane
(`granite42-hermes` resident and refreshing, no `gpu.lock`), and this item sits behind the check-in
and sequence runs in the queue regardless. What follows is written to be checkable against numbers
that do not exist yet.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The question

Three things this product wanted this week and could not have:

1. It could not **see the model's hidden reasoning** — only infer it from latency.
2. It could not **apply `num_ctx`**, so the window in force was whatever the model file said.
3. It learned the **20.5× reasoning cost from the Ollama server log**, not from its own client.

All three are the same shape: a number that exists in the runtime and stops at the client boundary.
So: what does the path we use *give*, what does it *withhold*, and what would we get by owning the
layer instead of consuming somebody else's?

## Part 1 — what is already established, without the card

This half is a property of the code and of measurements already recorded, so it is settled now
rather than predicted. **It is an audit, not a run**, and is labelled as such.

**The product speaks Ollama's OpenAI-compatible wire** (`/v1/chat/completions`), sending
`messages: [{ role: 'user', content: prompt }]` — one user message, the whole prompt
(`provider.ts:1989`).

What crosses back is `ExtractedProviderUsage` (`llm/usageExtraction.ts:12`), whose entire surface is:

| field | present |
|---|---|
| `inputTokens` / `outputTokens` | yes — from `usage.prompt_tokens` / `completion_tokens` |
| `cachedInputTokens`, `cacheOutcome` | yes, when the provider reports them |
| `costUsd` | yes, when the provider reports it |
| **any timing at all** | **no** |

**There is no timing field in the product's usage type.** Every duration this repository has quoted
this week — the 402 s conversation, the 20.5×, the 2m13s turn — was a caller's wall clock or a line
in `server.log`. The client cannot say how much of a call was prompt evaluation and how much was
generation, so it cannot tell a slow prompt from a slow answer.

**The window in force today, from `/api/show` — which reads the manifest and loads nothing, so this
cost no card time.** The Modelfile pins `num_ctx 65536`; the architecture reports
`granite.context_length 131072`. **The product is running at half the window the model supports, and
cannot change it on the wire it speaks.** The same call reports `capabilities: ["tools","thinking",
"completion"]` — the runtime treats thinking as a first-class capability, which is the strongest
card-free evidence that `message.thinking` is really there to be read. It also shows the Modelfile
setting `temperature 1` and `top_p 0.95`, while the product sends `temperature 0`; whether the wire
value wins is one more thing the run can confirm rather than assume.

And three native options are **accepted and ignored** on this wire, each measured previously and
recorded in `provider.ts:205-210`: `think`, `num_ctx`, and `chat_template_kwargs`. Only
`reasoning_effort` took effect. That is the boundary, exactly: the OpenAI shim accepts the vendor's
own vocabulary and drops it silently, which is worse than rejecting it — a request that is ignored
looks identical to one that was honoured.

## Part 2 — the registered prediction

`/api/chat` on the same runtime returns, per the Ollama 0.33.2 API, `total_duration`,
`load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration` (all
nanoseconds), honours an `options` object including `num_ctx`, and returns `message.thinking`
separately from `message.content` when `think` is set.

**What I expect to gain, stated before measuring:**

| number | today | expected native | confidence |
|---|---|---|---|
| prompt evaluation time | absent | `prompt_eval_duration` | high — documented field |
| generation time | absent | `eval_duration` | high |
| model load time | absent | `load_duration`, ~0 when resident | high |
| prompt / generated token counts | present (OpenAI `usage`) | `prompt_eval_count` / `eval_count` | both — expect them to **agree**, and a disagreement is itself a finding |
| reasoning tokens | absent | `message.thinking` as text; a token count only if `eval_count` includes it | **low** — I expect the text, and I do NOT expect a separate reasoning token count |
| the window actually applied | absent | `num_ctx` echoed in the request, not in the response | **low** — I expect to be able to SET it and not to be TOLD it, which is a different and weaker win |

**Two predictions I expect to be wrong about, registered so they can be:**

1. **I expect the two arms' token counts to agree within 2%.** If they disagree materially, the
   OpenAI shim is re-templating the prompt and every token number this repository has recorded is
   about a different prompt than it thought.
2. **I expect wall-clock parity within 10%.** The native path should not be *faster*; it should be
   the same speed and merely more legible. If native is materially faster, the shim costs
   throughput as well as information, and that changes the build decision.

**What I expect NOT to gain:** the lock and the build stamp travelling with the request. There is no
field on either API for "which lane holds the GPU" or "which build asked". Ollama has no request
metadata channel that comes back in the response. My expectation is that both would have to be
carried *beside* the request — a lock file and a log line — exactly as they are today, and that an
in-house layer's contribution there is bookkeeping discipline rather than a new capability. I would
rather register that as an expected non-gain than let the item imply a win it cannot deliver.

## Part 3 — what an in-house provider layer would change in the bench

Concretely, and only the things the numbers above would enable:

- **The 20.5× would be attributable.** Today "reasoning on costs 20.5×" is a wall-clock ratio.
  With `prompt_eval_duration` and `eval_duration` split, the bench could say whether reasoning costs
  *generation* time (the model thinking) or *prompt* time (a longer templated prompt), and those
  imply different fixes.
- **`bench-vs-product-call-prediction.md` would not have needed a server log.** The ~17× gap between
  bench and product turns was diagnosed by reading `server.log`. A client that reports its own
  timings answers that from the report it already writes.
- **The belt-length arms would have had a denominator.** Every belt experiment varied prompt length
  and measured total turn time. Prompt-eval time is the channel a longer belt actually acts through;
  measuring the composite meant three arms could not separate "the belt is long" from "the answer is
  long".
- **`num_ctx` becomes an experimental variable.** Right now the 65,536-token window is a property of
  the model file, identical in every arm. It cannot be ablated, so no result in this repository is
  attributable to context size.
- **A stalled call becomes diagnosable.** `askTools.ts`'s 180 s deadline currently fires on total
  time. With load/prompt/generation split, a deadline could say *which* phase overran, and the
  harness's message to the user could stop being a guess.

None of that is a reason to build it. It is the list of things that would become answerable, so the
build decision after the numbers has something to weigh the cost against.

## Part 4 — the protocol, and one deliberate deviation

**One identical teach turn each way on `examples/makemore`**, same prompt bytes, temperature 0,
under the GPU lock, after the queued check-in and sequence runs.

**The deviation: `/api/chat`, not `/api/generate`.** The instruction named `/api/generate`. The
product sends a single user message and the OpenAI shim applies the model's chat template to it;
`/api/generate` takes a raw prompt and does not. Using it would change the bytes the model sees at
the same time as changing the wire, and the comparison would confound the two — the exact failure
that voided the reasoning-off result earlier this week, when a change landed on one route and the
measurement ran on another. `/api/chat` with one user message applies the same template, so the wire
is the only thing that differs. `/api/generate` is worth a third arm precisely to *measure* the
template difference, and it is not the control.

Both arms record: wall clock measured by the caller, every timing field the response carries, both
token counts, whether `num_ctx` was honoured, and whether any reasoning text came back separately.
The table is reported with the fields each side did not have marked absent rather than zero.

## Run status

**Not run.** Card held by another lane at 23:04Z and 23:10Z; this item is queued behind the check-in
runs, the sequence-condition runs and the registered plain-ask bench. The harness
(`tools/bench/provider-boundary.mjs`) is written and dry-run against a stub, so the run itself is
one command under the lock.

---

# The numbers

*(empty — neither arm has been run)*
