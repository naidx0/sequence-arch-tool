# Sending the workspace once instead of every turn — registered before the build

**Written 2026-09-06, before anything is built. On the ask path, which every tier uses.**

## What the build is, and which quantity it touches

*Stated first, per the sixth law: a kill number must be a quantity the change can move.*

**The build touches the repeated prefix — the architecture digest and the instruction belt — and
nothing else.** Measured: 5,330 tokens of the 5,373 in a first turn, rebuilt byte-identical on every
turn of a conversation. It does not touch the carry, the question, the tool results, or what the
model does with any of them.

So the thresholds below are on **repeated content, tokens a turn, and provider calls a turn**. Any
other number here is a watch-line.

## The mechanism differs by wire, and that decides the risk

| | Anthropic wire | openai-compatible wire (the local runtime, and Max's machine) |
|---|---|---|
| how the prompt is sent | `anthropicPromptContent(prompt, cacheBreakpointChars)` | `messages: [{ role: 'user', content: prompt }]` |
| prefix caching | **yes** — already wired, `cacheBreakpointChars` is passed | **none** |
| conversation memory | none — one user message | none — one user message |

**On Anthropic the prefix can be cached: the content still reaches the model every turn, the cost
does not.** No drift is possible because nothing is removed.

**On the local wire there is no cache and no multi-message history, so the only mechanism is
omission** — send the digest and belt on turn 1, and on later turns send a short reference instead.
That is a real removal, and drift is a real risk.

**These are two different changes and they are registered as two variants, not one.** A run that
mixed them could not say which produced any result.

## Variant A — cache the prefix (Anthropic)

Cost falls, content is unchanged. **No drift clause is needed and none is registered**, because
nothing is withheld from the model.

1. **Repeated content billed falls below 40%** of the turn. *Refuted above 60%* — the breakpoint is
   in the wrong place or the prefix is not stable byte-for-byte.
2. **Tokens a turn as sent do not change** — the prompt is identical; only the billing differs. *A
   change here means the prefix was edited, not cached, and the run is void.*

## Variant B — omit and reference (the local wire)

This is the one Max's report is about and the one with the risk.

1. **Repeated content falls below 40%**, from 99%. *Refuted above 60%.*
2. **Tokens a turn fall by at least 3,000** on turns 2+, from 5,409–5,521. *Refuted below 2,000.*
3. **Provider calls a turn do not rise** above today's 5.4. *Refuted above 6.5* — a model that has
   lost the workspace may loop looking for it, which would trade tokens for calls and win nothing.

### What could go wrong, and how this detects it

**A model told the workspace once and then not reminded may drift from it** — inventing services,
naming files that do not exist, describing a structure it no longer has in front of it. Assuming
that will not happen is exactly the shape of assumption this repository keeps being wrong about.

It is detected by three things already built, none of which needs new code:

- **`claims.unsupportedTechnologies`** — terms named in the answer that the scan did not find
  anywhere. **Registered: the rate per turn must not rise above the control's range.** *Refuted if
  it rises in both runs* — that is fabrication, and it is the failure mode that matters most.
- **`coverage.edgesSeen` / `packagesSeen`** — what the answer was grounded in. A drifting turn
  grounds in less. **Watch-line, not a kill:** it is already near zero, so it has little room to
  fall, and the sixth law says a threshold on a quantity that cannot move is not a kill.
- **`premise`** — the check on what the *question* asserted. A turn that has lost the digest cannot
  refute a false premise about the repository. **Watch-line.**

**And a fourth, deliberately human:** the same subject-less and file-named asks read from the seat on
turn 3 of a conversation, where the digest is longest gone. Three numbers cannot tell you the answer
reads as though the model forgot the repository; a person can.

**If drift shows, variant B is dead and variant A is the whole change** — which would mean the local
runtime keeps its cost and Anthropic does not, and that is a legitimate outcome to report rather than
a failure to engineer around.

## The control

`ceiling-1` and `ceiling-2` for the local wire: same model, same length, same flag, before the
change. Two runs a side.

## What this does not claim

- **Not that the digest is the right content.** Whether a service-level sketch is what a turn should
  hold is the file-graph page, which is the next design and is not this.
- **Not that speed is the only complaint.** Max reported three things; this addresses cost and
  latency. Continuity is the carry, already built; the drawings being hard to read is neither.
- **Not that caching is free.** A cached prefix that changes byte-for-byte between turns caches
  nothing and costs a write. Clause A2 exists to catch exactly that.
- **Not measured on the seat.** Every clause here is a number. The seat read named above is the part
  that says whether any of it made the chat better.

## Card cost

Two runs a side for variant B, on the four-turn shape: **80 to 95 minutes for the pair**, the same as
the ceiling arms. Variant A cannot be measured on the local runtime at all and needs a key — it is
registered now and run when there is one, not queued for a card window it does not use.

## Measured before building — and variant B should not be built

Three measurements taken to build it, each of which changed the plan.

### 1. Variant A is already built

`cacheBreakpointChars: promptWithTools.length` is passed **unconditionally at both provider call
sites**. On the Anthropic wire the prefix is already marked cacheable. A needs no code — it needs a
key. This page said "build both variants"; one of them existed.

### 2. The repeated prefix is instructions, not workspace

| part of the 5,330-token repeated prefix | tokens | share |
|---|---|---|
| instruction belt | 2,456 | **46%** |
| fixed instruction prose inside the base prompt | 1,372 | **26%** |
| **the workspace itself** | **1,312** | **25%** |

Measured by rendering the base prompt with the real digest (2,684 tokens) and with an empty one
(1,372). **Seventy-two per cent of what repeats is instructions.** Dropping the digest's 300 edges
saves **45 tokens** — the digest is already summarised on the way into the prompt, so there is no
bulk there to remove.

### 3. So the 40% is unreachable by this build, by arithmetic

Variant B can remove at most the workspace: 5,330 → 4,018, repeated content **97% → ~73%**. The
threshold was 40%. **The only piece large enough to reach it is the belt, and the belt is out of
scope by ruling** — it is its own registered condition because trimming instructions for tools the
model does not call could be why it does not call them.

**This is the sixth law a third time**, and it is the law working rather than failing: the quantity
was named before the threshold, the arithmetic was done before the build, and the mismatch surfaced
while it was still free.

## The recommendation, which is not to build variant B

It trades **the model's only workspace grounding** for **25% of the repeated prefix**, on a wire
where omission is genuine — the model would not have seen the digest in that call at all. And the
"omit and reference" mechanism this page registered is worse than that: a stateless wire has no
earlier turn from the model's side, so a line saying the workspace was given earlier would be **a
false statement placed in the prompt**. The first law does not stop at the answer; prompt material
that is not true is the same defect as an invented edge.

**What the numbers point at instead**, in the order they pay:

1. **The belt — 46%, already slated for its own registration.** The largest single piece, and the one
   whose removal is testable without touching grounding.
2. **The fixed prose in the base prompt — 26%.** Never examined. It is instructions, not workspace,
   and the same question applies to it as to the belt.
3. **Variant A on Anthropic — the whole prefix, at zero risk**, because the content still arrives.

**Nothing further is built here without a ruling.** Building B would remove grounding to chase a
threshold that arithmetic already says it cannot reach.
