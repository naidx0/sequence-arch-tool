# A teach turn does not think out loud — registered before the run

**Written 2026-09-05, change built and gated, before the first call.**

## Why this is not a default chosen on one measurement

The bench sets `reasoningEffort: 'none'`. The product set nothing. That is the same assembly-drift
that made `teachContext` diverge this morning: **the bench and the product must run the same
configuration or the bench measures nothing about the product.** This change makes the product's
teach path match the configuration every belt number on record was produced under.

Scoped to the teach turn, and only when the caller has not set a value — an explicit
`reasoningEffort` in config still wins.

## The baseline, from the seat check

Same lesson, same repository (this one, 1,056 nodes), through `/api/ask/stream` with `teach: true`:

- **337 seconds**, 4 rounds, 2 `read_topology` calls, 79,513 input tokens
- ended on the wall-clock deadline: *"I stopped because this turn hit its time budget…"*
- **no lesson, no chart**

And the per-call cost that explains it: 2.8s / 299 completion tokens thinking, against 0.7s / 75
with reasoning off, for answers of the same length.

## The prediction

**The same question on the same repository finishes inside the budget and produces at least one
derived chart.**

- `stopReason` is not `deadline`
- at least one `chart:proposal` event
- the answer is a lesson, not the deadline sentence

**Refuted if** the turn still ends on `deadline`, or ends inside the budget with no chart. The first
would mean the 4× was not what was costing the turn and the real-repo prompt is simply too large for
this model; the second would mean the concept the queue produced for this question carries no
usable node, which is item 3 and would be worth knowing before item 3 starts.

One run, because this is a pass/fail on a single observable and not a metric with a range around it.

## READ — refuted, and it uncovered a larger gap

| | before (thinking) | after (reasoning off) |
|---|---|---|
| wall | 337s | **313s** |
| rounds | 4 | 2 |
| input tokens | 79,513 | **46,033** |
| stopReason | deadline | **deadline** |
| charts | 0 | **0** |

**Refuted.** The turn still ends on the deadline with no chart. The change did what it should —
input tokens fell 42%, rounds halved — and it was not what was costing the turn.

My registered reading of this outcome was *"the real-repo prompt is simply too large for this
model"*. **That is also wrong**, and the run that shows it is the 5-node fixture:

> makemore, 3 files, **14,077 input tokens**, reasoning off: **288 seconds, deadline, no chart.**

Fourteen thousand tokens is not a large prompt. And the bench teaches that same repository with that
same model in **17–18 seconds a turn**.

## The open question, stated precisely because it is now the main one

**Same repo, same model, same tool schemas: the bench is ~17× faster than the product.** Both send
native tool definitions (`openaiAskToolDefinitions`), both now set `reasoningEffort: 'none'`, and
the product's prompt is larger but nowhere near 17× larger.

Ruled out so far: thinking (measured, 4× per call, now off), prompt size (14k is small and still
288s), native tool schemas (both send them), and model residency (`ollama ps` shows it loaded
throughout).

**The next probe is one measurement, not a theory:** time a single `generateTextWithUsage` call on
one identical prompt through the bench's config and through the ask handler's, and compare. If they
differ, the difference is in the provider call the two paths build; if they do not, it is in how
many calls the product makes per turn.

Until that lands, teach mode does not finish a turn in the app on any repository, and the derived
chart has still never been seen on a screen.

## What stays

The change stays. It is justified by the assembly-drift law independently of this prediction — the
bench and the product must run the same configuration — and it measurably reduced both rounds and
tokens. It simply did not buy the turn.
