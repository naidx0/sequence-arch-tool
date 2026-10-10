# The seat check: the pictures still have not been looked at, and here is what stopped it

**Driven against the running app on 2026-09-05, lock held for the model turns and released.**
The task was to read a derived chart as a person sees it. **I did not get to a picture**, and the
reason is a product defect the bench cannot see, which is the point of the exercise.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## What a person gets today, in the app, asking to be taught

**On this repository (1,056 nodes): nothing.** The turn ran 337 seconds, made 4 rounds and 2
`read_topology` calls, spent 79,513 input tokens, and ended with:

> *"I stopped because this turn hit its time budget while I was still looking things up, so I have
> not written an answer rather than guess at one. I ran 2 tool calls (read_topology) before
> stopping."*

That is the wall-clock deadline from `634e0b0c` firing on the product path for the first time,
`stopReason: deadline`. **The bound works and it is honest** — the reader is told, in time, what
happened. But what it bounded is a turn that never taught anything, so from the seat teach mode on
the real repository does not currently teach.

**On a 5-node fixture: also nothing**, twice, at 380 seconds each.

## Why, measured rather than guessed

`granite42-hermes` thinks by default. The bench sets `reasoningEffort: 'none'`; **the product sets
nothing.** Same model, same prompt, measured just now:

| | latency | answer | reasoning | completion tokens |
|---|---|---|---|---|
| product default (thinking) | 2.8s | 327 chars | 1,201 chars | **299** |
| bench (`reasoning_effort: none`) | 0.7s | 385 chars | 0 | **75** |

**Four times the tokens and four times the latency, for an answer of the same length.** Multiply
that across four rounds of a real-repo turn and it is the difference between finishing and hitting
the budget.

A first, smaller measurement of mine showed the thinking call returning an EMPTY answer, and that
was an artifact of my own `max_tokens: 200` being consumed by the reasoning — corrected above before
it was reported anywhere. The 4× is the real finding; "returns nothing" was not.

**No code change is needed.** `parseAiParams` already accepts `reasoningEffort`, so a user or a
per-repo `.sequence/ai.json` can set it. What is missing is that nothing tells anyone to, and the
shipped default against a thinking model costs 4×. That is a recommendation, not a change I made:
altering model defaults for every user is not mine to take on my own measurement.

## What this does NOT establish

**Nobody has still looked at a derived chart.** The mechanism is proven on the bench — 54 charts,
every node and edge real, the no-node refusal clean — and completely unproven on a screen. The
specific things still unchecked are the ones asked for: how many nodes and edges a person sees,
whether each arrow's direction matches the scan, whether the sentence beside it refers to what is
drawn, and whether the chart arrives during the turn or after it.

Two further obstacles are recorded so the next attempt does not rediscover them:

- **The browser pane does not composite this app.** The page renders (29 KB in `#root`) but the
  viewport reports 0×0 until `resize_window` is called, and after that a click on the permission
  control did not open its menu — stale rects. Driving the UI by clicking is not currently viable;
  the HTTP path is.
- **Teach mode is reachable only through the permission control's menu** (Plan / Propose /
  Auto-edit / Full access / Teach), not a visible toggle, so a seat test has to go through that menu
  or send `teach: true` directly.

## The honest summary

The seat check found a defect worth more than the check: **on a real repository a teach turn does
not finish**, and the reason is a 4× cost the product pays on every call because it never tells a
thinking model to stop thinking. The deadline caught it and said so plainly instead of hanging,
which is the one thing that worked exactly as designed.
