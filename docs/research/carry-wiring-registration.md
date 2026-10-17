# Wiring the carry into the product — registered before it is written

**Written 2026-09-06, before a line of the plumbing exists and before any card. This is a change to
the PRODUCT, not to an experiment, and it arrives carrying two different mechanisms.**

## What is being fixed

`input.carry` is read at `askPipeline.ts:2310` and `:4071` and **set nowhere in the product**. Both
`/api/ask` routes build their input without it; `carryOut` is computed, stripped as an
`INTERNAL_FIELD`, and discarded under a comment saying the caller persists it. Only
`tools/bench/teach-eval.mjs` has ever threaded it. Every turn a person has taken ran with the carry
undefined.

The plumbing is small: `resolveAskThreadId` already gives the ask route a conversation identity — an
explicit `threadId` wins, the workspace's active session is the fallback, no client change — so a
bounded per-thread store, written after a turn and read before the next, is what is missing.

## Why this is registered separately, and not folded into stage four

**One patch, two mechanisms, on two different tiers.** Landing them together is the confound that cost
the belt arms their attribution:

| tier | what the wiring turns on | why |
|---|---|---|
| **teach turn** | `chart` **and** `concept` — for the first time outside the bench | both slots fill on teach and have simply been thrown away |
| **first-tier ask** | `referents` **only** | `filesRead` needs edit intent, `chart` needs `input.teach === true`, `concept` needs `teachContext` — all three unreachable, and `turnCarry.reach.test.ts` is the gate that says so |

So the teach path gains a mechanism it has never run, and the ask path gains exactly the one thing
stage four is about. **They are predicted separately below, with a flag each**, so no arm has to
attribute a result to two changes at once.

## How much prompt this actually adds — measured, not estimated

Rendered from the real module against a realistic conversation:

| | block | cost |
|---|---|---|
| teach, turn 5 (four charts, four concepts) | 6 lines, 690 chars | **~192 tokens**, ≈3.5% of a 5,409–5,521-token teach turn |
| first-tier ask, turn 2 (8 referents of 84) | 2 lines, 558 chars | **~155 tokens** |

Small enough that a token threshold on it would be the sixth law's mistake again. **No band is
registered on prompt size.** The bands below are all on behaviour.

## MECHANISM A — the teach path. This one has something to lose.

Teach is the tier that currently works: charts fire on 67–71% of turns, the advance rule ships, and
every bench number this programme owns comes from here. **The registration therefore leads with the
regression, not the improvement.**

**Control:** the same build with `SEQUENCE_ASK_CARRY_WIRE` off, `SEQUENCE_ASK_CARRY_REFERENTS` off in
both arms so the fourth slot cannot contribute. Bench, four turns, two runs a side.

### What a regression looks like, said in advance

1. **Charts must not fall.** 67%, 69% today. The carry now tells the model what it already drew, and
   a model told "you drew this" may not draw again. **Kill: chart rate below the control's range in
   both runs.** This is the likeliest regression and the one that matters most, because the picture
   is the teach contract's whole receipt.
2. **Distinct concepts per run must not fall.** 35 today. The block lists what has been taught; a
   model reading it as "the lesson is covered" would shorten the lesson. **Kill: below the control's
   range in both runs.**
3. **Refusals must not rise.** Stub rate within the control's range on matched turns.
4. **Fabrication must not rise.** `claims.unsupportedTechnologies`, recorded since `9a599904`.
   **Kill: rises in both runs.**

### What is NOT registered as a win, and why

**Repeats.** The obvious claim for the carry is that it stops the model re-teaching, and repeated
concepts are the natural number. **They are already at 1 and 0** — the advance rule took them from 25
and 25 on 2026-09-06, which is the confound that voided stage one's headline. A number at its floor
cannot move, so a kill on it would be a threshold on a quantity the change cannot touch. **Watch-line
only.**

That leaves mechanism A with **no registered win and four registered regressions**, which is the
honest shape: this half is a plumbing fix that connects a computed value, and the case for it is that
throwing the value away was never intended — not that anyone has measured a benefit on teach.

## MECHANISM B — the first-tier ask. This is stage four.

**Control:** the wired build with `SEQUENCE_ASK_CARRY_REFERENTS` off, against the same wired build
with it on. `SEQUENCE_ASK_CARRY_WIRE` on in both arms, so the plumbing is not the difference.
**Seat instrument**, three turns, ask intent, teach off.

Clauses, attribution rules and the fragment-versus-absence table are in
`carry-redesign-registration.md` and are not restated. The sharpened clause 1 stands: **turn 2 names
one of `eval/grade.ts`, `functions/repoFunctionGraph.ts`, `harness/designDrawBaseline.ts`** — the
three carried callers that turn 1's prose never mentions. Naming only the five that turn 1 said aloud
is **inconclusive, not a partial success.**

## The two flags, and why there are two

| flag | gates | default |
|---|---|---|
| `SEQUENCE_ASK_CARRY_WIRE` | the plumbing — whether a stored carry is passed in and `carryOut` stored | **off** |
| `SEQUENCE_ASK_CARRY_REFERENTS` | the fourth slot only | **off** |

Two flags because there are two mechanisms. Arm A varies `WIRE` with `REFERENTS` off in both; arm B
varies `REFERENTS` with `WIRE` on in both. **Each arm differs in one thing**, which is the control law
applied at design time rather than discovered in a result.

Shipping either default-on is a separate decision that this page does not make and no arm here
licenses.

## What could go wrong in the plumbing itself

- **Unbounded growth.** A store keyed by thread with no bound is a leak in a long-lived server.
  **Bounded before it is written**, and the bound is stated in the code rather than assumed.
- **The wrong thread.** `sessionId` on this route is the AUTHENTICATED USER, not the conversation —
  a comment in `repoServer.ts` records someone already being caught by that name. Keying the carry on
  it would leak one conversation into another of the same user. **The key is the resolved thread id,
  and a case must prove that two conversations do not share a carry**, because that failure is
  invisible in a single-conversation test and is a privacy fault, not a quality one.
- **A stale carry outliving its repository.** The carry names files; a rescan can delete them. Names
  are carried as names and the block says the contents were not read, which bounds the damage to a
  name that no longer resolves. **Known hole, registered, not fixed here.**

## What this page does not claim

- **Not that stage one's numbers can be salvaged.** They measured a mechanism the product does not
  run. Wiring it does not retrofit them; it makes future numbers mean something.
- **Not that the teach path benefits.** Mechanism A is registered with regressions only, on purpose.
- **Not that either flag should ship on.** That decision needs both results and is not made here.

## Cost

The plumbing costs no card. **Mechanism A is a bench pair, ~90 minutes.** Mechanism B is four seat
reads, ~25–30 minutes. B is the one stage four is waiting on; A is the one with something to lose,
and it should run first if only one runs.
